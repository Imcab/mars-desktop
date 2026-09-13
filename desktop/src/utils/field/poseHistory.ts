// Historial de poses por objeto, en el marco EN QUE PUBLICA EL ROBOT.
//
// De acá salen las estelas y los mapas de calor. Se guarda el dato crudo y no
// el ya convertido al marco interno a propósito: cambiar la cancha, el sistema
// de coordenadas o la vista de alianza remapea todo el historial en el
// siguiente dibujo, en vez de dejar una estela que quedó pegada al encuadre
// viejo.
//
// No hay logs de por medio: esto se llena con lo que va llegando por NT
// mientras la pestaña está abierta, y se puede vaciar a mano.

import { FieldPose } from "./poseExtraction"

export interface PoseSample {
  x: number
  y: number
  theta: number
  /** Milisegundos de reloj de pared (Date.now()). */
  t: number
}

/** Techo duro de muestras por objeto: ~25 min a 20 Hz. */
const MAX_SAMPLES = 30000
/** Cuántas se tiran de golpe al llegar al techo (un shift por muestra sería O(n²)). */
const DROP_CHUNK = 5000
/** Período mínimo entre muestras. Por encima de esto el poll solo repite dato. */
const MIN_PERIOD_MS = 45
/** Un objeto con más poses que esto es un camino, no algo que deje estela. */
const MAX_TRACKED_POSES = 4

export class PoseHistory {
  private samples: PoseSample[] = []
  /** Sube con cada muestra aceptada; sirve para invalidar caches derivadas. */
  version = 0

  push(poses: FieldPose[], t: number): void {
    if (poses.length === 0 || poses.length > MAX_TRACKED_POSES) return

    const last = this.samples[this.samples.length - 1]
    if (last && t - last.t < MIN_PERIOD_MS) return

    let added = false
    for (const pose of poses) {
      if (!isFinite(pose.x) || !isFinite(pose.y)) continue
      // El poll corre a 30 Hz y el robot puede publicar más lento: sin esto,
      // un valor repetido pesaría en el mapa de calor como si el robot
      // hubiera estado ahí de verdad todo ese rato.
      if (last && last.x === pose.x && last.y === pose.y && last.theta === pose.theta) continue
      this.samples.push({ x: pose.x, y: pose.y, theta: pose.theta, t })
      added = true
    }
    if (!added) return

    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, DROP_CHUNK)
    this.version++
  }

  /** Las muestras de los últimos `seconds`, en orden cronológico. */
  since(seconds: number, now: number): PoseSample[] {
    if (seconds <= 0) return []
    const cutoff = now - seconds * 1000
    // Búsqueda binaria: con 30 000 muestras y 30 fps, recorrer de atrás para
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

  all(): readonly PoseSample[] {
    return this.samples
  }

  /** Se queda con una copia de otro historial (duplicar no debe empezar de cero). */
  adopt(samples: readonly PoseSample[]): void {
    this.samples = samples.slice()
    this.version++
  }

  get length(): number {
    return this.samples.length
  }

  /** Segundos cubiertos por lo acumulado. */
  get spanSeconds(): number {
    if (this.samples.length < 2) return 0
    return (this.samples[this.samples.length - 1].t - this.samples[0].t) / 1000
  }

  clear(): void {
    this.samples = []
    this.version++
  }
}

/** Un historial por objeto, con limpieza de los que ya no están en la lista. */
export class HistoryStore {
  private byId = new Map<string, PoseHistory>()

  get(id: string): PoseHistory {
    let hit = this.byId.get(id)
    if (!hit) {
      hit = new PoseHistory()
      this.byId.set(id, hit)
    }
    return hit
  }

  /** Descarta el historial de los objetos que se quitaron del panel. */
  prune(aliveIds: Iterable<string>): void {
    const alive = new Set(aliveIds)
    for (const id of Array.from(this.byId.keys())) {
      if (!alive.has(id)) this.byId.delete(id)
    }
  }

  clear(id?: string): void {
    if (id === undefined) this.byId.forEach(h => h.clear())
    else this.byId.get(id)?.clear()
  }

  /**
   * Copia lo acumulado de un objeto al nuevo que lo duplica.
   *
   * Sin esto, duplicar el robot para verlo como mapa de calor arrancaría el
   * mapa vacío aunque el original llevara media práctica juntando muestras,
   * que es justo lo que uno quiere mirar.
   */
  copy(fromId: string, toId: string): void {
    const source = this.byId.get(fromId)
    if (!source) return
    this.get(toId).adopt(source.all())
  }
}
