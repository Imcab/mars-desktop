import { TimeSeriesPoint } from "./mathTransforms"
import { interpolateAt } from "./seriesAlgebra"

// Un punto del plano X-Y: dos señales enfrentadas entre sí en vez de contra el
// tiempo. Es lo que permite mirar velocidad-vs-aceleración, corriente-vs-rpm o
// setpoint-vs-medido, donde el tiempo solo importa como orden del recorrido.
export interface PhasePoint {
  x: number
  y: number
  /** Instante del que salió el par; se usa para colorear el recorrido. */
  t: number
}

/**
 * Cruza dos series sobre la grilla temporal de la que va en Y, interpolando la
 * de X. Sin interpolar habría que exigir timestamps idénticos, y dos topics
 * distintos casi nunca los tienen.
 */
export function buildPhasePlot(xSeries: TimeSeriesPoint[], ySeries: TimeSeriesPoint[]): PhasePoint[] {
  const out: PhasePoint[] = []
  for (const p of ySeries) {
    const x = interpolateAt(xSeries, p.t)
    if (x === null || !isFinite(x) || !isFinite(p.v)) continue
    out.push({ x, y: p.v, t: p.t })
  }
  return out
}

export interface Bounds { min: number; max: number }

/** Rango de una lista de números, con margen y un ancho mínimo utilizable. */
export function boundsOf(values: number[], marginRatio = 0.05): Bounds {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!isFinite(min) || !isFinite(max)) return { min: -1, max: 1 }

  // Una serie constante da min === max y colapsaría el eje a cero de alto.
  if (min === max) {
    const pad = Math.abs(min) > 1e-9 ? Math.abs(min) * 0.1 : 1
    return { min: min - pad, max: max + pad }
  }

  const margin = (max - min) * marginRatio
  return { min: min - margin, max: max + margin }
}
