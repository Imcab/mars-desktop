import React, { useMemo, useState } from "react"
import { TopicAnnounce, FunctionSeriesConfig } from "../store/appStore"
import { useSelectionStore } from "../store/selectionStore"
import { classifyTopic } from "../utils/dashboard/topicClassification"
import TreeDirectory from "../components/dashboard/TreeDirectory"
import GraphCanvas, { PlottedSeries } from "../components/dashboard/functions/GraphCanvas"
import SeriesPanel from "../components/dashboard/functions/SeriesPanel"
import { useLiveSeriesBuffers } from "../utils/functions/useLiveSeriesBuffers"
import { applyTransform, TimeSeriesPoint } from "../utils/functions/mathTransforms"
import { detectUnitSuffix } from "../utils/functions/units"
import { combineSeries, buildErrorBand } from "../utils/functions/seriesAlgebra"

interface Props {
  topics: Map<string, TopicAnnounce>
  series: FunctionSeriesConfig[]
  onAddSeries: (s: Omit<FunctionSeriesConfig, "id">) => void
  onRemoveSeries: (id: string) => void
  onUpdateSeries: (id: string, updates: Partial<FunctionSeriesConfig>) => void
}

const LINE_COLORS = ["#6262f1", "#d65c5c", "#6c9c6c", "#d4a94a", "#4db8d8", "#c76fd1", "#e08a3c", "#5ecbb0"]
const WINDOW_OPTIONS = [5, 10, 30, 60]

export default function FunctionPage({ topics, series, onAddSeries, onRemoveSeries, onUpdateSeries }: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [windowSeconds, setWindowSeconds] = useState(10)

  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)

  // NOTA: useLiveSeriesBuffers todavía no la tengo a la vista, así que no
  // puedo confirmar/ajustar acá adentro si ya respeta isLive/selectedTime
  // (usando get_values_range para reconstruir la ventana cuando está
  // pausado, como dice el comentario de ese comando en commands.rs) o si
  // todavía acumula solo en vivo como el poll viejo de DisplayPage. Pasame
  // ese archivo (y GraphCanvas.tsx si el cursor de tiempo se dibuja ahí) y
  // lo conecto igual que a DisplayPage.
  const buffers = useLiveSeriesBuffers(series, windowSeconds)

  const plotted: PlottedSeries[] = useMemo(() => {
    // Paso 1: puntos base de cada serie = buffer crudo del topic + su propio
    // transform (raw/integral/derivada), igual que antes.
    const basePoints: Record<string, TimeSeriesPoint[]> = {}
    series.forEach(s => {
      basePoints[s.id] = applyTransform(buffers[s.topicName] ?? [], s.transform)
    })

    // Paso 2: álgebra entre series (A op B), aplicada sobre los puntos ya
    // transformados de cada una. Si la serie con la que se combina no existe
    // más (fue borrada), se ignora el combine silenciosamente.
    const finalPoints: Record<string, TimeSeriesPoint[]> = {}
    series.forEach(s => {
      if (s.combine && basePoints[s.combine.withSeriesId]) {
        finalPoints[s.id] = combineSeries(basePoints[s.id], basePoints[s.combine.withSeriesId], s.combine.operator)
      } else {
        finalPoints[s.id] = basePoints[s.id]
      }
    })

    // Paso 3: arma el resultado final por serie, agregando la banda de error
    // (target vs actual) cuando corresponde, ya alineada en el tiempo.
    return series.map(s => {
      const points = finalPoints[s.id] ?? []
      const targetPoints = s.errorTargetId ? finalPoints[s.errorTargetId] : undefined
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        axis: s.axis,
        unit: detectUnitSuffix(s.topicName),
        points,
        errorBand: targetPoints ? buildErrorBand(points, targetPoints) : undefined,
      }
    })
  }, [series, buffers])

  const leftCount = series.filter(s => s.axis === "left").length
  const rightCount = series.filter(s => s.axis === "right").length

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    if (!isDragOver) setIsDragOver(true)
  }
  const handleDragLeave = () => setIsDragOver(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const topicName = e.dataTransfer.getData("topicName")
    const topicType = e.dataTransfer.getData("topicType")
    if (!topicName) return

    // Doble candado: el Tree ya solo deja arrastrar doubles (dragFilter),
    // pero validamos de nuevo acá por si el drop viene de otro origen.
    if (!classifyTopic(topicType).isNumber) return
    if (series.some(s => s.topicName === topicName)) return // ya está graficado

    const parts = topicName.split("/").filter(Boolean)
    const label = parts.length > 0 ? parts[parts.length - 1] : topicName
    const usedColors = new Set(series.map(s => s.color))
    const color = LINE_COLORS.find(c => !usedColors.has(c)) ?? LINE_COLORS[series.length % LINE_COLORS.length]

    onAddSeries({ topicName, label, color, transform: "raw", axis: "left" })
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR: DATA DIRECTORY, solo doubles arrastrables */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            NetworkTables 4
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            Data Directory
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            Only numeric (double) values can be plotted here
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          <TreeDirectory topics={topics} dragFilter={(t) => classifyTopic(t.topic_type).isNumber} />
        </div>
      </div>

      {/* MAIN: GRAFICA + PANEL DE SERIES */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Function Plot</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {series.length} series ({leftCount} left / {rightCount} right) · drag a double from the directory onto the plot
          </span>

          {/* Mismo indicador que en DisplayPage y en la timeline: en pausa,
              la ventana que se dibuja debería anclar al instante scrubbeado
              en vez de a "ahora" (pendiente de useLiveSeriesBuffers). */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isLive ? "var(--status-sim)" : "var(--mars-red)"
              }}
            />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: "rgba(255,255,255,0.55)", fontFamily: "monospace" }}>
              {isLive ? "LIVE" : "VIEWING HISTORY"}
            </span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>WINDOW</span>
            <select
              value={windowSeconds}
              onChange={e => setWindowSeconds(parseInt(e.target.value))}
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "3px 6px", borderRadius: 2, fontSize: 11 }}
            >
              {WINDOW_OPTIONS.map(w => <option key={w} value={w}>{w}s</option>)}
            </select>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              flex: 1, position: "relative", padding: 12, boxSizing: "border-box",
              background: isDragOver ? "var(--bg-panel)" : "var(--bg-page)",
              border: isDragOver ? "1px dashed var(--mars-red)" : "1px solid transparent",
            }}
          >
            <GraphCanvas series={plotted} windowSeconds={windowSeconds} isLive={isLive} selectedTime={selectedTime} />
          </div>

          <div style={{ width: 280, borderLeft: "1px solid var(--border-main)", background: "var(--bg-panel)", flexShrink: 0, overflowY: "auto" }}>
            <SeriesPanel series={series} onUpdate={onUpdateSeries} onRemove={onRemoveSeries} />
          </div>
        </div>
      </div>
    </div>
  )
}