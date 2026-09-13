import { describe, it, expect } from "vitest"
import { solveOls, solveLinearSystem } from "./ols"
import {
  fitFeedforward, accelerationOf, buildSamples, buildDiagnostics, predictVoltage,
  SysIdSample, SysIdTestRun, SysIdTestType, MechanismType, ALL_TESTS, TEST_COLORS,
} from "./feedforward"

// --- Generación de datos sintéticos ----------------------------------------
//
// La estrategia: partir de gains CONOCIDOS, generar el voltaje exacto que
// predice el modelo, y comprobar que el ajuste los recupera. Si la matemática
// está mal, los números no vuelven.
//
// La velocidad se hace LINEAL en t a propósito: su derivada por diferencias
// centradas es exacta en todos los puntos (incluidos los extremos), así que
// el error del ajuste no se mezcla con el error de derivar.

interface TrueGains { kS: number; kV: number; kA: number; kG?: number }

function makeRun(
  mechanism: MechanismType,
  type: SysIdTestType,
  gains: TrueGains,
  opts: { accel: number; v0: number; count: number; dt: number; theta0?: number },
): SysIdTestRun {
  const samples: SysIdSample[] = []
  for (let i = 0; i < opts.count; i++) {
    const t = i * opts.dt
    const velocity = opts.v0 + opts.accel * t
    // θ avanza con la velocidad; solo lo mira el modelo de brazo.
    const position = (opts.theta0 ?? 0) + opts.v0 * t + 0.5 * opts.accel * t * t

    let voltage = gains.kS * Math.sign(velocity) + gains.kV * velocity + gains.kA * opts.accel
    if (mechanism === "elevator") voltage += gains.kG!
    if (mechanism === "arm") voltage += gains.kG! * Math.cos(position)

    samples.push({ t, voltage, position, velocity })
  }
  return { type, samples }
}

/** Las cuatro corridas estándar: cuasi-estáticas (a≈0) y dinámicas (a alta). */
function fullTestSet(mechanism: MechanismType, gains: TrueGains): SysIdTestRun[] {
  return [
    makeRun(mechanism, "quasistatic-forward", gains, { accel: 0.02, v0: 0.05, count: 200, dt: 0.02, theta0: 0.1 }),
    makeRun(mechanism, "quasistatic-backward", gains, { accel: -0.02, v0: -0.05, count: 200, dt: 0.02, theta0: 0.4 }),
    makeRun(mechanism, "dynamic-forward", gains, { accel: 3.5, v0: 0.2, count: 120, dt: 0.02, theta0: 0.8 }),
    makeRun(mechanism, "dynamic-backward", gains, { accel: -3.5, v0: -0.2, count: 120, dt: 0.02, theta0: 1.2 }),
  ]
}

// ---------------------------------------------------------------------------

describe("solveLinearSystem", () => {
  it("resuelve un sistema conocido", () => {
    // 2x + y = 5 ; x + 3y = 10  ->  x = 1, y = 3
    const out = solveLinearSystem([[2, 1], [1, 3]], [5, 10])!
    expect(out[0]).toBeCloseTo(1, 10)
    expect(out[1]).toBeCloseTo(3, 10)
  })

  it("devuelve null si la matriz es singular", () => {
    // Segunda fila = 2× la primera: infinitas soluciones.
    expect(solveLinearSystem([[1, 2], [2, 4]], [3, 6])).toBeNull()
  })

  it("sobrevive a un pivote inicial cero gracias al pivoteo parcial", () => {
    // Sin intercambio de filas esto dividiría por cero.
    const out = solveLinearSystem([[0, 1], [1, 0]], [2, 3])!
    expect(out[0]).toBeCloseTo(3, 10)
    expect(out[1]).toBeCloseTo(2, 10)
  })
})

describe("solveOls", () => {
  it("recupera exactamente una relación lineal", () => {
    // y = 2·a + 3·b
    const x = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]
    const y = x.map(([a, b]) => 2 * a + 3 * b)
    const r = solveOls(x, y)!
    expect(r.coefficients[0]).toBeCloseTo(2, 9)
    expect(r.coefficients[1]).toBeCloseTo(3, 9)
    expect(r.rSquared).toBeCloseTo(1, 9)
    expect(r.rmse).toBeCloseTo(0, 9)
  })

  it("baja el R² cuando los datos no siguen el modelo", () => {
    const x = [[1], [2], [3], [4], [5]]
    const y = [1, 5, 2, 8, 3] // ruido puro
    const r = solveOls(x, y)!
    expect(r.rSquared).toBeLessThan(0.5)
  })

  it("devuelve null con menos muestras que incógnitas", () => {
    expect(solveOls([[1, 2, 3]], [1])).toBeNull()
  })

  it("devuelve null si una columna es constante cero", () => {
    // Un test que no movió el mecanismo deja la columna de aceleración en 0.
    expect(solveOls([[1, 0], [2, 0], [3, 0]], [1, 2, 3])).toBeNull()
  })

  it("no devuelve NaN cuando y es constante", () => {
    // ssTot = 0 dividiría por cero al calcular R².
    const r = solveOls([[1], [2], [3]], [5, 5, 5])!
    expect(isNaN(r.rSquared)).toBe(false)
  })

  it("rechaza valores no finitos", () => {
    expect(solveOls([[1, NaN], [2, 1]], [1, 2])).toBeNull()
  })
})

