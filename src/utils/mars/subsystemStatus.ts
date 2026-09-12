// Lectura del estado de diagnóstico que publica cada ModularSubsystem del
// framework MARS.
//
// Cada subsistema escribe, en cada loop (ModularSubsystem.java):
//
//   <Subsistema>/Status/Name      string   ej. "NOMINAL", "INTAKING"
//   <Subsistema>/Status/Hex       string   color YA resuelto por el robot
//   <Subsistema>/Status/Message   string   texto formateado
//
// El color cambia según la acción que el subsistema esté ejecutando, no solo
// según su salud: es el mismo color que va a los LEDs.

import { TopicAnnounce } from "../../store/appStore"
import { unpackLiveValue } from "../dashboard/valueDecoding"

const HEX_SUFFIX = "/Status/Hex"

/**
 * Severidad de un estado. Son las cuatro de StatusColorCode.Severity, más
 * "unknown" para lo que la app no puede clasificar.
 *
 * IMPORTANTE: la severidad NO viaja por NetworkTables — el framework solo
 * publica Name, Hex y Message. Así que acá se INFIERE, y por eso el color
 * crudo del robot se muestra siempre, aunque la clasificación falle.
 */
export type Severity = "ok" | "warning" | "error" | "critical" | "unknown"

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  error: "Error",
  warning: "Working",
  ok: "Nominal",
  unknown: "Unknown",
}

/** Iconos por severidad; el archivo vive en public/icons. */
export const SEVERITY_ICONS: Record<Severity, string> = {
  critical: "status-critical.svg",
  error: "status-error.svg",
  warning: "status-warning.svg",
  ok: "status-ok.svg",
  unknown: "status-unknown.svg",
}

/** De más grave a menos: es el orden en que conviene mirarlos. */
export const SEVERITY_ORDER: Severity[] = ["critical", "error", "warning", "ok", "unknown"]

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0, error: 1, warning: 2, ok: 3, unknown: 4,
}

/** Los cuatro códigos de GlobalColorCode, que sí tienen severidad conocida. */
const GLOBAL_CODES: Record<string, Severity> = {
  NOMINAL: "ok",
  WORKING: "warning",
  TIMEOUT: "error",
  HARDWARE_FAULT: "critical",
}

export interface SubsystemStatus {
  /** Ruta de la tabla del subsistema, ej. "/Arm". */
  prefix: string
  /** Último segmento, para mostrar. */
  name: string
  /** Valor de Status/Name: el código, no el subsistema. */
  code: string | null
  hex: string | null
  message: string | null
  severity: Severity
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const clean = hex.trim().replace(/^#/, "")
  const full = clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null

  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4

  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * Clasifica por tono. El framework usa verde/amarillo/naranja/rojo para las
 * cuatro severidades globales, y los códigos propios de cada equipo
 * (ModuleColorCode) siguen la misma convención de color.
 *
 * Un color desaturado, muy oscuro, o de otro tono (azul, violeta) se deja como
 * "unknown" en vez de forzarlo a una severidad: mejor decir que no se sabe que
 * pintar de rojo un estado que el equipo eligió celeste.
 */
export function severityFromHex(hex: string | null): Severity {
  if (!hex) return "unknown"
  const hsl = hexToHsl(hex)
  if (hsl === null) return "unknown"

  // Gris, blanco o casi negro: no comunica severidad.
  if (hsl.s < 0.18 || hsl.l < 0.08 || hsl.l > 0.95) return "unknown"

  const h = hsl.h
  if (h < 15 || h >= 330) return "critical"  // rojo
  if (h < 40) return "error"                 // naranja
  if (h < 75) return "warning"               // amarillo
  if (h < 170) return "ok"                   // verde
  return "unknown"                           // cian/azul/violeta
}

/** El nombre del código manda sobre el color cuando es uno de los globales. */
export function severityOf(code: string | null, hex: string | null): Severity {
  if (code && code.toUpperCase() in GLOBAL_CODES) return GLOBAL_CODES[code.toUpperCase()]
  return severityFromHex(hex)
}

/** Rutas de subsistema que publican estado, detectadas por su topic Hex. */
export function findStatusSubsystems(topics: Map<string, TopicAnnounce>): string[] {
  const out: string[] = []
  topics.forEach(topic => {
    if (!topic.name.endsWith(HEX_SUFFIX)) return
    if (!topic.topic_type.includes("string")) return
    out.push(topic.name.slice(0, -HEX_SUFFIX.length))
  })
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Los topics que hay que pedirle al backend para dibujar el tablero. */
export function statusTopicNames(prefixes: string[]): string[] {
  return prefixes.flatMap(p => [`${p}/Status/Name`, `${p}/Status/Hex`, `${p}/Status/Message`])
}

function readString(values: Record<string, any>, key: string): string | null {
  const value = unpackLiveValue(values[key])
  return typeof value === "string" && value.length > 0 ? value : null
}

export function readSubsystemStatus(values: Record<string, any>, prefix: string): SubsystemStatus {
  const code = readString(values, `${prefix}/Status/Name`)
  const hex = readString(values, `${prefix}/Status/Hex`)
  const message = readString(values, `${prefix}/Status/Message`)
  const segments = prefix.split("/").filter(Boolean)

  return {
    prefix,
    name: segments.length > 0 ? segments[segments.length - 1] : prefix,
    code,
    hex,
    message,
    severity: severityOf(code, hex),
  }
}

/** Más graves primero; a igual severidad, alfabético. */
export function sortBySeverity(statuses: SubsystemStatus[]): SubsystemStatus[] {
  return [...statuses].sort((a, b) => {
    const diff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    return diff !== 0 ? diff : a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

export function countBySeverity(statuses: SubsystemStatus[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { ok: 0, warning: 0, error: 0, critical: 0, unknown: 0 }
  for (const s of statuses) counts[s.severity]++
  return counts
}

/**
 * Equivalente a AlertRegistry.hasCriticalAlerts(): el chequeo rápido antes de
 * habilitar para un partido.
 */
export function hasCriticalAlerts(statuses: SubsystemStatus[]): boolean {
  return statuses.some(s => s.severity === "critical")
}

/** Un cambio de estado, para la tira de historial de cada subsistema. */
export interface StatusChange {
  atMs: number
  code: string | null
  hex: string | null
  message: string | null
  severity: Severity
}

/**
 * Agrega un cambio al historial solo si de verdad cambió algo. Sin esto, a
 * 4Hz de poll, el historial se llenaría de entradas idénticas y taparía los
 * cambios reales.
 */
export function pushStatusChange(
  history: StatusChange[],
  status: SubsystemStatus,
  atMs: number,
  limit = 12,
): StatusChange[] {
  const last = history[history.length - 1]
  if (last && last.code === status.code && last.hex === status.hex && last.message === status.message) {
    return history
  }
  const next = [...history, {
    atMs,
    code: status.code,
    hex: status.hex,
    message: status.message,
    severity: status.severity,
  }]
  return next.length > limit ? next.slice(next.length - limit) : next
}
