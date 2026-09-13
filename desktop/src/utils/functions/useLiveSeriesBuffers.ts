import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { FunctionSeriesConfig } from "../../store/appStore"
import { useSelectionStore } from "../../store/selectionStore"
import { TimeSeriesPoint } from "./mathTransforms"

const REFRESH_INTERVAL_MS = 50 // ~20Hz de REDIBUJO (no de muestreo)

interface TimeBounds { start: number | null; end: number | null }

/**
 * Buffer {t,v} por TOPIC, en SEGUNDOS de la escala del servidor NT.
 *
 * Antes esto acumulaba muestras del lado del cliente con `Date.now()`. Eso
 * traía dos problemas serios:
 *
 *  1. **Dos escalas de tiempo distintas.** En vivo los puntos se guardaban con
 *     epoch Unix (~1.77e9 s) y en pausa con el timestamp del servidor (~1e4 s,
 *     que cuenta desde que arrancó el robot). Al pausar, el eje X saltaba
 *     varios órdenes de magnitud y el gráfico se rompía.
 *  2. **Aliasing.** Pollear "el valor de ahora" a 20Hz sobre una señal que el
 *     robot publica a 200Hz tira 9 de cada 10 muestras, y encima les pone el
 *     timestamp del poll y no el real. Una derivada calculada así es basura.
 *
 * Ahora los dos modos piden `get_values_range` al backend, que devuelve las
 * muestras REALES con sus timestamps reales. En vivo la ventana se ancla al
 * último dato recibido; en pausa, al instante scrubbeado.
 */
export function useLiveSeriesBuffers(series: FunctionSeriesConfig[], windowSeconds: number) {
  const topicNames = Array.from(new Set(series.map(s => s.topicName)))
  const topicKey = topicNames.slice().sort().join("|")

  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)

  const [buffers, setBuffers] = useState<Record<string, TimeSeriesPoint[]>>({})
  // El fin de la ventana en vivo: se relee del backend para no depender del
  // reloj del cliente, que puede diferir del del robot.
  const endUsRef = useRef<number | null>(null)

  useEffect(() => {
    if (topicNames.length === 0) {
      setBuffers({})
      return
    }
    let cancelled = false

    const fetchWindow = async () => {
      if (cancelled) return

      let endUs: number | null
      if (isLive) {
        try {
          const bounds = await invoke<TimeBounds>("get_time_bounds")
          endUs = bounds.end
          endUsRef.current = endUs
        } catch {
          endUs = endUsRef.current
        }
      } else {
        endUs = selectedTime
      }
      if (cancelled || endUs === null) return

      const startUs = Math.max(0, endUs - windowSeconds * 1e6)
      try {
        const data: Record<string, [number, any][]> = await invoke("get_values_range", {
          topicNames,
          start: startUs,
          end: endUs,
        })
        if (cancelled) return

        const next: Record<string, TimeSeriesPoint[]> = {}
        for (const name of topicNames) {
          next[name] = (data[name] ?? [])
            .filter(([, v]) => typeof v?.Number === "number")
            // A segundos: toda la matemática de transforms trabaja en segundos,
            // así que una derivada sale directo en unidades/segundo.
            .map(([ts, v]) => ({ t: ts / 1e6, v: v.Number as number }))
        }
        // Objeto nuevo en cada tick: el padre tiene que ver el cambio de
        // referencia para recalcular los transforms.
        setBuffers(next)
      } catch {
        // Todavía no hay datos en ese rango; se reintenta en el próximo tick.
      }
    }

    fetchWindow()
    // En pausa no hace falta repetir: la ventana solo cambia si el usuario
    // mueve el cursor, y eso vuelve a disparar este efecto.
    if (!isLive) return () => { cancelled = true }

    const interval = setInterval(fetchWindow, REFRESH_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, windowSeconds, isLive, selectedTime])

  return buffers
}
