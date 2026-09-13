import { useEffect, useState } from "react"
import { useSelectionStore } from "../../store/selectionStore"

/**
 * Única fuente de verdad de "cuándo toca releer NetworkTables y con qué
 * timestamp". Nada más en la app debería tener su propio setInterval de
 * polling ni su propio chequeo de isLive — todo se construye sobre este hook.
 *
 * EN VIVO: emite un tick cada `intervalMs` con Date.now() en microsegundos
 *          (mismo formato que usa client.rs / SystemTime en Rust).
 * EN PAUSA: no hay timer corriendo. Solo emite un tick cuando `selectedTime`
 *           cambia (el usuario mueve el cursor de la timeline).
 */
export function useNTTick(intervalMs: number): number | null {
  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)
  const [tick, setTick] = useState<number | null>(null)

  useEffect(() => {
    if (!isLive) {
      setTick(selectedTime)
      return
    }

    let cancelled = false
    const loop = () => {
      if (cancelled) return
      setTick(Date.now() * 1000)
      timeoutId = setTimeout(loop, intervalMs)
    }
    let timeoutId = setTimeout(loop, 0)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [isLive, selectedTime, intervalMs])

  return tick
}