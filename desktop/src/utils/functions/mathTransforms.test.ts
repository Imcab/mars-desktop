import { describe, it, expect } from "vitest"
import {
  applyTransform, computeStats, differentiateFinite, integrateTrapezoidal,
  movingAverage, TimeSeriesPoint,
} from "./mathTransforms"
import { buildPhasePlot, boundsOf } from "./phasePlot"

/** Serie muestreada a paso fijo `dt` sobre la función `f`. */
function sample(f: (t: number) => number, count: number, dt = 0.1): TimeSeriesPoint[] {
  return Array.from({ length: count }, (_, i) => ({ t: i * dt, v: f(i * dt) }))
}

describe("differentiateFinite", () => {
  it("da la pendiente exacta de una recta", () => {
    // f(t) = 3t  ->  f'(t) = 3 en todo punto
    const d = differentiateFinite(sample(t => 3 * t, 10))
    expect(d).toHaveLength(10)
    d.forEach(p => expect(p.v).toBeCloseTo(3, 10))
  })

  it("conserva la cantidad de muestras", () => {
    // La versión anterior (diferencia hacia atrás) perdía la primera muestra y
    // desalineaba la serie respecto de las demás.
    const input = sample(t => t * t, 20)
    expect(differentiateFinite(input)).toHaveLength(input.length)
  })

  it("es más precisa que la diferencia hacia atrás en una parábola", () => {
    // f(t) = t²  ->  f'(t) = 2t. La diferencia CENTRADA es exacta acá; la de
    // hacia atrás daría 2t - dt.
    const d = differentiateFinite(sample(t => t * t, 30))
    // Se saltean los extremos, que caen a diferencia simple por no tener vecino.
    for (let i = 1; i < d.length - 1; i++) {
      expect(d[i].v).toBeCloseTo(2 * d[i].t, 8)
    }
  })

  it("ignora muestras con dt cero o negativo", () => {
    const d = differentiateFinite([
      { t: 0, v: 0 }, { t: 0, v: 5 }, { t: 1, v: 1 },
    ])
    d.forEach(p => expect(isFinite(p.v)).toBe(true))
  })

  it("devuelve vacío con menos de dos puntos", () => {
    expect(differentiateFinite([])).toEqual([])
    expect(differentiateFinite([{ t: 0, v: 1 }])).toEqual([])
  })
})

describe("segunda derivada", () => {
  it("saca la aceleración constante de una parábola", () => {
    // f(t) = ½·a·t² con a = 4  ->  f''(t) = 4
    const d2 = applyTransform(sample(t => 0.5 * 4 * t * t, 40), "derivative2")
    // Los bordes arrastran el error de los extremos de cada derivada.
    const middle = d2.slice(3, -3)
    expect(middle.length).toBeGreaterThan(20)
    middle.forEach(p => expect(p.v).toBeCloseTo(4, 6))
  })

  it("da cero sobre una recta", () => {
    const d2 = applyTransform(sample(t => 2 * t + 1, 20), "derivative2")
    d2.slice(3, -3).forEach(p => expect(p.v).toBeCloseTo(0, 8))
  })
})

describe("integrateTrapezoidal", () => {
  it("integra una constante a una rampa", () => {
    // ∫2 dt = 2t
    const out = integrateTrapezoidal(sample(() => 2, 11))
    expect(out[0].v).toBe(0)
    expect(out[10].v).toBeCloseTo(2 * 1.0, 10)
  })

  it("es la inversa de derivar, salvo la constante", () => {
    const original = sample(t => t * t, 50)
    const roundTrip = integrateTrapezoidal(differentiateFinite(original))
    const last = roundTrip[roundTrip.length - 1]
    // original(4.9) - original(0) = 24.01
    expect(last.v).toBeCloseTo(original[original.length - 1].v - original[0].v, 1)
  })
})

describe("movingAverage", () => {
  it("aplana el ruido y conserva el nivel", () => {
    // Señal constante 10 con ruido alternado ±1 -> el promedio vuelve a 10.
    const noisy = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.1, v: 10 + (i % 2 === 0 ? 1 : -1) }))
    const smooth = movingAverage(noisy, 5)
    smooth.slice(3, -3).forEach(p => expect(Math.abs(p.v - 10)).toBeLessThan(0.35))
  })

  it("conserva la cantidad de muestras y los timestamps", () => {
    const input = sample(t => Math.sin(t), 25)
    const out = movingAverage(input, 7)
    expect(out).toHaveLength(input.length)
    expect(out.map(p => p.t)).toEqual(input.map(p => p.t))
  })

  it("con ventana 1 o menos no cambia nada", () => {
    const input = sample(t => t, 5)
    expect(movingAverage(input, 1)).toEqual(input)
    expect(movingAverage(input, 0)).toEqual(input)
  })
})

