import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { FunctionSeriesConfig } from "../../store/appStore"
import { useSelectionStore } from "../../store/selectionStore"
import { TimeSeriesPoint } from "./mathTransforms"

const SAMPLE_INTERVAL_MS = 50 // ~20Hz, mismo espíritu que el polling del canvas de widgets

// Mantiene un buffer {t,v} POR TOPIC (no por serie): si dos series apuntan al
// mismo topic con transforms distintos comparten el mismo polling y buffer crudo.
//
// IMPORTANTE (bug fix previo): el buffer "de trabajo" vive en un useRef (para
// poder mutarlo con push/shift sin recrear arrays en cada poll, que sería caro
// a 20Hz). PERO lo que este hook devuelve hacia afuera es un useState que se
// reemplaza por un objeto NUEVO en cada tick. Si devolviéramos directamente
// buffersRef.current, React vería siempre la MISMA referencia (Object.is no
// detecta la mutación interna) y cualquier useMemo/useEffect que dependa de
// este valor en el componente padre dejaría de recalcularse — quedando
// "congelado" con el snapshot del último cambio real de props, mientras el
// reloj del gráfico sigue avanzando. Eso es lo que causaba el desfase.
//
// CONEXIÓN CON EL TIMELINE:
// - EN VIVO (isLive=true): comportamiento de siempre. Poll a get_live_values
//   cada SAMPLE_INTERVAL_MS, empujando puntos con Date.now() y recortando la
//   ventana contra el reloj de pared.
// - EN PAUSA (isLive=false): dejamos de pollear (no tiene sentido pedir "el
//   valor de ahora" con el timeline detenido) y en su lugar pedimos a
//   get_values_range el tramo [selectedTime - windowSeconds, selectedTime]
//   directamente del buffer real del backend. Así el gráfico muestra
//   exactamente lo que pasó ahí, no lo que se venía acumulando en vivo antes
//   de pausar. Se vuelve a pedir cada vez que selectedTime cambia (scrub) o
//   que cambia windowSeconds.
export function useLiveSeriesBuffers(series: FunctionSeriesConfig[], windowSeconds: number) {
  const topicNames = Array.from(new Set(series.map(s => s.topicName)))
  const topicKey = topicNames.slice().sort().join("|")

  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)

  const buffersRef = useRef<Record<string, TimeSeriesPoint[]>>({})
  const [buffersVersion, setBuffersVersion] = useState<Record<string, TimeSeriesPoint[]>>({})

  useEffect(() => {
    if (topicNames.length === 0) return
    let cancelled = false

    if (isLive) {
      const poll = async () => {
        if (cancelled) return
        try {
          const data: Record<string, any> = await invoke("get_live_values", { topicNames })
          const now = Date.now() / 1000
          const windowStart = now - windowSeconds
          for (const name of topicNames) {
            const raw = data[name]
            const value = typeof raw?.Number === "number" ? raw.Number : undefined
            if (value === undefined) continue
            const buf = buffersRef.current[name] ?? (buffersRef.current[name] = [])
            buf.push({ t: now, v: value })
            while (buf.length > 2 && buf[1].t < windowStart) buf.shift()
          }
          if (!cancelled) {
            // Objeto NUEVO cada tick -> el padre SIEMPRE detecta el cambio y
            // recalcula raw/integral/derivada con datos frescos, en vez de
            // quedarse pegado al snapshot de cuando cambiaste el transform.
            setBuffersVersion({ ...buffersRef.current })
          }
        } catch {
          // El topic todavía no tiene un valor en vivo; se reintenta en el próximo tick.
        }
      }

      poll()
      const interval = setInterval(poll, SAMPLE_INTERVAL_MS)
      return () => { cancelled = true; clearInterval(interval) }
    }

    // ---- PAUSADO: reconstruir la ventana desde el buffer real ----
    if (selectedTime === null) return

    const fetchRange = async () => {
      if (cancelled) return
      const endUs = selectedTime
      const startUs = Math.max(0, endUs - windowSeconds * 1e6)
      try {
        const data: Record<string, [number, any][]> = await invoke("get_values_range", {
          topicNames,
          start: startUs,
          end: endUs,
        })
        if (cancelled) return
        for (const name of topicNames) {
          const points = data[name] ?? []
          buffersRef.current[name] = points
            .filter(([, v]) => typeof v?.Number === "number")
            .map(([ts, v]) => ({ t: ts / 1e6, v: v.Number as number }))
        }
        setBuffersVersion({ ...buffersRef.current })
      } catch {
        // El backend puede no tener datos todavía para ese rango; se
        // reintenta si selectedTime vuelve a cambiar.
      }
    }

    fetchRange()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, windowSeconds, isLive, selectedTime])

  return buffersVersion
}