import { TimeSeriesPoint } from "./mathTransforms"

export type SeriesOperator = "add" | "subtract" | "multiply" | "divide"

export const OPERATOR_LABELS: Record<SeriesOperator, string> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
}

function applyOperator(op: SeriesOperator, a: number, b: number): number {
  switch (op) {
    case "add": return a + b
    case "subtract": return a - b
    case "multiply": return a * b
    case "divide": return b === 0 ? NaN : a / b
  }
}

// Interpola linealmente el valor de `points` en el instante `t`. Devuelve
// null si `t` cae fuera del rango cubierto por el buffer — no extrapola,
// porque fuera del rango no tenemos ninguna base real para inventar un valor.
export function interpolateAt(points: TimeSeriesPoint[], t: number): number | null {
  if (points.length === 0) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (t < first.t || t > last.t) return null
  if (t === first.t) return first.v
  if (t === last.t) return last.v

  // Búsqueda lineal: los buffers de la ventana viva son cortos (segundos a
  // ~20Hz), no vale la pena una búsqueda binaria acá.
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const p0 = points[i - 1]
      const p1 = points[i]
      const span = p1.t - p0.t
      const frac = span > 0 ? (t - p0.t) / span : 0
      return p0.v + (p1.v - p0.v) * frac
    }
  }
  return null
}

// Combina dos series muestra a muestra. Usa los timestamps de la PRIMERA
// serie (`a`) como grilla de referencia y interpola la segunda (`b`) sobre
// esa grilla — así el resultado siempre queda alineado al reloj de `a`.
export function combineSeries(a: TimeSeriesPoint[], b: TimeSeriesPoint[], operator: SeriesOperator): TimeSeriesPoint[] {
  const out: TimeSeriesPoint[] = []
  for (const pa of a) {
    const bVal = interpolateAt(b, pa.t)
    if (bVal === null) continue
    const v = applyOperator(operator, pa.v, bVal)
    if (!isFinite(v)) continue
    out.push({ t: pa.t, v })
  }
  return out
}

export interface ErrorBandPoint { t: number; actual: number; target: number }

// Construye la banda "actual vs target" alineando el target sobre la grilla
// temporal de la serie actual, punto por punto, para poder sombrear el área
// entre ambas curvas aunque no compartan timestamps exactos.
export function buildErrorBand(actual: TimeSeriesPoint[], target: TimeSeriesPoint[]): ErrorBandPoint[] {
  const out: ErrorBandPoint[] = []
  for (const p of actual) {
    const targetVal = interpolateAt(target, p.t)
    if (targetVal === null) continue
    out.push({ t: p.t, actual: p.v, target: targetVal })
  }
  return out
}