describe("escala y offset", () => {
  it("se aplican después del transform", () => {
    // d/dt de 3t es 3; ×2 y +1 da 7.
    const out = applyTransform(sample(t => 3 * t, 10), "derivative", { scale: 2, offset: 1 })
    out.forEach(p => expect(p.v).toBeCloseTo(7, 8))
  })

  it("no toca los datos si son neutros", () => {
    const input = sample(t => t, 5)
    expect(applyTransform(input, "raw", { scale: 1, offset: 0 })).toEqual(input)
  })
})

describe("computeStats", () => {
  it("calcula min/max/media/desviación", () => {
    const s = computeStats([
      { t: 0, v: 2 }, { t: 1, v: 4 }, { t: 2, v: 4 },
      { t: 3, v: 4 }, { t: 4, v: 5 }, { t: 5, v: 5 },
      { t: 6, v: 7 }, { t: 7, v: 9 },
    ])!
    expect(s.count).toBe(8)
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.mean).toBe(5)
    // Desviación poblacional conocida de este conjunto clásico.
    expect(s.stdDev).toBeCloseTo(2, 10)
    expect(s.last).toBe(9)
  })

  it("nunca devuelve una desviación NaN por error de redondeo", () => {
    // Var = E[x²] - E[x]² puede dar un negativo minúsculo con valores grandes
    // e iguales; la raíz de eso sería NaN.
    const s = computeStats(Array.from({ length: 50 }, (_, i) => ({ t: i, v: 1e6 })))!
    expect(s.stdDev).toBe(0)
    expect(isNaN(s.stdDev)).toBe(false)
  })

  it("ignora valores no finitos", () => {
    const s = computeStats([{ t: 0, v: 1 }, { t: 1, v: NaN }, { t: 2, v: 3 }])!
    expect(s.count).toBe(2)
    expect(s.mean).toBe(2)
  })

  it("devuelve null sin datos", () => {
    expect(computeStats([])).toBeNull()
    expect(computeStats([{ t: 0, v: NaN }])).toBeNull()
  })
})

describe("buildPhasePlot", () => {
  it("cruza dos series interpolando la del eje X", () => {
    // X e Y con timestamps DISTINTOS: dos topics nunca publican al mismo tiempo.
    const x = [{ t: 0, v: 0 }, { t: 1, v: 10 }]
    const y = [{ t: 0.5, v: 100 }]
    const out = buildPhasePlot(x, y)
    expect(out).toHaveLength(1)
    expect(out[0].x).toBeCloseTo(5)   // interpolado a mitad de camino
    expect(out[0].y).toBe(100)
  })

  it("descarta los puntos fuera del rango cubierto por X", () => {
    // No extrapola: sin dato de X no hay par que graficar.
    const x = [{ t: 1, v: 0 }, { t: 2, v: 1 }]
    const y = [{ t: 0, v: 5 }, { t: 1.5, v: 6 }, { t: 9, v: 7 }]
    expect(buildPhasePlot(x, y)).toHaveLength(1)
  })

  it("descarta valores no finitos", () => {
    const x = [{ t: 0, v: 0 }, { t: 1, v: 1 }]
    expect(buildPhasePlot(x, [{ t: 0.5, v: NaN }])).toHaveLength(0)
  })
})

describe("boundsOf", () => {
  it("agrega margen", () => {
    const b = boundsOf([0, 10], 0.1)
    expect(b.min).toBeCloseTo(-1)
    expect(b.max).toBeCloseTo(11)
  })

  it("no colapsa el eje con una serie constante", () => {
    // min === max daría un eje de alto cero y una división por cero al escalar.
    const b = boundsOf([5, 5, 5])
    expect(b.max).toBeGreaterThan(b.min)
  })

  it("cae a un rango usable si no hay datos finitos", () => {
    expect(boundsOf([])).toEqual({ min: -1, max: 1 })
    expect(boundsOf([NaN, Infinity])).toEqual({ min: -1, max: 1 })
  })
})
