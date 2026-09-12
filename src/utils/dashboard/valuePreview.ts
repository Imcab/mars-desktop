// Texto corto que se muestra al lado de cada topic en el Data Directory,
// igual que la columna de valores del sidebar de AdvantageScope.
//
// No es lo mismo que lo que dibuja un widget: acá todo tiene que entrar en una
// línea, así que los arrays se resumen y los structs se aplanan.

import { classifyTopic } from "./topicClassification"
import { decodeStructBytes, unpackLiveValue } from "./valueDecoding"
import { getStructDef } from "../../store/structSchemaStore"

/** Cuántos elementos de un array se listan antes de cortar con "…". */
const ARRAY_PREVIEW_LIMIT = 6
const STRING_PREVIEW_LIMIT = 40

// Misma escala que usa AdvantageScope: notación científica en los extremos,
// enteros sin decimales y 3 decimales en el resto. Un "12.000000000001" en el
// árbol no aporta nada y descoloca las filas.
export function formatNumber(value: number): string {
  if (!isFinite(value)) return String(value)
  if (Math.abs(value) < 1e-9) return "0"
  if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3) {
    return value.toExponential(1).replace("+", "")
  }
  if (value % 1 === 0) return value.toString()
  return value.toFixed(3)
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text
}

function formatScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return formatNumber(value)
  if (typeof value === "string") return truncate(value, STRING_PREVIEW_LIMIT)
  return String(value)
}

/** Cantidad de elementos de un array, o null si el topic no es un array. */
export function arrayLengthOf(topicType: string, liveValue: any): number | null {
  const c = classifyTopic(topicType)

  if (c.isStructArray) {
    // Un struct array son bytes crudos: la cantidad sale de dividir por el
    // tamaño de UNA instancia, que solo se conoce si hay schema.
    const def = getStructDef(c.structName)
    const bytes: number[] | undefined = liveValue?.Raw
    if (!def || !bytes || def.length === 0) return null
    return Math.floor(bytes.length / def.length)
  }

  if (!c.isArrayType || c.isStructType) return null
  const raw = unpackLiveValue(liveValue)
  return Array.isArray(raw) ? raw.length : null
}

/** Texto de UN elemento de un array (para las filas de índice del árbol). */
export function formatArrayElement(topicType: string, liveValue: any, index: number): string | null {
  const c = classifyTopic(topicType)

  if (c.isStructArray) {
    const def = getStructDef(c.structName)
    const bytes: number[] | undefined = liveValue?.Raw
    if (!def || !bytes) return null
    const slice = bytes.slice(index * def.length, (index + 1) * def.length)
    if (slice.length < def.length) return null
    return decodeStructBytes(slice, def)
      .map(f => `${f.label}: ${f.text}${f.suffix ?? ""}`)
      .join(", ")
  }

  const raw = unpackLiveValue(liveValue)
  if (!Array.isArray(raw) || index >= raw.length) return null
  return formatScalar(raw[index])
}

/**
 * Resumen del valor de un topic. Devuelve null cuando todavía no llegó nada,
 * que es distinto de un valor vacío: la fila simplemente no muestra columna.
 */
export function formatTopicValue(topicType: string, liveValue: any): string | null {
  if (liveValue === undefined || liveValue === null) return null
  const c = classifyTopic(topicType)

  // Struct suelto: se aplana a "campo: valor, campo: valor". Sin schema no se
  // puede decodificar, pero cae abajo al conteo de bytes en vez de devolver
  // null: una fila en blanco no se distingue de "todavía no llegó nada".
  if (c.isStructSingle) {
    const def = getStructDef(c.structName)
    const bytes: number[] | undefined = liveValue?.Raw
    if (def && bytes && bytes.length > 0) {
      return decodeStructBytes(bytes, def)
        .map(f => `${f.label}: ${f.text}${f.suffix ?? ""}`)
        .join(", ")
    }
  }

  if (c.isStructArray) {
    const count = arrayLengthOf(topicType, liveValue)
    if (count !== null) return `${count} × ${c.structName}`
  }

  // El chequeo de Raw va ANTES del de array: unpackLiveValue devuelve los
  // bytes como number[], así que un struct sin schema se imprimía como una
  // lista de bytes sueltos ("[1, 2, 3, 4]") en vez de decir cuántos son.
  if (Array.isArray(liveValue?.Raw)) {
    return `${liveValue.Raw.length} bytes`
  }

  const raw = unpackLiveValue(liveValue)
  if (raw === null) return null

  if (Array.isArray(raw)) {
    if (raw.length === 0) return "empty"
    const shown = raw.slice(0, ARRAY_PREVIEW_LIMIT).map(formatScalar)
    if (raw.length > ARRAY_PREVIEW_LIMIT) shown.push("…")
    return `[${shown.join(", ")}]`
  }

  return formatScalar(raw)
}
