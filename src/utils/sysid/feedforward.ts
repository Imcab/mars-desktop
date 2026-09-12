// Ajuste de feedforward al estilo de SysId de WPILib.
//
// Modelos (docs.wpilib.org, System Identification):
//
//   Simple    V = kS·sgn(v) + kV·v + kA·a
//   Elevator  V = kG + kS·sgn(v) + kV·v + kA·a
//   Arm       V = kG·cos(θ) + kS·sgn(v) + kV·v + kA·a
//
// El ajuste es OLS sobre la forma CONTINUA (la que documenta WPILib); la
// aceleración sale de derivar la velocidad por diferencias centradas.

import { solveOls, OlsResult, POOR_CONDITIONING } from "./ols"

export type MechanismType = "simple" | "elevator" | "arm"

export const MECHANISM_LABELS: Record<MechanismType, string> = {
  simple: "Simple motor (drivetrain, flywheel, turret)",
  elevator: "Elevator (constant gravity)",
  arm: "Arm (gravity varies with angle)",
}

/** Los cuatro tests estándar de SysId. */
export type SysIdTestType =
  | "quasistatic-forward"
  | "quasistatic-backward"
  | "dynamic-forward"
  | "dynamic-backward"

export const TEST_LABELS: Record<SysIdTestType, string> = {
  "quasistatic-forward": "Quasistatic forward",
  "quasistatic-backward": "Quasistatic backward",
  "dynamic-forward": "Dynamic forward",
  "dynamic-backward": "Dynamic backward",
}

export const ALL_TESTS: SysIdTestType[] = [
  "quasistatic-forward",
  "quasistatic-backward",
  "dynamic-forward",
  "dynamic-backward",
]

/** Una muestra sincronizada de un test. */
export interface SysIdSample {
  /** Segundos. */
  t: number
  /** Voltios aplicados al motor. */
  voltage: number
  /** Posición (m o rad). Solo la usa el modelo de brazo. */
  position: number
  /** Velocidad (m/s o rad/s). */
  velocity: number
}

export interface SysIdTestRun {
  type: SysIdTestType
  samples: SysIdSample[]
}

export interface FeedforwardGains {
  kS: number
  kV: number
  kA: number
  /** Solo en elevator y arm. */
  kG?: number
}

export interface FeedforwardFit {
  mechanism: MechanismType
  gains: FeedforwardGains
  rSquared: number
  rmse: number
  sampleCount: number
  /** Avisos que NO invalidan el ajuste pero lo vuelven sospechoso. */
  warnings: string[]
}

/**
 * Velocidad mínima para considerar que el mecanismo se está moviendo.
 * Con el mecanismo quieto, sgn(v) salta entre -1 y 1 por ruido y arruina la
 * estimación de kS; SysId descarta esas muestras por el mismo motivo.
 */
const MOVING_THRESHOLD = 1e-4

/** Aceleración por diferencias centradas sobre la velocidad. */
export function accelerationOf(samples: SysIdSample[]): number[] {
  const out: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)]
    const next = samples[Math.min(samples.length - 1, i + 1)]
    const dt = next.t - prev.t
    out.push(dt > 0 ? (next.velocity - prev.velocity) / dt : 0)
  }
  return out
}

export const TEST_COLORS: Record<SysIdTestType, string> = {
  "quasistatic-forward": "#2f6fdb",
  "quasistatic-backward": "#4db8d8",
  "dynamic-forward": "#d65c5c",
  "dynamic-backward": "#e08a3c",
}

/** Columnas de la matriz de diseño para cada tipo de mecanismo. */
function designRow(
  mechanism: MechanismType,
  sample: SysIdSample,
  accel: number,
): number[] {
  const sgn = Math.sign(sample.velocity)
  switch (mechanism) {
    case "simple":
      return [sgn, sample.velocity, accel]
    case "elevator":
      // La gravedad en un elevador es constante, así que entra como término
      // independiente.
      return [1, sgn, sample.velocity, accel]
    case "arm":
      // En un brazo la gravedad depende del ángulo: cos(θ) medido desde la
      // horizontal.
      return [Math.cos(sample.position), sgn, sample.velocity, accel]
  }
}

function gainsFrom(mechanism: MechanismType, coefficients: number[]): FeedforwardGains {
  if (mechanism === "simple") {
    const [kS, kV, kA] = coefficients
    return { kS, kV, kA }
  }
  const [kG, kS, kV, kA] = coefficients
  return { kG, kS, kV, kA }
}

/**
 * Ajusta los gains a partir de las corridas. Se le pasan TODAS juntas porque
 * cada una aporta una parte distinta de la información: las cuasi-estáticas
 * fijan kS y kV (aceleración ~0) y las dinámicas fijan kA.
 */
export function fitFeedforward(
  mechanism: MechanismType,
  runs: SysIdTestRun[],
): FeedforwardFit | null {
  const x: number[][] = []
  const y: number[] = []
  let discardedStill = 0

  for (const run of runs) {
    if (run.samples.length < 3) continue
    const accel = accelerationOf(run.samples)
    run.samples.forEach((sample, i) => {
      if (!isFinite(sample.voltage) || !isFinite(sample.velocity)) return
      // Muestras con el mecanismo quieto: sgn(v) es ruido puro ahí.
      if (Math.abs(sample.velocity) < MOVING_THRESHOLD) { discardedStill++; return }
      x.push(designRow(mechanism, sample, accel[i]))
      y.push(sample.voltage)
    })
  }

  const result = solveOls(x, y)
  if (result === null) return null

  return {
    mechanism,
    gains: gainsFrom(mechanism, result.coefficients),
    rSquared: result.rSquared,
    rmse: result.rmse,
    sampleCount: result.count,
    warnings: buildWarnings(mechanism, runs, result, discardedStill),
  }
}

