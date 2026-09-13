import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useSelectionStore } from "../../store/selectionStore"
import { useNTTick } from "./useNTTick"

/**
 * Reemplazo directo de los polls manuales que tenías en DisplayPage.tsx y
 * TelemetryPage.tsx. Devuelve el mapa { topicName -> NTValue } correcto
 * para el instante actual (en vivo o pausado), sin que el componente tenga
 * que saber cuál de los dos casos está pasando.
 */
export function useNTSnapshot(topicNames: string[], intervalMs: number): Record<string, any> {
  const isLive = useSelectionStore((s) => s.isLive)
  const tick = useNTTick(intervalMs)
  const [values, setValues] = useState<Record<string, any>>({})

  // topicKey estable para no re-disparar el efecto si el array cambia de
  // referencia pero no de contenido (ej. widgets.map en cada render).
  const topicKey = topicNames.slice().sort().join("|")

  useEffect(() => {
    if (tick === null || topicNames.length === 0) return
    let cancelled = false

    const cmd = isLive ? "get_live_values" : "get_values_at"
    const args = isLive
      ? { topicNames }
      : { topicNames, timestamp: tick }

    invoke(cmd, args)
      .then((data) => { if (!cancelled) setValues(data as Record<string, any>) })
      .catch(() => { /* silencioso: puede pasar mientras se reconecta */ })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, topicKey, isLive])

  return values
}