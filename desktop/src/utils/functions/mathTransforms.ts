export interface TimeSeriesPoint { t: number; v: number }

// raw          -> la señal tal cual
// derivative   -> velocidad (d/dt)
// derivative2  -> aceleración (d²/dt²)
// integral     -> área acumulada
// movingAvg    -> promedio móvil: el filtro que más falta hace en FRC, porque
//                 la derivada de un encoder crudo es puro ruido
export type FunctionTransform = "raw" | "integral" | "derivative" | "derivative2" | "movingAvg"

export const TRANSFORM_LABELS: Record<FunctionTransform, string> = {
  raw: "Raw",
  derivative: "d/dt (1st derivative)",
  derivative2: "d²/dt² (2nd derivative)",
  integral: "∫ dt (integral)",
  movingAvg: "Moving average",
}

// Integración numérica por el método de los trapecios: acumula el área bajo
// la curva muestra a muestra. integral[0] siempre es 0 (referencia relativa
// al primer punto disponible en el buffer, no una constante de integración real).
export function integrateTrapezoidal(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
  if (points.length === 0) return []
  const out: TimeSeriesPoint[] = [{ t: points[0].t, v: 0 }]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t
    if (dt > 0) acc += ((points[i].v + points[i - 1].v) / 2) * dt
    out.push({ t: points[i].t, v: acc })
  }
  return out
}

// Derivada numérica por diferencias CENTRADAS donde se puede:
//   f'(t_i) ≈ (f(t_i+1) - f(t_i-1)) / (t_i+1 - t_i-1)
// La diferencia hacia atrás que había antes atrasa la señal medio paso y
// amplifica el ruido; la centrada tiene error O(h²) en vez de O(h), que con
// un encoder ruidoso se nota bastante. Los extremos caen a diferencia simple
// porque no tienen vecino de un lado.
export function differentiateFinite(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
  if (points.length < 2) return []
  const out: TimeSeriesPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dt = next.t - prev.t
    if (dt <= 0) continue
    out.push({ t: points[i].t, v: (next.v - prev.v) / dt })
  }
  return out
}

/** Promedio móvil centrado de `windowSize` muestras. */
export function movingAverage(points: TimeSeriesPoint[], windowSize: number): TimeSeriesPoint[] {
  const size = Math.max(1, Math.floor(windowSize))
  if (size <= 1 || points.length === 0) return points
  const half = Math.floor(size / 2)
  const out: TimeSeriesPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const from = Math.max(0, i - half)
    const to = Math.min(points.length - 1, i + half)
    let sum = 0
    for (let k = from; k <= to; k++) sum += points[k].v
    out.push({ t: points[i].t, v: sum / (to - from + 1) })
  }
  return out
}

export interface TransformOptions {
  /** Muestras del promedio móvil (solo para transform "movingAvg"). */
  smoothWindow?: number
  /** Multiplicador aplicado DESPUÉS del transform (conversión de unidades). */
  scale?: number
  /** Corrimiento aplicado después del escalado (quitar un offset de sensor). */
  offset?: number
}

export function applyTransform(
  points: TimeSeriesPoint[],
  transform: FunctionTransform,
  options: TransformOptions = {},
): TimeSeriesPoint[] {
  let out: TimeSeriesPoint[]
  switch (transform) {
    case "integral": out = integrateTrapezoidal(points); break
    case "derivative": out = differentiateFinite(points); break
    // La segunda derivada es derivar dos veces; sobre datos ruidosos conviene
    // suavizar antes con "Moving average" en otra serie.
    case "derivative2": out = differentiateFinite(differentiateFinite(points)); break
    case "movingAvg": out = movingAverage(points, options.smoothWindow ?? 5); break
    default: out = points
  }

  const scale = options.scale ?? 1
  const offset = options.offset ?? 0
  if (scale === 1 && offset === 0) return out
  return out.map(p => ({ t: p.t, v: p.v * scale + offset }))
}

// --- Estadística ------------------------------------------------------------

export interface SeriesStats {
  count: number
  min: number
  max: number
  mean: number
  /** Desviación estándar poblacional. */
  stdDev: number
  /** Raíz de la media de cuadrados. */
  rms: number
  last: number
}

export function computeStats(points: TimeSeriesPoint[]): SeriesStats | null {
  if (points.length === 0) return null

  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sumSq = 0
  let count = 0

  for (const p of points) {
    if (!isFinite(p.v)) continue
    if (p.v < min) min = p.v
    if (p.v > max) max = p.v
    sum += p.v
    sumSq += p.v * p.v
    count++
  }
  if (count === 0) return null

  const mean = sum / count
  // Var = E[x²] - E[x]², que con floats puede dar un negativo minúsculo.
  const variance = Math.max(0, sumSq / count - mean * mean)

  return {
    count,
    min,
    max,
    mean,
    stdDev: Math.sqrt(variance),
    rms: Math.sqrt(sumSq / count),
    last: points[points.length - 1].v,
  }
}