describe("accelerationOf", () => {
  it("es exacta con velocidad lineal, incluidos los extremos", () => {
    const samples: SysIdSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 0.02, voltage: 0, position: 0, velocity: 1 + 2.5 * (i * 0.02),
    }))
    accelerationOf(samples).forEach(a => expect(a).toBeCloseTo(2.5, 9))
  })

  it("no divide por cero con timestamps repetidos", () => {
    const samples: SysIdSample[] = [
      { t: 0, voltage: 0, position: 0, velocity: 0 },
      { t: 0, voltage: 0, position: 0, velocity: 1 },
    ]
    accelerationOf(samples).forEach(a => expect(isFinite(a)).toBe(true))
  })
})

describe("fitFeedforward — simple motor", () => {
  const truth = { kS: 0.22, kV: 2.4, kA: 0.31 }

  it("recupera kS, kV y kA de datos sintéticos", () => {
    const fit = fitFeedforward("simple", fullTestSet("simple", truth))!
    expect(fit.gains.kS).toBeCloseTo(truth.kS, 6)
    expect(fit.gains.kV).toBeCloseTo(truth.kV, 6)
    expect(fit.gains.kA).toBeCloseTo(truth.kA, 6)
    expect(fit.rSquared).toBeCloseTo(1, 6)
    expect(fit.gains.kG).toBeUndefined()
  })

  it("no avisa nada cuando el ajuste es bueno y están los cuatro tests", () => {
    const fit = fitFeedforward("simple", fullTestSet("simple", truth))!
    expect(fit.warnings).toEqual([])
  })

  it("avisa si falta alguna de las cuatro corridas", () => {
    // Se saca UNA sola: con las otras tres el sistema sigue siendo resoluble.
    const runs = fullTestSet("simple", truth).filter(r => r.type !== "dynamic-backward")
    const fit = fitFeedforward("simple", runs)!
    expect(fit.warnings.some(w => w.includes("Dynamic backward"))).toBe(true)
    // Con tres corridas los gains todavía salen bien; el aviso es preventivo.
    expect(fit.gains.kV).toBeCloseTo(truth.kV, 5)
  })

  it("no inventa gains si solo se corrieron los tests cuasi-estáticos", () => {
    // Sin las corridas dinámicas la aceleración es proporcional a sgn(v), así
    // que kS y kA son matemáticamente indistinguibles. Devolver cualquier par
    // de números sería peor que no devolver nada: el usuario los cargaría al
    // robot creyendo que sirven.
    const runs = fullTestSet("simple", truth).filter(r => r.type.startsWith("quasistatic"))
    expect(fitFeedforward("simple", runs)).toBeNull()
  })

  it("avisa cuando los términos son casi indistinguibles", () => {
    // Igual que arriba pero con un poquito de ruido en la aceleración: ya no
    // es singular, así que el ajuste "cierra" y el R² se ve alto — pero los
    // gains están mal repartidos. Esto es lo que pasa con datos reales.
    const runs = fullTestSet("simple", truth)
      .filter(r => r.type.startsWith("quasistatic"))
      .map(r => ({
        ...r,
        samples: r.samples.map((sample, i) => ({
          ...sample,
          velocity: sample.velocity * (1 + (i % 3) * 1e-9),
        })),
      }))
    const fit = fitFeedforward("simple", runs)
    if (fit !== null) {
      expect(fit.warnings.some(w => w.includes("nearly indistinguishable"))).toBe(true)
    }
  })
})

describe("fitFeedforward — elevator", () => {
  const truth = { kS: 0.15, kV: 3.1, kA: 0.42, kG: 0.85 }

  it("separa la gravedad constante de la fricción estática", () => {
    // kG y kS son el caso difícil: los dos son términos "constantes" salvo que
    // kS cambia de signo con la velocidad. Sin corridas en los dos sentidos
    // serían indistinguibles.
    const fit = fitFeedforward("elevator", fullTestSet("elevator", truth))!
    expect(fit.gains.kG).toBeCloseTo(truth.kG, 6)
    expect(fit.gains.kS).toBeCloseTo(truth.kS, 6)
    expect(fit.gains.kV).toBeCloseTo(truth.kV, 6)
    expect(fit.gains.kA).toBeCloseTo(truth.kA, 6)
  })
})

