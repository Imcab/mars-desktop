// Compilador de schemas de struct de WPILib.
//
// WPILib publica, junto a cada topic "struct:Foo", un topic hermano
// "/.schema/struct:Foo" cuyo valor es un TEXTO que describe el layout binario:
//
//     Pose2d              -> "Translation2d translation;Rotation2d rotation"
//     Translation2d       -> "double x;double y"
//     SwerveModuleState   -> "double speed;Rotation2d angle"
//     con enum            -> "enum {kOff=0, kOn=1} int8 mode"
//     con bitfield        -> "int32 flags:4"
//     con array           -> "double xs[3]"
//
// Compilar ese texto es lo que permite entender structs que el equipo definió
// por su cuenta, en vez de depender de la tabla escrita a mano de
// valueDecoding.ts (que solo cubre los tipos que trae WPILib).
//
// Spec: https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/struct.adoc

import type { StructDef, StructField, StructPrimitive } from "./valueDecoding"

// Ancho en BITS de cada tipo primitivo. Es también el tamaño máximo que puede
// declarar un bitfield de ese tipo.
const PRIMITIVE_BITS: Record<StructPrimitive, number> = {
  bool: 8,
  char: 8,
  int8: 8,
  int16: 16,
  int32: 32,
  int64: 64,
  uint8: 8,
  uint16: 16,
  uint32: 32,
  uint64: 64,
  float: 32,
  float32: 32,
  double: 64,
  float64: 64,
}

const PRIMITIVES = Object.keys(PRIMITIVE_BITS) as StructPrimitive[]

// Solo los enteros y bool pueden empaquetarse en un bitfield; un double con
// ":4" es inválido y se descarta.
const BITFIELD_TYPES = new Set<StructPrimitive>([
  "bool", "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64",
])

function isPrimitive(type: string): type is StructPrimitive {
  return (PRIMITIVES as string[]).includes(type)
}

// Tope de campos que se aplanan de un struct. Un "Pose3d poses[200]" generaría
// miles de filas que ninguna tarjeta puede mostrar; mejor cortar y avisar.
const MAX_FLAT_FIELDS = 64

// --- Parseo del texto -------------------------------------------------------

interface ParsedField {
  name: string
  /** Primitivo, o el nombre de otro struct. */
  type: string
  enumValues: Record<number, string> | null
  bitWidth: number | null
  arrayLength: number | null
}

function parseEnumBody(body: string): Record<number, string> {
  const out: Record<number, string> = {}
  body.split(",").forEach(pair => {
    const [name, value] = pair.split("=")
    if (name === undefined || value === undefined) return
    const parsed = Number(value.trim())
    if (!isNaN(parsed)) out[parsed] = name.trim()
  })
  return out
}

export function parseSchema(text: string): ParsedField[] {
  const fields: ParsedField[] = []

  // Los cuerpos de enum usan "," y nunca ";", así que partir por ";" es seguro.
  for (const rawDecl of text.split(";")) {
    let decl = rawDecl.trim()
    if (decl.length === 0) continue

    let enumValues: Record<number, string> | null = null
    if (decl.startsWith("enum")) {
      const open = decl.indexOf("{")
      const close = decl.indexOf("}")
      if (open === -1 || close === -1) continue
      enumValues = parseEnumBody(decl.substring(open + 1, close))
      decl = decl.substring(close + 1).trim()
    }

    const parts = decl.split(/\s+/).filter(p => p.length > 0)
    if (parts.length < 2) continue
    const type = parts[0]
    const nameSpec = parts.slice(1).join("")

    let name = nameSpec
    let bitWidth: number | null = null
    let arrayLength: number | null = null

    if (nameSpec.includes(":")) {
      const [n, w] = nameSpec.split(":")
      name = n
      bitWidth = Number(w)
      if (isNaN(bitWidth) || bitWidth <= 0) continue
      // Un bitfield sobre un tipo que no lo admite (o un bool de más de 1 bit)
      // es inválido según la spec.
      if (!isPrimitive(type) || !BITFIELD_TYPES.has(type)) continue
      if (type === "bool" && bitWidth !== 1) continue
    } else if (nameSpec.includes("[")) {
      const [n, rest] = nameSpec.split("[")
      name = n
      arrayLength = Number(rest.split("]")[0])
      if (isNaN(arrayLength) || arrayLength < 0) continue
    }

    fields.push({ name, type, enumValues, bitWidth, arrayLength })
  }

  return fields
}

// --- Cálculo de posiciones --------------------------------------------------

interface CompiledField extends ParsedField {
  /** [inicio, fin) en BITS desde el arranque del struct. */
  bitRange: [number, number]
}

export interface CompiledSchema {
  /** Tamaño total en BITS. */
  bitLength: number
  fields: CompiledField[]
}

/**
 * Asigna posiciones de bit. Devuelve null si el schema referencia otro struct
 * que todavía no se compiló (hay que reintentar cuando ese llegue).
 *
 * El empaquetado de bitfields sigue la spec: bits consecutivos del mismo tipo
 * comparten palabra, y se abre una palabra nueva cuando cambia el tipo o
 * cuando el valor ya no entra en la actual.
 */