// Un ajuste puede "cerrar" numéricamente y aun así ser inservible. Estos son
// los casos que más se ven en la práctica.
function buildWarnings(
  mechanism: MechanismType,
  runs: SysIdTestRun[],
  result: OlsResult,
  discardedStill: number,
): string[] {
  const warnings: string[] = []
  const present = new Set(runs.filter(r => r.samples.length >= 3).map(r => r.type))

  for (const test of ALL_TESTS) {
    if (!present.has(test)) warnings.push(`Missing ${TEST_LABELS[test]} — gains will be biased.`)
  }

  const gains = gainsFrom(mechanism, result.coefficients)
  if (gains.kV <= 0) warnings.push("kV is not positive: check the sign of velocity vs voltage.")
  if (gains.kA <= 0) warnings.push("kA is not positive: the dynamic tests may be too short to see acceleration.")
  if (gains.kS < 0) warnings.push("kS is negative, which is not physical.")
  if (result.rSquared < 0.9) warnings.push(`Low fit quality (R² = ${result.rSquared.toFixed(3)}).`)
  // Va con su propio aviso porque el R² NO lo delata: un sistema casi
  // singular ajusta los datos perfecto y aun así reparte mal los gains.
  if (result.conditioning < POOR_CONDITIONING) {
    warnings.push(
      "Terms are nearly indistinguishable — the tests do not separate kS from kA. " +
      "Run both the quasistatic and the dynamic tests.",
    )
  }
  if (result.count < 100) warnings.push(`Only ${result.count} usable samples.`)
  if (discardedStill > result.count) {
    warnings.push("Most samples had the mechanism stopped; the tests may not have moved it.")
  }

  return warnings
}

/** Una muestra con lo medido y lo que el modelo ajustado predice. */
export interface DiagnosticPoint {
  measured: number
  predicted: number
  velocity: number
  /** medido − predicho, en voltios. */
  residual: number
}

export interface RunDiagnostics {
  type: SysIdTestType
  points: DiagnosticPoint[]
}

/** Voltaje que predice el modelo para una muestra dada. */
export function predictVoltage(
  mechanism: MechanismType,
  gains: FeedforwardGains,
  sample: SysIdSample,
  accel: number,
): number {
  const row = designRow(mechanism, sample, accel)
  const coefficients = mechanism === "simple"
    ? [gains.kS, gains.kV, gains.kA]
    : [gains.kG ?? 0, gains.kS, gains.kV, gains.kA]
  return row.reduce((sum, term, i) => sum + term * coefficients[i], 0)
}

/**
 * Compara medido contra predicho muestra a muestra. Es lo que convierte un R²
 * en algo accionable: un número alto puede tapar que UNA de las cuatro
 * corridas se desvía, y en el gráfico eso salta a la vista.
 *
 * Descarta exactamente las mismas muestras que el ajuste (las que tienen el
 * mecanismo quieto), o el gráfico mostraría puntos que nunca participaron.
 */
export function buildDiagnostics(
  mechanism: MechanismType,
  gains: FeedforwardGains,
  runs: SysIdTestRun[],
): RunDiagnostics[] {
  const out: RunDiagnostics[] = []

  for (const run of runs) {
    if (run.samples.length < 3) continue
    const accel = accelerationOf(run.samples)
    const points: DiagnosticPoint[] = []

    run.samples.forEach((sample, i) => {
      if (!isFinite(sample.voltage) || !isFinite(sample.velocity)) return
      if (Math.abs(sample.velocity) < MOVING_THRESHOLD) return
      const predicted = predictVoltage(mechanism, gains, sample, accel[i])
      if (!isFinite(predicted)) return
      points.push({
        measured: sample.voltage,
        predicted,
        velocity: sample.velocity,
        residual: sample.voltage - predicted,
      })
    })

    if (points.length > 0) out.push({ type: run.type, points })
  }

  return out
}

/**
 * Empareja voltaje, posición y velocidad en una sola grilla temporal.
 * Los tres topics se publican por separado y casi nunca comparten timestamps,
 * así que se toma el de voltaje como referencia y se interpolan los otros.
 */
export function buildSamples(
  voltage: { t: number; v: number }[],
  position: { t: number; v: number }[],
  velocity: { t: number; v: number }[],
): SysIdSample[] {
  const out: SysIdSample[] = []
  for (const p of voltage) {
    const pos = interpolate(position, p.t)
    const vel = interpolate(velocity, p.t)
    if (vel === null) continue
    out.push({ t: p.t, voltage: p.v, position: pos ?? 0, velocity: vel })
  }
  return out
}

function interpolate(points: { t: number; v: number }[], t: number): number | null {
  if (points.length === 0) return null
  if (t < points[0].t || t > points[points.length - 1].t) return null
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const p0 = points[i - 1]
      const p1 = points[i]
      const span = p1.t - p0.t
      return span > 0 ? p0.v + (p1.v - p0.v) * ((t - p0.t) / span) : p0.v
    }
  }
  return points[points.length - 1].v
}
