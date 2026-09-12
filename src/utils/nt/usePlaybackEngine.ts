import { useEffect, useRef } from "react"
import { useSelectionStore } from "../../store/selectionStore"

/**
 * Avanza `selectedTime` en tiempo real mientras `isPlaying` esté activo.
 *
 * Se apoya en performance.now() y no en un contador de frames: si el navegador
 * baja a 30fps (pestaña de fondo, canvas pesado) la reproducción tiene que
 * seguir yendo a la velocidad de reloj, no a la mitad.
 */
export function usePlaybackEngine(getEndUs: () => number | null) {
  const isPlaying = useSelectionStore(s => s.isPlaying)
  const playbackSpeed = useSelectionStore(s => s.playbackSpeed)

  // Los getters se leen en cada frame para no reiniciar el rAF en cada cambio
  // de velocidad o de fin de datos.
  const latest = useRef({ getEndUs, playbackSpeed })
  useEffect(() => { latest.current = { getEndUs, playbackSpeed } })

  useEffect(() => {
    if (!isPlaying) return

    let raf: number | null = null
    let lastPerf = performance.now()

    const step = () => {
      const now = performance.now()
      const elapsedUs = (now - lastPerf) * 1000 * latest.current.playbackSpeed
      lastPerf = now

      const state = useSelectionStore.getState()
      if (!state.isPlaying) return

      const current = state.selectedTime
      if (current === null) {
        useSelectionStore.getState().stop()
        return
      }

      const endUs = latest.current.getEndUs()
      const next = current + elapsedUs

      // Al llegar al final de los datos se corta sola. En vivo el final se
      // corre solo, así que esto solo dispara con un log: seguir avanzando
      // sobre una zona sin datos dejaría el cursor en el vacío.
      if (endUs !== null && next >= endUs) {
        useSelectionStore.getState().scrubTo(endUs)
        useSelectionStore.getState().stop()
        return
      }

      useSelectionStore.getState().scrubTo(next)
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => { if (raf !== null) cancelAnimationFrame(raf) }
  }, [isPlaying])
}
