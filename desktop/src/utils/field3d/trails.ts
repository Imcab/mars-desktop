// Estelas del Field 3D: por dónde pasó cada objeto en los últimos segundos.
//
// Se guarda el punto YA CONVERTIDO al marco del modelo, al revés que el
// historial del visualizador 2D (que guarda el dato crudo). Acá la conversión
// depende de la alianza y del sistema de coordenadas, que en medio de un match
// no cambian; y la estela se dibuja como una tira de vértices que se sube a la
// GPU tal cual, así que tenerla ya en coordenadas de escena evita rehacer la
// conversión de cientos de puntos en cada frame.
//
// No hay logs de por medio: esto se llena con lo que va llegando por NT
// mientras la pestaña está abierta, y se puede vaciar a mano.

export interface TrailSample {
  x: number
  y: number
  z: number
  /** Milisegundos de reloj de pared (Date.now()). */
  t: number
}

/** Techo duro de muestras por objeto: ~8 min a 60 Hz. */
const MAX_SAMPLES = 30000
/** Cuántas se tiran de golpe al llegar al techo (un shift por muestra sería O(n²)). */
const DROP_CHUNK = 5000
/** Período mínimo entre muestras. Por encima de esto el poll solo repite dato. */
const MIN_PERIOD_MS = 30
/** Movimiento mínimo para anotar un punto nuevo, en metros. */
const MIN_STEP_M = 0.005

export class Trail {
  private samples: TrailSample[] = []

  push(x: number, y: number, z: number, t: number): void {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return

    const last = this.samples[this.samples.length - 1]
    if (last) {
      if (t - last.t < MIN_PERIOD_MS) return
      // El robot quieto en la línea de salida llenaría el buffer de puntos
      // idénticos y dejaría fuera el recorrido que sí interesa.
      const moved = Math.hypot(x - last.x, y - last.y, z - last.z)
      if (moved < MIN_STEP_M) return
    }

    this.samples.push({ x, y, z, t })
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, DROP_CHUNK)
  }

  /** Las muestras de los últimos `seconds`, en orden cronológico. */
  since(seconds: number, now: number): TrailSample[] {
    if (seconds <= 0) return []
    const cutoff = now - seconds * 1000

    // Búsqueda binaria: con 30 000 muestras y 60 fps, recorrer de atrás para
    // adelante en cada frame se nota.
    let lo = 0
    let hi = this.samples.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.samples[mid].t < cutoff) lo = mid + 1
      else hi = mid
    }
    return this.samples.slice(lo)
  }

  get length(): number {
    return this.samples.length
  }

  /** Se queda con una copia de otra estela (duplicar no debe empezar de cero). */
  adopt(samples: readonly TrailSample[]): void {
    this.samples = samples.slice()
  }

  all(): readonly TrailSample[] {
    return this.samples
  }

  clear(): void {
    this.samples = []
  }
}

/** Una estela por objeto, con limpieza de los que ya no están en la lista. */
export class TrailStore {
  private byId = new Map<string, Trail>()

  get(id: string): Trail {
    let hit = this.byId.get(id)
    if (!hit) {
      hit = new Trail()
      this.byId.set(id, hit)
    }
    return hit
  }

  /** Descarta la estela de los objetos que se quitaron del panel. */
  prune(aliveIds: Iterable<string>): void {
    const alive = new Set(aliveIds)
    for (const id of Array.from(this.byId.keys())) {
      if (!alive.has(id)) this.byId.delete(id)
    }
  }

  /** Copia lo acumulado al objeto que duplica a otro. */
  copy(fromId: string, toId: string): void {
    const source = this.byId.get(fromId)
    if (source) this.get(toId).adopt(source.all())
  }

  clear(id?: string): void {
    if (id === undefined) this.byId.forEach(trail => trail.clear())
    else this.byId.get(id)?.clear()
  }

  count(id: string): number {
    return this.byId.get(id)?.length ?? 0
  }
}
