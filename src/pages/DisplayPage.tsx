import React, { useState, useRef, useCallback, useMemo } from "react"
import { TopicAnnounce, DashboardWidget, GRID_CELL, MIN_WIDGET_W, MIN_WIDGET_H } from "../store/appStore"
import { useSelectionStore } from "../store/selectionStore"
import { useNTSnapshot } from "../utils/nt/useNTSnapshot"
import TreeDirectory from "../components/dashboard/TreeDirectory"
import DashboardCard from "../components/dashboard/DashboardCard"

interface Props {
  topics: Map<string, TopicAnnounce>
  widgets: DashboardWidget[]
  onAddWidget: (w: Omit<DashboardWidget, "id">) => void
  onRemoveWidget: (id: string) => void
  onUpdateWidget: (id: string, updates: Partial<DashboardWidget>) => void
  onReorderWidgets: (newOrder: DashboardWidget[]) => void
}

// Tamaño del canvas en celdas. Con GRID_CELL=48px esto da un lienzo amplio
// tipo "banco de instrumentos" que se puede recorrer con scroll.
const CANVAS_COLS = 50
const CANVAS_ROWS = 36

export default function DisplayPage({ topics, widgets, onAddWidget, onRemoveWidget, onUpdateWidget }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const isLive = useSelectionStore((s) => s.isLive)

  // Valores de los widgets: en vivo o en el instante seleccionado de la
  // timeline, según corresponda. useNTSnapshot ya decide internamente si
  // hay que pedir get_live_values o get_values_at con el timestamp
  // scrubbeado (ver useNTTick). Esto reemplaza el poll manual que había
  // acá antes -> ese poll siempre pedía "ahora" con setTimeout, sin
  // enterarse nunca de si el timeline estaba pausado o no.
  const topicNames = useMemo(() => widgets.map((w) => w.topicName), [widgets])
  const liveValues = useNTSnapshot(topicNames, 33)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ id: string; startMouseX: number; startMouseY: number; startX: number; startY: number } | null>(null)
  const resizeState = useRef<{ id: string; startMouseX: number; startMouseY: number; startW: number; startH: number } | null>(null)
  // Guardamos la última posición conocida durante el "dragover": en Tauri/WebView2
  // las coordenadas del evento "drop" pueden llegar desactualizadas (congeladas
  // en el punto donde empezó el drag), lo que causaba el desfase de varias celdas
  // en el eje Y. Usamos siempre la posición más reciente de "dragover" en su lugar.
  const lastDragPos = useRef({ x: 0, y: 0 })

  // ---- DROP DESDE EL DATA DIRECTORY (arrastrar variable -> soltar en la cuadrícula) ----
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    lastDragPos.current = { x: e.clientX, y: e.clientY }
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const topicName = e.dataTransfer.getData("topicName")
    const topicType = e.dataTransfer.getData("topicType")
    if (!topicName || !canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    // Usamos la última posición de "dragover" en vez de e.clientX/Y del propio
    // "drop" (ver nota en lastDragPos más arriba).
    const { x: dropX, y: dropY } = lastDragPos.current
    const offsetX = dropX - rect.left
    const offsetY = dropY - rect.top

    const cellX = Math.max(0, Math.min(CANVAS_COLS - MIN_WIDGET_W, Math.floor(offsetX / GRID_CELL)))
    const cellY = Math.max(0, Math.min(CANVAS_ROWS - MIN_WIDGET_H, Math.floor(offsetY / GRID_CELL)))

    const parts = topicName.split("/").filter(Boolean)
    const defaultLabel = parts.length > 0 ? parts[parts.length - 1] : topicName

    onAddWidget({
      topicName,
      topicType,
      label: defaultLabel,
      style: "Simple",
      width: 4,
      height: 4,
      x: cellX,
      y: cellY,
    })
  }

  // ---- MOVER (drag de widgets ya colocados) ----
  const handleDragMove = useCallback((e: MouseEvent) => {
    const drag = dragState.current
    if (!drag) return
    const dCellsX = Math.round((e.clientX - drag.startMouseX) / GRID_CELL)
    const dCellsY = Math.round((e.clientY - drag.startMouseY) / GRID_CELL)
    const newX = Math.max(0, Math.min(CANVAS_COLS - MIN_WIDGET_W, drag.startX + dCellsX))
    const newY = Math.max(0, drag.startY + dCellsY)
    onUpdateWidget(drag.id, { x: newX, y: newY })
  }, [onUpdateWidget])

  const stopDrag = useCallback(() => {
    dragState.current = null
    setActiveId(null)
    window.removeEventListener("mousemove", handleDragMove)
    window.removeEventListener("mouseup", stopDrag)
  }, [handleDragMove])

  const startDrag = (e: React.MouseEvent, widget: DashboardWidget) => {
    if (e.button !== 0) return
    dragState.current = { id: widget.id, startMouseX: e.clientX, startMouseY: e.clientY, startX: widget.x, startY: widget.y }
    setActiveId(widget.id)
    window.addEventListener("mousemove", handleDragMove)
    window.addEventListener("mouseup", stopDrag)
  }

  // ---- ESTIRAR (resize) ----
  const handleResizeMove = useCallback((e: MouseEvent) => {
    const rs = resizeState.current
    if (!rs) return
    const dCellsW = Math.round((e.clientX - rs.startMouseX) / GRID_CELL)
    const dCellsH = Math.round((e.clientY - rs.startMouseY) / GRID_CELL)
    const newW = Math.max(MIN_WIDGET_W, rs.startW + dCellsW)
    const newH = Math.max(MIN_WIDGET_H, rs.startH + dCellsH)
    onUpdateWidget(rs.id, { width: newW, height: newH })
  }, [onUpdateWidget])

  const stopResize = useCallback(() => {
    resizeState.current = null
    setActiveId(null)
    window.removeEventListener("mousemove", handleResizeMove)
    window.removeEventListener("mouseup", stopResize)
  }, [handleResizeMove])

  const startResize = (e: React.MouseEvent, widget: DashboardWidget) => {
    if (e.button !== 0) return
    e.stopPropagation()
    resizeState.current = { id: widget.id, startMouseX: e.clientX, startMouseY: e.clientY, startW: widget.width, startH: widget.height }
    setActiveId(widget.id)
    window.addEventListener("mousemove", handleResizeMove)
    window.addEventListener("mouseup", stopResize)
  }

  const canvasWidthPx = CANVAS_COLS * GRID_CELL
  const canvasHeightPx = CANVAS_ROWS * GRID_CELL

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden", position: "relative" }}>

      {/* SIDEBAR: DATA DIRECTORY (arrastrable hacia la cuadrícula) */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            NetworkTables 4
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            Data Directory
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          <TreeDirectory topics={topics} />
        </div>
      </div>

      {/* MAIN GRID: WIDGET DASHBOARD */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* CABECERA TOP DEL WORKSPACE */}
        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Dashboard Workspace</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginLeft: 14 }}>
            {widgets.length} widget{widgets.length !== 1 ? "s" : ""} · drag a variable from the directory · drag to move · corner to resize
          </span>

          {/* Refleja el estado del timeline: si está pausado, estos valores
              son los del instante seleccionado, no "ahora". */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
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
        </div>

        {/* CANVAS CON SCROLL: la cuadrícula es la guía literal de posicionamiento */}
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg-page)" }}>
          <div style={{ display: "flex" }}>
            {/* Regla vertical (izquierda) */}
            <Ruler length={CANVAS_ROWS} vertical />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* Regla horizontal (arriba) */}
              <Ruler length={CANVAS_COLS} />

              {/* Cuadrícula */}
              <div
                ref={canvasRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{
                  position: "relative",
                  width: canvasWidthPx,
                  height: canvasHeightPx,
                  boxSizing: "border-box",
                  backgroundColor: isDragOver ? "var(--bg-input)" : "var(--bg-page)",
                  border: isDragOver ? "1px dashed var(--mars-red)" : "1px solid transparent",
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)," +
                    "linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)," +
                    "linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)," +
                    "linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)",
                  backgroundSize:
                    `${GRID_CELL}px ${GRID_CELL}px, ${GRID_CELL}px ${GRID_CELL}px, ` +
                    `${GRID_CELL * 5}px ${GRID_CELL * 5}px, ${GRID_CELL * 5}px ${GRID_CELL * 5}px`,
                }}
              >
                {widgets.length === 0 && (
                  <div style={{ position: "absolute", top: 40, left: 40, display: "flex", flexDirection: "column", alignItems: "flex-start", color: "var(--text-muted)" }}>
                    <i className="ti ti-layout-dashboard" style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }} />
                    <span style={{ fontSize: 13 }}>Drag a variable from the Data Directory to pin it here</span>
                  </div>
                )}

                {widgets.map(widget => (
                  <div
                    key={widget.id}
                    onMouseDown={(e) => startDrag(e, widget)}
                    style={{
                      position: "absolute",
                      left: widget.x * GRID_CELL,
                      top: widget.y * GRID_CELL,
                      width: widget.width * GRID_CELL - 6,
                      height: widget.height * GRID_CELL - 6,
                      zIndex: activeId === widget.id ? 20 : 1,
                      outline: activeId === widget.id ? "1px solid var(--mars-red)" : "none",
                    }}
                  >
                    <DashboardCard
                      widget={widget}
                      liveValue={liveValues[widget.topicName]}
                      onRemove={() => onRemoveWidget(widget.id)}
                      onUpdate={(updates) => onUpdateWidget(widget.id, updates)}
                    />

                    {/* Manija de resize (esquina inferior derecha) */}
                    <div
                      onMouseDown={(e) => startResize(e, widget)}
                      title="Drag to resize"
                      style={{
                        position: "absolute", right: 2, bottom: 2, width: 16, height: 16,
                        cursor: "nwse-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
                        padding: 2, zIndex: 5,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <line x1="9" y1="1" x2="1" y2="9" stroke="var(--text-muted)" strokeWidth="1" />
                        <line x1="9" y1="5" x2="5" y2="9" stroke="var(--text-muted)" strokeWidth="1" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Regla de coordenadas: además de ser un detalle visual, funciona como guía
// real de la cuadrícula (marca cada 5 celdas).
function Ruler({ length, vertical = false }: { length: number, vertical?: boolean }) {
  const majors = []
  for (let i = 0; i <= length; i += 5) majors.push(i)

  if (vertical) {
    return (
      <div style={{ position: "relative", width: 22, height: length * GRID_CELL, flexShrink: 0, background: "var(--bg-dark)", borderRight: "1px solid var(--border-main)" }}>
        {majors.map(i => (
          <div key={i} style={{ position: "absolute", top: i * GRID_CELL, left: 0, right: 0, display: "flex", alignItems: "center" }}>
            <div style={{ width: "100%", height: 1, background: "var(--border-main)" }} />
            <span style={{ position: "absolute", right: 3, top: 2, fontSize: 8, color: "var(--text-muted)" }}>{i}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ position: "relative", width: length * GRID_CELL, height: 22, flexShrink: 0, background: "var(--bg-dark)", borderBottom: "1px solid var(--border-main)" }}>
      {majors.map(i => (
        <div key={i} style={{ position: "absolute", left: i * GRID_CELL, top: 0, bottom: 0 }}>
          <div style={{ width: 1, height: "100%", background: "var(--border-main)" }} />
          <span style={{ position: "absolute", left: 3, top: 3, fontSize: 8, color: "var(--text-muted)" }}>{i}</span>
        </div>
      ))}
    </div>
  )
}