describe("fitFeedforward — arm", () => {
  const truth = { kS: 0.19, kV: 1.7, kA: 0.26, kG: 1.05 }

  it("recupera kG usando cos(θ)", () => {
    const fit = fitFeedforward("arm", fullTestSet("arm", truth))!
    expect(fit.gains.kG).toBeCloseTo(truth.kG, 5)
    expect(fit.gains.kS).toBeCloseTo(truth.kS, 5)
    expect(fit.gains.kV).toBeCloseTo(truth.kV, 5)
    expect(fit.gains.kA).toBeCloseTo(truth.kA, 5)
  })

  it("el modelo de brazo y el de elevador no dan lo mismo", () => {
    // Datos generados con gravedad dependiente del ángulo: ajustarlos como
    // elevador (gravedad constante) tiene que empeorar el ajuste.
    const runs = fullTestSet("arm", truth)
    const asArm = fitFeedforward("arm", runs)!
    const asElevator = fitFeedforward("elevator", runs)!
    expect(asArm.rSquared).toBeGreaterThan(asElevator.rSquared)
  })
})

describe("fitFeedforward — casos degenerados", () => {
  it("descarta las muestras con el mecanismo quieto", () => {
    // Con v ≈ 0 el signo salta entre -1 y 1 por ruido y arruina kS.
    const runs = fullTestSet("simple", { kS: 0.2, kV: 2, kA: 0.3 })
    const still: SysIdTestRun = {
      type: "dynamic-forward",
      samples: Array.from({ length: 50 }, (_, i) => ({
        t: i * 0.02, voltage: 0, position: 0, velocity: 0,
      })),
    }
    const fit = fitFeedforward("simple", [...runs, still])!
    // Las quietas no entran, así que los gains no se mueven.
    expect(fit.gains.kV).toBeCloseTo(2, 5)
  })

  it("devuelve null si no hay ninguna muestra utilizable", () => {
    const dead: SysIdTestRun = {
      type: "dynamic-forward",
      samples: Array.from({ length: 20 }, (_, i) => ({
        t: i * 0.02, voltage: 1, position: 0, velocity: 0,
      })),
    }
    expect(fitFeedforward("simple", [dead])).toBeNull()
  })

  it("devuelve null con corridas demasiado cortas", () => {
    expect(fitFeedforward("simple", [{ type: "dynamic-forward", samples: [] }])).toBeNull()
  })

  it("avisa cuando kV o kA salen no positivos", () => {
    // Voltaje invertido respecto de la velocidad: kV sale negativo.
    const runs = fullTestSet("simple", { kS: 0.2, kV: -2, kA: -0.3 })
    const fit = fitFeedforward("simple", runs)!
    expect(fit.warnings.some(w => w.includes("kV is not positive"))).toBe(true)
    expect(fit.warnings.some(w => w.includes("kA is not positive"))).toBe(true)
  })

  it("cubre los cuatro tipos de test declarados", () => {
    expect(ALL_TESTS).toHaveLength(4)
    const fit = fitFeedforward("simple", fullTestSet("simple", { kS: 0.2, kV: 2, kA: 0.3 }))!
    expect(fit.sampleCount).toBeGreaterThan(600)
  })
})

describe("buildSamples", () => {
  it("interpola posición y velocidad sobre la grilla del voltaje", () => {
    // Los tres topics se publican por separado y no comparten timestamps.
    const voltage = [{ t: 0.5, v: 6 }]
    const position = [{ t: 0, v: 0 }, { t: 1, v: 10 }]
    const velocity = [{ t: 0, v: 0 }, { t: 1, v: 4 }]
    const out = buildSamples(voltage, position, velocity)
    expect(out).toHaveLength(1)
    expect(out[0].position).toBeCloseTo(5)
    expect(out[0].velocity).toBeCloseTo(2)
    expect(out[0].voltage).toBe(6)
  })

  it("descarta los instantes sin velocidad conocida", () => {
    // Sin extrapolar: fuera del rango medido no hay dato real.
    const voltage = [{ t: 0, v: 1 }, { t: 5, v: 1 }]
    const velocity = [{ t: 0, v: 0 }, { t: 1, v: 1 }]
    expect(buildSamples(voltage, [], velocity)).toHaveLength(1)
  })

  it("usa 0 de posición si no hay topic de posición", () => {
    // Un motor simple no necesita posición; el modelo no la mira.
    const out = buildSamples([{ t: 0.5, v: 3 }], [], [{ t: 0, v: 0 }, { t: 1, v: 2 }])
    expect(out[0].position).toBe(0)
  })
})