export function compileSchema(
  parsed: ParsedField[],
  known: Record<string, CompiledSchema>,
): CompiledSchema | null {
  const fields: CompiledField[] = []
  let bitPosition = 0

  // Palabra de bitfield abierta: cuántos bits se llevan usados y de qué ancho
  // es la palabra. null en ambos = no hay ninguna abierta.
  let bitfieldPosition: number | null = null
  let bitfieldLength: number | null = null

  const closeBitfield = () => {
    if (bitfieldPosition !== null && bitfieldLength !== null) {
      // Los bits que sobran de la palabra igual ocupan lugar.
      bitPosition += bitfieldLength - bitfieldPosition
    }
    bitfieldPosition = null
    bitfieldLength = null
  }

  for (const field of parsed) {
    if (!isPrimitive(field.type)) {
      const child = known[field.type]
      if (child === undefined) return null // falta una dependencia
      closeBitfield()
      const length = child.bitLength * (field.arrayLength ?? 1)
      fields.push({ ...field, bitRange: [bitPosition, bitPosition + length] })
      bitPosition += length
      continue
    }

    if (field.bitWidth === null) {
      closeBitfield()
      const length = PRIMITIVE_BITS[field.type] * (field.arrayLength ?? 1)
      fields.push({ ...field, bitRange: [bitPosition, bitPosition + length] })
      bitPosition += length
      continue
    }

    const typeLength = PRIMITIVE_BITS[field.type]
    const valueBits = Math.min(field.bitWidth, typeLength)
    const needsNewWord =
      bitfieldPosition === null ||
      bitfieldLength === null ||
      // Un bool cabe en cualquier palabra; el resto necesita una de su tamaño.
      (field.type !== "bool" && bitfieldLength !== typeLength) ||
      bitfieldPosition + valueBits > bitfieldLength

    if (needsNewWord) {
      closeBitfield()
      bitfieldPosition = 0
      bitfieldLength = typeLength
    }

    fields.push({ ...field, bitRange: [bitPosition, bitPosition + valueBits] })
    bitfieldPosition = (bitfieldPosition ?? 0) + valueBits
    bitPosition += valueBits
  }

  closeBitfield()

  return { bitLength: bitPosition, fields }
}

// --- Aplanado a StructDef ---------------------------------------------------

// Los widgets y los extractores consumen una lista PLANA de campos con offset,
// igual que la tabla escrita a mano. Aplanar acá (en vez de hacer que cada
// consumidor entienda structs anidados) es lo que deja que un schema dinámico
// entre por el mismo camino que un Pose2d de toda la vida.
function flatten(
  schema: CompiledSchema,
  known: Record<string, CompiledSchema>,
  prefix: string,
  baseBit: number,
  out: StructField[],
): void {
  for (const field of schema.fields) {
    if (out.length >= MAX_FLAT_FIELDS) return

    const label = prefix.length > 0 ? `${prefix}/${field.name}` : field.name
    const startBit = baseBit + field.bitRange[0]

    if (!isPrimitive(field.type)) {
      const child = known[field.type]
      if (child === undefined) continue
      if (field.arrayLength === null) {
        flatten(child, known, label, startBit, out)
      } else {
        for (let i = 0; i < field.arrayLength; i++) {
          if (out.length >= MAX_FLAT_FIELDS) return
          flatten(child, known, `${label}[${i}]`, startBit + i * child.bitLength, out)
        }
      }
      continue
    }

    // char[] es una cadena, no una lista de caracteres sueltos.
    if (field.type === "char" && field.arrayLength !== null) {
      out.push({
        label,
        offset: startBit / 8,
        type: "char",
        charLength: field.arrayLength,
      })
      continue
    }

    const push = (fieldLabel: string, bitOffset: number) => {
      const base: StructField = {
        label: fieldLabel,
        offset: Math.floor(bitOffset / 8),
        type: field.type as StructPrimitive,
      }
      if (field.bitWidth !== null) {
        base.bitOffset = bitOffset
        base.bitWidth = field.bitRange[1] - field.bitRange[0]
      }
      if (field.enumValues !== null) base.enumValues = field.enumValues
      out.push(base)
    }

    if (field.arrayLength === null) {
      push(label, startBit)
    } else {
      const itemBits = PRIMITIVE_BITS[field.type]
      for (let i = 0; i < field.arrayLength; i++) {
        if (out.length >= MAX_FLAT_FIELDS) return
        push(`${label}[${i}]`, startBit + i * itemBits)
      }
    }
  }
}

export function toStructDef(schema: CompiledSchema, known: Record<string, CompiledSchema>): StructDef {
  const fields: StructField[] = []
  flatten(schema, known, "", 0, fields)
  return {
    // El tamaño de UNA instancia, que es lo que usa decodeStructArrayBytes como
    // stride para trocear un struct:X[].
    length: Math.ceil(schema.bitLength / 8),
    fields,
    truncated: fields.length >= MAX_FLAT_FIELDS,
  }
}

// --- Registro con resolución de dependencias --------------------------------

/**
 * Compila todo lo que se pueda a partir de los textos conocidos. Un schema que
 * referencia a otro no se puede compilar hasta que ese otro llegue, y el orden
 * de llegada por NetworkTables no está garantizado, así que se itera hasta que
 * una pasada no logre compilar nada nuevo.
 */
export function compileAll(texts: Record<string, string>): Record<string, StructDef> {
  const parsed: Record<string, ParsedField[]> = {}
  for (const [name, text] of Object.entries(texts)) {
    parsed[name] = parseSchema(text)
  }

  const compiled: Record<string, CompiledSchema> = {}
  let progress = true
  while (progress) {
    progress = false
    for (const [name, fields] of Object.entries(parsed)) {
      if (name in compiled) continue
      const result = compileSchema(fields, compiled)
      if (result !== null) {
        compiled[name] = result
        progress = true
      }
    }
  }

  const defs: Record<string, StructDef> = {}
  for (const [name, schema] of Object.entries(compiled)) {
    defs[name] = toStructDef(schema, compiled)
  }
  return defs
}
