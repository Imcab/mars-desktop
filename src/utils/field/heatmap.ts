// Mapa de calor de la cancha: dónde estuvo un objeto y cuánto tiempo.
//
// La grilla se llena de forma INCREMENTAL. El historial solo crece, así que
// cada frame se salpican únicamente las muestras nuevas; recalcular las
// 30 000 desde cero a 30 fps no daría. Si cambian el encuadre o los
// parámetros, la firma cambia y el llamador tira este objeto y crea otro.

/** En qué marco vive la grilla: el interno, con el origen en el centro. */
export interface HeatmapFrame {
  /** Largo y ancho del área de juego, en metros. */
  sizeMeters: [number, number]
  /** Lado de la celda, en metros. */
  cell: number
  /** Radio de influencia de cada muestra, en metros. */
  radius: number
}

// Paradas del degradado, de frío a caliente. Es la rampa clásica de los mapas
// de calor: el ojo lee de un vistazo dónde está el máximo sin leer una escala.
const RAMP: [number, [number, number, number]][] = [
  [0.00, [43, 63, 176]],
  [0.28, [31, 158, 201]],
  [0.52, [47, 191, 95]],
  [0.76, [227, 197, 58]],
  [1.00, [214, 59, 59]],
]

/** Alfa máximo del mapa: por encima de esto tapa la foto de la cancha. */
const MAX_ALPHA = 0.82
/** Levanta los valores bajos, que si no quedan invisibles junto a un pico. */
const GAMMA = 0.62

export class Heatmap {
  readonly signature: string
  private cols: number
  private rows: number
  private cell: number
  private halfL: number
  private halfW: number
  private grid: Float32Array
  private kernel: Float32Array
  private kernelRadius: number
  private max = 0
  /** Cuántas muestras del historial ya entraron a la grilla. */
  consumed = 0
  private image: HTMLCanvasElement | null = null
  private imageVersion = -1
  private version = 0

  constructor(frame: HeatmapFrame) {
    // La celda se acota por abajo: 0.02 m sobre una cancha de 16 m son 800
    // columnas, y el salpicado pasa a costar más que el resto del dibujo.
    this.cell = Math.max(0.05, frame.cell)
    this.halfL = frame.sizeMeters[0] / 2
    this.halfW = frame.sizeMeters[1] / 2
    this.cols = Math.max(1, Math.ceil(frame.sizeMeters[0] / this.cell))
    this.rows = Math.max(1, Math.ceil(frame.sizeMeters[1] / this.cell))
    this.grid = new Float32Array(this.cols * this.rows)

    const radius = Math.max(this.cell, frame.radius)
    this.kernelRadius = Math.min(24, Math.ceil(radius / this.cell))
    this.kernel = buildKernel(this.kernelRadius)

    this.signature = signatureOf(frame)
  }

  /** Salpica muestras ya convertidas al marco interno. */
  add(points: { x: number; y: number }[]): void {
    if (points.length === 0) return
    const { cols, rows, cell, halfL, halfW, kernel, kernelRadius: k } = this
    const side = 2 * k + 1

    for (const p of points) {
      const col = Math.floor((p.x + halfL) / cell)
      const row = Math.floor((halfW - p.y) / cell)
      // Una pose fuera del área de juego (aún no hay odometría, o el sistema
      // de coordenadas está mal elegido) no se recorta contra el borde: se
      // ignora, para no dejar una banda caliente pegada a la pared.
      if (col < -k || col > cols + k || row < -k || row > rows + k) continue

      for (let dy = -k; dy <= k; dy++) {
        const r = row + dy
        if (r < 0 || r >= rows) continue
        const rowBase = r * cols
        const kernelBase = (dy + k) * side + k
        for (let dx = -k; dx <= k; dx++) {
          const c = col + dx
          if (c < 0 || c >= cols) continue
          const weight = kernel[kernelBase + dx]
          if (weight === 0) continue
          const next = this.grid[rowBase + c] + weight
          this.grid[rowBase + c] = next
          if (next > this.max) this.max = next
        }
      }
    }
    this.version++
  }

  reset(): void {
    this.grid.fill(0)
    this.max = 0
    this.consumed = 0
    this.version++
  }

  get isEmpty(): boolean {
    return this.max === 0
  }

  /**
   * La grilla pintada, un píxel por celda. El llamador la estira sobre el área
   * de juego con `imageSmoothingEnabled`, que es lo que le da el difuminado.
   */
  toCanvas(): HTMLCanvasElement | null {
    if (this.max === 0) return null
    if (this.image && this.imageVersion === this.version) return this.image

    const canvas = this.image ?? document.createElement("canvas")
    canvas.width = this.cols
    canvas.height = this.rows
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    const data = ctx.createImageData(this.cols, this.rows)
    const pixels = data.data
    for (let i = 0; i < this.grid.length; i++) {
      const raw = this.grid[i]
      if (raw === 0) continue
      const t = Math.pow(Math.min(1, raw / this.max), GAMMA)
      const [r, g, b] = sampleRamp(t)
      const o = i * 4
      pixels[o] = r
      pixels[o + 1] = g
      pixels[o + 2] = b
      // El alfa sube con el valor: las zonas por las que apenas pasó se
      // desvanecen sobre la cancha en vez de taparla con un azul plano.
      pixels[o + 3] = Math.round(255 * MAX_ALPHA * Math.min(1, t * 1.6))
    }
    ctx.putImageData(data, 0, 0)

    this.image = canvas
    this.imageVersion = this.version
    return canvas
  }
}

export function signatureOf(frame: HeatmapFrame): string {
  return [
    frame.sizeMeters[0].toFixed(3),
    frame.sizeMeters[1].toFixed(3),
    frame.cell.toFixed(3),
    frame.radius.toFixed(3),
  ].join("|")
}

/** Gaussiana truncada en `k` celdas, normalizada a 1 en el centro. */
function buildKernel(k: number): Float32Array {
  const side = 2 * k + 1
  const out = new Float32Array(side * side)
  // σ = k/2 deja la campana casi apagada (≈2σ) justo en el borde del radio.
  const sigma = Math.max(0.5, k / 2)
  const twoSigmaSq = 2 * sigma * sigma
  for (let dy = -k; dy <= k; dy++) {
    for (let dx = -k; dx <= k; dx++) {
      const d2 = dx * dx + dy * dy
      out[(dy + k) * side + (dx + k)] = d2 > k * k ? 0 : Math.exp(-d2 / twoSigmaSq)
    }
  }
  return out
}

function sampleRamp(t: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const [stop, color] = RAMP[i]
    if (t > stop) continue
    const [prevStop, prevColor] = RAMP[i - 1]
    const span = stop - prevStop
    const f = span === 0 ? 0 : (t - prevStop) / span
    return [
      Math.round(prevColor[0] + (color[0] - prevColor[0]) * f),
      Math.round(prevColor[1] + (color[1] - prevColor[1]) * f),
      Math.round(prevColor[2] + (color[2] - prevColor[2]) * f),
    ]
  }
  return RAMP[RAMP.length - 1][1]
}
