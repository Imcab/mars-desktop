import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"

interface TimeBounds { start: number | null; end: number | null }

/**
 * Única fuente de verdad del reloj de datos. Consulta a Rust el rango REAL
 * de timestamps del buffer (NTBuffer.start_time / end_time) — nunca el
 * reloj del navegador. Esto es lo que hace que el timeline muestre el
 * tiempo real de conexión (sobrevive a remounts, no se desincroniza si el
 * reloj del cliente difiere del de la fuente NT).
 *
 * Entre cada poll, interpola con performance.now() para que el marcador
 * "LIVE" siga avanzando suave en vez de saltar a trompicones cada 200ms.
 */
export function useNTLiveClock(pollMs = 200) {
  const [bounds, setBounds] = useState<TimeBounds>({ start: null, end: null })
  const lastPollPerfRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const data = await invoke<TimeBounds>("get_time_bounds")
        if (!cancelled) {
          setBounds(data)
          lastPollPerfRef.current = performance.now()
        }
      } catch { /* backend puede no estar listo aún, se reintenta */ }
      if (!cancelled) setTimeout(poll, pollMs)
    }
    poll()
    return () => { cancelled = true }
  }, [pollMs])

  /** "Ahora" estimado en microsegundos, interpolado suavemente entre polls. */
  const getEstimatedNowUs = (): number | null => {
    if (bounds.end === null) return null
    const elapsedSincePollMs = performance.now() - lastPollPerfRef.current
    return bounds.end + elapsedSincePollMs * 1000
  }

  return { startUs: bounds.start, endUs: bounds.end, getEstimatedNowUs }
}