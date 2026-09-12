// Cinemática directa de un swerve, resuelta por mínimos cuadrados.
//
// Cada módulo en la posición (x_i, y_i) del marco del robot aporta dos
// ecuaciones sobre las incógnitas del chasis (vx, vy, ω):
//
//   vx_i = vx − ω·y_i
//   vy_i = vy + ω·x_i
//
// Con 4 módulos quedan 8 ecuaciones y 3 incógnitas: el sistema está
// sobredeterminado, así que en general NO tiene solución exacta. Eso es
// justamente lo útil: el residuo del ajuste mide cuánto se contradicen los
// módulos entre sí. Si los 4 describen el mismo movimiento de cuerpo rígido
// el residuo es 0; si uno patina, tiene el offset de encoder corrido o el
// radio de rueda mal, ese módulo se despega del ajuste y su residuo sube.

import { ModuleState } from "./swerveExtraction"

export interface ModuleLocation {
  x: number  // m, hacia adelante
  y: number  // m, hacia la izquierda
}

export interface KinematicsSolution {
  vx: number
  vy: number
  omega: number
  /** Vector que CADA módulo debería tener si el ajuste fuera exacto. */
  predicted: { vx: number; vy: number }[]
  /** |medido − predicho| por módulo, en m/s. */
  residuals: number[]
  /** Residuo cuadrático medio, en m/s. */
  rmsResidual: number
}

// Ubicación de los módulos en el orden de dibujo FL, FR, BL, BR.
export function moduleLocations(frameLength: number, frameWidth: number): ModuleLocation[] {
  const halfL = frameLength / 2
  const halfW = frameWidth / 2
  return [
    { x: halfL, y: halfW },    // FL
    { x: halfL, y: -halfW },   // FR
    { x: -halfL, y: halfW },   // BL
    { x: -halfL, y: -halfW },  // BR
  ]
}

// Componentes cartesianas del vector de un módulo, en el marco del robot.
function moduleVector(state: ModuleState): { vx: number; vy: number } {
  return {
    vx: state.speed * Math.cos(state.angle),
    vy: state.speed * Math.sin(state.angle),
  }
}

// Inversa de una matriz simétrica 3x3. Devuelve null si es singular (pasa,
// por ejemplo, si todos los módulos están en el mismo punto).
function invert3x3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0]
  const [d, e, f] = m[1]
  const [g, h, i] = m[2]

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return null

  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

// Resuelve las ecuaciones normales AᵀA·u = Aᵀb.
//
// Para el layout simétrico habitual, AᵀA se vuelve diagonal y esto se reduce a
// promediar los vectores (vx, vy) y a repartir el momento entre los módulos;
// se resuelve el caso general igual, para que siga funcionando con chasis
// asimétricos o con menos de 4 módulos.
export function solveChassis(
  states: ModuleState[],
  locations: ModuleLocation[],
): KinematicsSolution | null {
  const n = Math.min(states.length, locations.length)
  if (n < 2) return null

  let ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  let atb = [0, 0, 0]

  for (let i = 0; i < n; i++) {
    const { x, y } = locations[i]
    const v = moduleVector(states[i])

    // Fila [1, 0, −y] con término independiente vx_i
    ata[0][0] += 1
    ata[0][2] += -y
    ata[2][0] += -y
    ata[2][2] += y * y
    atb[0] += v.vx
    atb[2] += -y * v.vx

    // Fila [0, 1, x] con término independiente vy_i
    ata[1][1] += 1
    ata[1][2] += x
    ata[2][1] += x
    ata[2][2] += x * x
    atb[1] += v.vy
    atb[2] += x * v.vy
  }

  const inv = invert3x3(ata)
  if (!inv) return null

  const vx = inv[0][0] * atb[0] + inv[0][1] * atb[1] + inv[0][2] * atb[2]
  const vy = inv[1][0] * atb[0] + inv[1][1] * atb[1] + inv[1][2] * atb[2]
  const omega = inv[2][0] * atb[0] + inv[2][1] * atb[1] + inv[2][2] * atb[2]

  const predicted: { vx: number; vy: number }[] = []
  const residuals: number[] = []
  let sumSquares = 0

  for (let i = 0; i < n; i++) {
    const { x, y } = locations[i]
    const p = { vx: vx - omega * y, vy: vy + omega * x }
    const m = moduleVector(states[i])
    const residual = Math.hypot(m.vx - p.vx, m.vy - p.vy)

    predicted.push(p)
    residuals.push(residual)
    sumSquares += residual * residual
  }

  return { vx, vy, omega, predicted, residuals, rmsResidual: Math.sqrt(sumSquares / n) }
}

// Centro instantáneo de rotación, en el marco del robot: el punto alrededor
// del cual el chasis está girando en este instante. Para traslación pura
// (ω ≈ 0) se va al infinito, así que no se devuelve nada.
export function computeICR(vx: number, vy: number, omega: number): { x: number; y: number } | null {
  if (Math.abs(omega) < 0.05) return null
  return { x: -vy / omega, y: vx / omega }
}

// Convierte un vector cartesiano del marco del robot a la forma
// (rapidez, ángulo) que usa el renderer de módulos.
export function vectorToModuleState(v: { vx: number; vy: number }): ModuleState {
  return { speed: Math.hypot(v.vx, v.vy), angle: Math.atan2(v.vy, v.vx) }
}

// Lleva un ángulo a (−180, 180]. Los módulos suelen publicar el azimut
// acumulado sin envolver (11246° en vez de 86°): para el dibujo da igual
// porque sin/cos son periódicos, pero para LEERLO no.
export function wrapDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

// Diferencia angular más corta entre dos ángulos, en grados. Sin esto, el
// error entre 179° y −179° daría 358° en vez de 2°.
export function angleErrorDegrees(fromRadians: number, toRadians: number): number {
  const delta = (toRadians - fromRadians) * (180 / Math.PI)
  return wrapDegrees(delta)
}
