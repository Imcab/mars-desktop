import { MARS_ENABLED } from "@mars"

// Control de la pantalla de carga que vive en index.html.
//
// El splash lo pinta el HTML (ver el <style> de index.html) porque tiene que
// estar en pantalla ANTES de que el bundle termine de evaluarse. Desde React
// solo queda decirle en qué paso va, cuánto lleva, y al final sacarlo.
//
// La versión anterior era una barra indeterminada y una línea de texto: decía
// "está haciendo algo", que es justo lo que no hace falta saber. Esta enumera
// los pasos REALES del arranque, marca cada uno cuando termina y mueve la
// barra con ellos, así que cuando algo tarda o falla se ve exactamente qué.

const SPLASH_ID = "mars-splash"
const FADE_MS = 300
/** Lo que se sostiene el 100% antes de fundir, para que se llegue a ver. */
const HOLD_MS = 240
/** Si algún paso falló, el splash se queda un momento más para poder leerlo. */
const LINGER_MS = 1800

const $ = (id: string) => document.getElementById(id)

const TODOS_LOS_PASOS = [
  ["prefs", "Read preferences"],
  ["project", "Locate the MARS project"],
  ["assets", "Scan 3D asset packs"],
  ["layout", "Restore the workspace"],
  ["link", "Check the NetworkTables link"],
  ["ui", "Build the interface"],
] as const

export type SplashStepKey = (typeof TODOS_LOS_PASOS)[number][0]

/**
 * Los pasos, en el orden real en que ocurren. La clave la usa SplashProgress.
 *
 * La edición Tools no tiene proyecto que localizar, así que ese paso no se
 * lista: dejarlo saldría siempre en gris y el porcentaje avanzaría a saltos
 * por un paso que no existe.
 */
export const SPLASH_STEPS: readonly (readonly [SplashStepKey, string])[] =
  MARS_ENABLED ? TODOS_LOS_PASOS : TODOS_LOS_PASOS.filter(([k]) => k !== "project")

type Row = { li: HTMLLIElement; mark: HTMLSpanElement; note: HTMLElement }

// StrictMode monta el efecto de arranque dos veces en desarrollo. La segunda
// instancia repinta la lista desde cero, y sin esto la primera seguiría
// escribiendo el porcentaje sobre la misma barra: dos secuencias peleándose.
let active: SplashProgress | null = null

export class SplashProgress {
  private done = 0
  private rows = new Map<string, Row>()
  /** Un paso en rojo cambia cómo se cierra el splash (se queda más tiempo). */
  private broke = false

  constructor() {
    active = this

    const list = $("mars-splash-steps")
    if (!list) return
    list.replaceChildren()

    for (const [key, label] of SPLASH_STEPS) {
      const mark = document.createElement("span")
      mark.className = "mark"
      mark.textContent = "·"
      const text = document.createElement("span")
      text.textContent = label
      const note = document.createElement("em")

      const li = document.createElement("li")
      li.dataset.state = "pending"
      li.append(mark, text, note)
      list.appendChild(li)
      this.rows.set(key, { li, mark, note })
    }
  }

  /** Marca el paso como en curso y lo pone en la línea de estado. */
  start(key: SplashStepKey) {
    if (active !== this) return
    const row = this.rows.get(key)
    if (row) {
      row.li.dataset.state = "running"
      row.mark.textContent = "›"
    }
    const line = $("mars-splash-step")
    if (line) line.textContent = `${labelOf(key)}…`
  }

  /** Lo cierra en verde. `detail` es el resumen corto de lo que encontró. */
  finish(key: SplashStepKey, detail?: string) {
    this.close(key, "ok", "✓", detail)
  }

  /**
   * Lo cierra en gris: el paso no aplicaba (no hay proyecto configurado, por
   * ejemplo). Cuenta para el porcentaje igual, porque ya no queda nada que
   * esperar de él.
   */
  skip(key: SplashStepKey, detail?: string) {
    this.close(key, "skip", "–", detail)
  }

  /**
   * Lo cierra en rojo y deja el error a la vista.
   *
   * A diferencia del Simulation Studio, acá ningún paso es imprescindible: la
   * app abre igual sin preferencias, sin proyecto y sin layout guardado. Por
   * eso un fallo no detiene el arranque, solo se queda escrito.
   */
  fail(key: SplashStepKey, error: unknown) {
    this.broke = true
    this.close(key, "fail", "✕", undefined)
    if (active !== this) return

    const box = $("mars-splash-error")
    if (box) {
      const msg = error instanceof Error ? error.message : String(error)
      box.textContent = box.textContent ? `${box.textContent}\n${labelOf(key)}: ${msg}` : `${labelOf(key)}: ${msg}`
      box.style.display = "block"
    }
  }

  /**
   * Corre un paso: lo marca, espera, y lo cierra en verde o en rojo.
   * Devuelve lo que devolvió `fn`, o `null` si falló.
   */
  async run<T>(key: SplashStepKey, fn: () => Promise<T>, summary?: (result: T) => string): Promise<T | null> {
    this.start(key)
    try {
      const result = await fn()
      this.finish(key, summary?.(result))
      return result
    } catch (e) {
      console.warn(`[splash] ${key}:`, e)
      this.fail(key, e)
      return null
    }
  }

  /** Cierra el último paso y funde el splash. */
  end() {
    this.finish("ui")
    hideSplash(this.broke ? LINGER_MS : HOLD_MS)
  }

  private close(key: SplashStepKey, state: string, mark: string, detail?: string) {
    if (active !== this) return
    const row = this.rows.get(key)
    if (row) {
      row.li.dataset.state = state
      row.mark.textContent = mark
      if (detail) row.note.textContent = detail
    }

    this.done += 1
    const pct = Math.round((this.done / SPLASH_STEPS.length) * 100)
    const fill = $("mars-splash-fill")
    if (fill) fill.style.width = `${pct}%`
    const label = $("mars-splash-pct")
    if (label) label.textContent = `${pct}%`
  }
}

function labelOf(key: SplashStepKey): string {
  return SPLASH_STEPS.find(s => s[0] === key)?.[1] ?? key
}

/**
 * Desvanece el splash y lo saca del DOM.
 *
 * Se llama cuando el workspace terminó de restaurarse, no cuando React montó:
 * si no, se vería un cuadro de app vacía antes de que aparezcan las pestañas
 * guardadas, que es peor que un splash un poco más largo.
 */
export function hideSplash(delayMs = 0) {
  window.setTimeout(() => {
    const splash = $(SPLASH_ID)
    if (!splash) return
    splash.classList.add("mars-splash-out")
    window.setTimeout(() => splash.remove(), FADE_MS)
  }, delayMs)
}