describe("buildDiagnostics", () => {
  const truth = { kS: 0.22, kV: 2.4, kA: 0.31 }

  it("predice exactamente lo medido cuando el ajuste es perfecto", () => {
    const runs = fullTestSet("simple", truth)
    const fit = fitFeedforward("simple", runs)!
    const diag = buildDiagnostics("simple", fit.gains, runs)

    expect(diag).toHaveLength(4)
    for (const run of diag) {
      for (const p of run.points) {
        expect(p.predicted).toBeCloseTo(p.measured, 6)
        expect(p.residual).toBeCloseTo(0, 6)
      }
    }
  })

  it("conserva el tipo de cada corrida para poder colorearlas", () => {
    const runs = fullTestSet("simple", truth)
    const diag = buildDiagnostics("simple", fitFeedforward("simple", runs)!.gains, runs)
    expect(diag.map(d => d.type).sort()).toEqual([...ALL_TESTS].sort())
    // Cada tipo tiene su color, si no dos corridas se verían iguales.
    expect(new Set(Object.values(TEST_COLORS)).size).toBe(4)
  })

  it("descarta las mismas muestras que el ajuste", () => {
    // Si el gráfico mostrara puntos que el ajuste no usó, el usuario vería
    // desviaciones que no influyeron en los gains.
    const still: SysIdTestRun = {
      type: "dynamic-forward",
      samples: Array.from({ length: 30 }, (_, i) => ({
        t: i * 0.02, voltage: 5, position: 0, velocity: 0,
      })),
    }
    const diag = buildDiagnostics("simple", { kS: 0.2, kV: 2, kA: 0.3 }, [still])
    expect(diag).toHaveLength(0)
  })

  it("muestra residuos grandes cuando los gains no corresponden", () => {
    const runs = fullTestSet("simple", truth)
    // Gains inventados: el residuo tiene que dejar de ser cero.
    const diag = buildDiagnostics("simple", { kS: 5, kV: 0.1, kA: 9 }, runs)
    const worst = Math.max(...diag.flatMap(r => r.points.map(p => Math.abs(p.residual))))
    expect(worst).toBeGreaterThan(1)
  })

  it("delata el modelo equivocado con residuos estructurados", () => {
    // Datos de brazo (gravedad ~ cos θ) ajustados como elevador: el residuo
    // deja de ser ruido y toma forma. Eso es justo lo que el gráfico muestra.
    const armRuns = fullTestSet("arm", { kS: 0.19, kV: 1.7, kA: 0.26, kG: 1.05 })
    const asElevator = fitFeedforward("elevator", armRuns)!
    const diag = buildDiagnostics("elevator", asElevator.gains, armRuns)
    const worst = Math.max(...diag.flatMap(r => r.points.map(p => Math.abs(p.residual))))
    expect(worst).toBeGreaterThan(0.05)
  })
})

describe("predictVoltage", () => {
  it("reproduce el modelo de motor simple", () => {
    // V = 0.2·sgn(v) + 2·v + 0.3·a  con v=1.5, a=4
    const v = predictVoltage("simple", { kS: 0.2, kV: 2, kA: 0.3 },
      { t: 0, voltage: 0, position: 0, velocity: 1.5 }, 4)
    expect(v).toBeCloseTo(0.2 + 3 + 1.2, 9)
  })

  it("suma kG constante en el elevador", () => {
    const v = predictVoltage("elevator", { kS: 0, kV: 0, kA: 0, kG: 0.9 },
      { t: 0, voltage: 0, position: 0, velocity: 1 }, 0)
    expect(v).toBeCloseTo(0.9, 9)
  })

  it("escala kG por cos(θ) en el brazo", () => {
    // θ = π/3 -> cos θ = 0.5
    const v = predictVoltage("arm", { kS: 0, kV: 0, kA: 0, kG: 2 },
      { t: 0, voltage: 0, position: Math.PI / 3, velocity: 1 }, 0)
    expect(v).toBeCloseTo(1, 9)
  })

  it("invierte el signo de kS con la velocidad", () => {
    const gains = { kS: 0.5, kV: 0, kA: 0 }
    const fwd = predictVoltage("simple", gains, { t: 0, voltage: 0, position: 0, velocity: 1 }, 0)
    const back = predictVoltage("simple", gains, { t: 0, voltage: 0, position: 0, velocity: -1 }, 0)
    expect(fwd).toBeCloseTo(0.5, 9)
    expect(back).toBeCloseTo(-0.5, 9)
  })
})
