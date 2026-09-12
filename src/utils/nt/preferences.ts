// Tabla /Preferences de WPILib.
//
// Es la única tabla de NetworkTables que SÍ sobrevive un reinicio: cuando el
// robot llama `Preferences.initDouble(...)`, WPILib le marca al topic la
// propiedad `persistent` y el servidor lo guarda en `networktables.json` del
// roboRIO. Por eso es donde viven las constantes que se calibran una vez y no
// se quieren perder — offsets de encoder, ganancias, límites.
//
// Un detalle que cambia cómo se usa esta página: las preferencias las DECLARA
// el robot, no el dashboard. Desde acá se pueden cambiar valores (y eso sí
// persiste, porque el topic ya viene marcado) y crear entradas nuevas, pero una
// entrada creada desde el dashboard no queda marcada como persistente hasta que
// el código del robot la declare. Lo mismo con borrar: sacar una preferencia de
// verdad es `Preferences.remove(...)` del lado del robot.

import { TopicAnnounce } from "../../store/appStore"
import { classifyTopic } from "../dashboard/topicClassification"

export const PREFERENCES_TABLE = "Preferences"
const PREFIX = `/${PREFERENCES_TABLE}/`

/** Los tipos que `Preferences` sabe guardar. */
export type PreferenceKind = "double" | "int" | "boolean" | "string" | "float"

export const PREFERENCE_KINDS: PreferenceKind[] = ["double", "int", "boolean", "string", "float"]

export interface PreferenceRow {
  topicName: string
  /** La clave tal como la usa el código del robot, sin el prefijo. */
  key: string
  kind: PreferenceKind
  topicType: string
}

/** La clave de una preferencia, o null si el topic no es una. */
export function preferenceKeyOf(topicName: string): string | null {
  if (!topicName.startsWith(PREFIX)) return null
  const key = topicName.slice(PREFIX.length)

  // WPILib publica `/Preferences/.type = "RobotPreferences"` para marcar la
  // tabla. No es una preferencia y no debe aparecer en la lista.
  if (key.length === 0 || key.startsWith(".")) return null
  return key
}

export function preferenceKind(topicType: string): PreferenceKind | null {
  switch (topicType) {
    case "double": return "double"
    case "float": return "float"
    case "int": return "int"
    case "boolean": return "boolean"
    case "string": return "string"
    default: {
      // Un tipo raro (un array, un struct) no lo produce Preferences, pero si
      // alguien escribió ahí a mano igual conviene mostrarlo antes que
      // esconderlo.
      const c = classifyTopic(topicType)
      if (c.isNumber) return "double"
      if (c.isBoolean) return "boolean"
      if (c.isString) return "string"
      return null
    }
  }
}

/** Todo lo que hay bajo /Preferences ahora mismo, ordenado por clave. */
export function collectPreferences(topics: Map<string, TopicAnnounce>): PreferenceRow[] {
  const rows: PreferenceRow[] = []

  topics.forEach(topic => {
    const key = preferenceKeyOf(topic.name)
    if (key === null) return
    const kind = preferenceKind(topic.topic_type)
    if (kind === null) return
    rows.push({ topicName: topic.name, key, kind, topicType: topic.topic_type })
  })

  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

export function preferenceTopicName(key: string): string {
  return `${PREFIX}${key.replace(/^\/+/, "")}`
}

// --- Valores ---------------------------------------------------------------------

export type PreferenceValue = number | boolean | string

export function defaultValueFor(kind: PreferenceKind): PreferenceValue {
  if (kind === "boolean") return false
  if (kind === "string") return ""
  return 0
}

/**
 * Convierte lo que se escribió en la caja al valor del tipo, o null si no es
 * válido todavía (a medio escribir, vacío, letras en un número).
 */
export function parsePreferenceValue(kind: PreferenceKind, text: string): PreferenceValue | null {
  if (kind === "string") return text
  if (kind === "boolean") {
    const lower = text.trim().toLowerCase()
    if (lower === "true" || lower === "1") return true
    if (lower === "false" || lower === "0") return false
    return null
  }

  if (text.trim().length === 0) return null
  const value = Number(text)
  if (!isFinite(value)) return null
  return kind === "int" ? Math.round(value) : value
}

/** Cómo se muestra un valor en la caja de edición. */
export function formatPreferenceValue(value: PreferenceValue | null | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "true" : "false"
  return String(value)
}

// --- Java --------------------------------------------------------------------------

const JAVA_SUFFIX: Record<PreferenceKind, string> = {
  double: "Double",
  float: "Float",
  int: "Int",
  boolean: "Boolean",
  string: "String",
}

const JAVA_TYPE: Record<PreferenceKind, string> = {
  double: "double",
  float: "float",
  int: "int",
  boolean: "boolean",
  string: "String",
}

function javaLiteral(kind: PreferenceKind, value: PreferenceValue): string {
  if (kind === "string") {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  if (kind === "boolean") return value ? "true" : "false"

  const num = typeof value === "number" ? value : 0
  if (kind === "int") return String(Math.round(num))

  // Java infiere int de un literal sin punto, y un float necesita su sufijo.
  const trimmed = Number(num.toFixed(6)).toString()
  const withPoint = /[.eE]/.test(trimmed) ? trimmed : `${trimmed}.0`
  return kind === "float" ? `${withPoint}f` : withPoint
}

function javaKey(key: string): string {
  return `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * La línea que DECLARA la preferencia. Es la que hace que la entrada exista y
 * quede marcada como persistente; sin ella, una clave creada desde el
 * dashboard desaparece cuando el servidor se reinicia.
 */
export function javaInit(key: string, kind: PreferenceKind, value: PreferenceValue): string {
  return `Preferences.init${JAVA_SUFFIX[kind]}(${javaKey(key)}, ${javaLiteral(kind, value)});`
}

/** La línea que la LEE, con el valor actual como respaldo. */
export function javaGet(key: string, kind: PreferenceKind, value: PreferenceValue, variable?: string): string {
  const name = variable && variable.length > 0 ? variable : javaVariableName(key)
  return `${JAVA_TYPE[kind]} ${name} = Preferences.get${JAVA_SUFFIX[kind]}(${javaKey(key)}, ${javaLiteral(kind, value)});`
}

/** Lo único que borra de verdad una preferencia: corre del lado del robot. */
export function javaRemove(key: string): string {
  return `Preferences.remove(${javaKey(key)});`
}

export function javaVariableName(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return "value"

  const head = parts[0]
  const camel = head.charAt(0).toLowerCase() + head.slice(1)
    + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("")
  return /^[0-9]/.test(camel) ? `v${camel}` : camel
}

export interface PreferenceSnapshot {
  key: string
  kind: PreferenceKind
  value: PreferenceValue
}

/** Todas las declaraciones juntas, con el import arriba. */
export function javaInitBlock(rows: PreferenceSnapshot[]): string {
  if (rows.length === 0) return ""
  const body = rows.map(row => javaInit(row.key, row.kind, row.value)).join("\n")
  return `import edu.wpi.first.wpilibj.Preferences;\n\n${body}`
}

/** Todas las lecturas juntas, con el import arriba. */
export function javaGetBlock(rows: PreferenceSnapshot[]): string {
  if (rows.length === 0) return ""
  const body = rows.map(row => javaGet(row.key, row.kind, row.value)).join("\n")
  return `import edu.wpi.first.wpilibj.Preferences;\n\n${body}`
}
