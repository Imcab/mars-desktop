export interface TimeSeriesPoint { t: number; v: number }

export type FunctionTransform = "raw" | "integral" | "derivative"

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

// Derivada numérica por diferencias finitas hacia atrás:
// f'(t_i) ≈ (f(t_i) - f(t_i-1)) / (t_i - t_i-1)
// El primer punto no tiene un punto anterior con el que compararse, se omite.
export function differentiateFinite(points: TimeSeriesPoint[]): TimeSeriesPoint[] {
  const out: TimeSeriesPoint[] = []
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t
    if (dt <= 0) continue
    out.push({ t: points[i].t, v: (points[i].v - points[i - 1].v) / dt })
  }
  return out
}

export function applyTransform(points: TimeSeriesPoint[], transform: FunctionTransform): TimeSeriesPoint[] {
  switch (transform) {
    case "integral": return integrateTrapezoidal(points)
    case "derivative": return differentiateFinite(points)
    default: return points
  }
}
