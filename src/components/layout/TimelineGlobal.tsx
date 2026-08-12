import { useCallback, useEffect, useRef } from "react"
import { ConnectionState } from "../../store/appStore"
import { useSelectionStore } from "../../store/selectionStore"
import { useNTLiveClock } from "../../utils/nt/useNTLiveClock"
import ScrollSensor from "../../utils/nt/ScrollSensor"
import { calcAxisStepSize, clampValue, cleanFloat, scaleValue } from "../../utils/nt/timelineMath"

interface Props {
  connection: ConnectionState
}

const DEFAULT_SPAN_US = 10_000_000
const MIN_SPAN_US = 1_000_000
const STEP_TARGET_PX = 90

export default function TimelineGlobal({ connection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollOverlayRef = useRef<HTMLDivElement>(null)
  const scrollSensorRef = useRef<ScrollSensor | null>(null)

  const rangeStartUsRef = useRef(0)
  const spanUsRef = useRef(DEFAULT_SPAN_US)
  const followLiveRef = useRef(true)

  const draggingRef = useRef(false)
  const dragMovedRef = useRef(false)
  const dragStartXRef = useRef(0)
  const hoveredXRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)
  const goLive = useSelectionStore((s) => s.goLive)
  const pauseAt = useSelectionStore((s) => s.pauseAt)
  const scrubTo = useSelectionStore((s) => s.scrubTo)
  const setHovered = useSelectionStore((s) => s.setHovered)

  // Reloj real: startUs viene del PRIMER dato recibido por el backend (no
  // del montaje del componente), getEstimatedNowUs() del último dato + una
  // interpolación suave para que fluya entre polls.
  const { startUs, getEstimatedNowUs } = useNTLiveClock(200)

  const isConnected = connection !== "disconnected"
  const hasData = startUs !== null

  // --- "Latest ref" ------------------------------------------------------
  // El loop de dibujo y el ScrollSensor se crean UNA sola vez (al montar) y
  // viven mientras el componente exista, igual que Timeline.ts en
  // AdvantageScope: la instancia es única y en cada frame lee el estado
  // ACTUAL (window.selection, this.CONTAINER, etc.), nunca un closure
  // viejo. Acá replicamos eso con un ref que se actualiza en cada render:
  // así draw() y el callback del ScrollSensor siempre ven el valor más
  // reciente sin necesidad de recrear el loop / los listeners cada vez que
  // cambia isConnected, hasData, isLive, etc.
  //
  // Antes, el ScrollSensor se recreaba en cada cambio de [isConnected,
  // hasData] SIN limpiar los listeners anteriores -> se iban acumulando
  // varios ScrollSensor escuchando el mismo scroll, y cada gesto disparaba
  // el callback 2-3 veces (eso era el "shaky"). Y el loop de rAF se cortaba
  // al desconectar sin volver a dibujar, dejando el canvas congelado.
  const latestRef = useRef({
    isConnected,
    hasData,
    startUs,
    isLive,
    selectedTime,
    getEstimatedNowUs
  })
  useEffect(() => {
    latestRef.current = { isConnected, hasData, startUs, isLive, selectedTime, getEstimatedNowUs }
  })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    // Igual que Timeline.isHidden() en AdvantageScope: si no es visible no
    // se puede leer el scroll ni tiene sentido dibujar.
    if (container.clientWidth === 0 || container.clientHeight === 0) return

    scrollSensorRef.current?.periodic()

    const { isConnected, hasData, startUs, isLive, selectedTime, getEstimatedNowUs } = latestRef.current

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = container.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const style = getComputedStyle(container)
    const cssBorder = style.getPropertyValue("--border-main").trim() || "#3a3a3a"
    const cssMuted = "rgba(255,255,255,0.55)"
    const cssBright = "#ffffff"
    const cssAccent = style.getPropertyValue("--mars-red").trim() || "#a83c3c"

    if (!isConnected) {
      drawCenteredMessage(ctx, width, height, "NO SIGNAL", cssMuted, cssBorder)
      return
    }
    if (!hasData || startUs === null) {
      drawCenteredMessage(ctx, width, height, "WAITING FOR DATA", cssMuted, cssBorder)
      return
    }

    const t0 = startUs
    const nowUs = getEstimatedNowUs() ?? t0

    if (followLiveRef.current) {
      rangeStartUsRef.current = nowUs - spanUsRef.current
    }
    const rangeStartUs = rangeStartUsRef.current
    const rangeEndUs = rangeStartUs + spanUsRef.current

    const elapsedRange: [number, number] = [(rangeStartUs - t0) / 1e6, (rangeEndUs - t0) / 1e6]
    const scaleX = (us: number) => scaleValue((us - t0) / 1e6, elapsedRange, [0, width])
    const unscaleX = (x: number) => t0 + scaleValue(x, [0, width], elapsedRange) * 1e6

    ctx.strokeStyle = cssBorder
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()

    const stepSize = calcAxisStepSize(elapsedRange, width, STEP_TARGET_PX)
    ctx.font = "500 11px ui-monospace, SFMono-Regular, monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    let stepPos = Math.ceil(cleanFloat(elapsedRange[0] / stepSize)) * stepSize
    let iter = 0
    while (iter++ < 200) {
      const x = scaleValue(stepPos, elapsedRange, [0, width])
      if (x > width + 1) break

      ctx.fillStyle = cssBright
      ctx.globalAlpha = 0.85
      ctx.fillText(cleanFloat(stepPos) + "s", clampValue(x, 24, width - 24), height / 2)

      ctx.strokeStyle = cssBorder
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(x, 2)
      ctx.lineTo(x, 9)
      ctx.moveTo(x, height - 9)
      ctx.lineTo(x, height - 2)
      ctx.stroke()

      stepPos += stepSize
    }
    ctx.globalAlpha = 1

    const referenceUs = isLive ? nowUs : selectedTime ?? nowUs
    if (referenceUs >= rangeStartUs && referenceUs <= rangeEndUs) {
      drawTimeMarker(ctx, scaleX(referenceUs) - 0.5, height, cssAccent)
    }

    if (hoveredXRef.current !== null) {
      const x = hoveredXRef.current
      ctx.strokeStyle = cssBright
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.globalAlpha = 1

      const label = cleanFloat((unscaleX(x) - t0) / 1e6) + "s"
      ctx.font = "600 10px ui-monospace, monospace"
      const textWidth = ctx.measureText(label).width
      const boxX = clampValue(x, textWidth / 2 + 6, width - textWidth / 2 - 6)
      ctx.fillStyle = cssMuted
      ctx.fillText(label, boxX, 8)
    }
  }, [])

  // Loop de dibujo: se crea UNA vez y corre mientras el componente esté
  // montado. draw() lee todo lo que necesita de latestRef, así que no hace
  // falta (ni conviene) recrear el rAF cuando cambia isConnected/isLive/etc.
  useEffect(() => {
    let cancelled = false
    const loop = () => {
      if (cancelled) return
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [draw])

  useEffect(() => {
    draw()
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [draw])

  // ScrollSensor: instancia única sobre el overlay, igual que en el
  // constructor de Timeline.ts. El callback lee latestRef en cada llamada,
  // así nunca queda pegado a un startUs/isConnected viejo.
  useEffect(() => {
    if (!scrollOverlayRef.current) return
    const sensor = new ScrollSensor(scrollOverlayRef.current, (dx, dy) => {
      const { isConnected, hasData, startUs, getEstimatedNowUs } = latestRef.current
      if (!isConnected || !hasData || startUs === null) return
      const t0 = startUs
      const nowUs = getEstimatedNowUs() ?? t0

      if (dy !== 0) {
        const factor = Math.exp(dy * 0.002)
        const maxSpan = Math.max(MIN_SPAN_US, nowUs - t0)
        const newSpan = clampValue(spanUsRef.current * factor, MIN_SPAN_US, maxSpan)
        if (!followLiveRef.current) {
          const center = rangeStartUsRef.current + spanUsRef.current / 2
          rangeStartUsRef.current = clampValue(center - newSpan / 2, t0, nowUs - newSpan)
        }
        spanUsRef.current = newSpan
      }

      if (dx !== 0) {
        followLiveRef.current = false
        const width = scrollOverlayRef.current?.clientWidth || 1
        const dUs = (dx / width) * spanUsRef.current
        rangeStartUsRef.current = clampValue(rangeStartUsRef.current + dUs, t0, nowUs - spanUsRef.current)
      }
    }, false)
    scrollSensorRef.current = sensor
    // Sin cleanup a propósito: igual que en AdvantageScope, ScrollSensor no
    // tiene destroy() y está pensado para vivir tanto como el contenedor.
    // Se crea una sola vez (deps vacías) para no duplicar listeners.
  }, [])

  const timeFromClientX = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current
    const { hasData, startUs } = latestRef.current
    if (!canvas || !hasData || startUs === null) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return null
    const x = clampValue(clientX - rect.left, 0, rect.width)
    const t0 = startUs
    const elapsedRange: [number, number] = [
      (rangeStartUsRef.current - t0) / 1e6,
      (rangeStartUsRef.current + spanUsRef.current - t0) / 1e6
    ]
    return t0 + scaleValue(x, [0, rect.width], elapsedRange) * 1e6
  }, [])

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return
    const wasMoved = dragMovedRef.current
    if (Math.abs(e.clientX - dragStartXRef.current) > 5) dragMovedRef.current = true
    if (!dragMovedRef.current) return // todavía no cruzó el umbral de "esto es un arrastre"

    const t = timeFromClientX(e.clientX)
    if (t === null) return
    followLiveRef.current = false

    if (!wasMoved && latestRef.current.isLive) {
      pauseAt(t)   // primer frame de arrastre: si estaba en vivo, pausa justo ahí
    } else {
      scrubTo(t)    // resto del arrastre: solo mueve el cursor, como un scrubber de video
    }
  }, [timeFromClientX, pauseAt, scrubTo])

  const stopDrag = useCallback(
    (e: MouseEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      window.removeEventListener("mousemove", handleGlobalMouseMove)
      window.removeEventListener("mouseup", stopDrag)

      if (!dragMovedRef.current) {
        const t = timeFromClientX(e.clientX)
        if (t !== null) {
          followLiveRef.current = false
          if (latestRef.current.isLive) pauseAt(t)
          else scrubTo(t)
        }
      }
    },
    [handleGlobalMouseMove, timeFromClientX, pauseAt, scrubTo]
  )

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isConnected || e.button !== 0 || e.shiftKey) return
    // CRÍTICO: sin esto, el navegador inicia su propia selección nativa de
    // arrastre (el rectángulo azul translúcido que veías cubriendo todo
    // el toolbar). preventDefault() lo bloquea en el origen.
    e.preventDefault()
    draggingRef.current = true
    dragMovedRef.current = false
    dragStartXRef.current = e.clientX
    window.addEventListener("mousemove", handleGlobalMouseMove)
    window.addEventListener("mouseup", stopDrag)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isConnected) return
    const rect = e.currentTarget.getBoundingClientRect()
    hoveredXRef.current = e.clientX - rect.left
    setHovered(timeFromClientX(e.clientX))
  }

  const handleMouseLeave = () => {
    hoveredXRef.current = null
    setHovered(null)
  }

  const handleGoLive = () => {
    followLiveRef.current = true
    goLive()
  }

  const handlePause = () => {
    const t = getEstimatedNowUs()
    if (t === null) return
    followLiveRef.current = false
    pauseAt(t)
  }

  const showBackToLive = isLive && !followLiveRef.current

  return (
    <div
      ref={containerRef}
      style={{
        height: 40,
        background: "var(--bg-toolbar)",
        borderBottom: "1px solid var(--border-main)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        flexShrink: 0,
        opacity: isConnected ? 1 : 0.5,
        position: "relative",
        gap: 10,
        userSelect: "none",
        WebkitUserSelect: "none"
      }}
    >
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <button
          onClick={handleGoLive}
          disabled={!isConnected}
          title="Go Live"
          style={{
            ...btnStyle,
            background: isLive && followLiveRef.current ? "var(--border-main)" : "transparent",
            cursor: isConnected ? "pointer" : "default"
          }}
        >
          <i className="ti ti-player-skip-forward" />
        </button>
        <button
          onClick={handlePause}
          disabled={!isConnected}
          title="Pause"
          style={{
            ...btnStyle,
            background: !isLive ? "var(--border-main)" : "transparent",
            cursor: isConnected ? "pointer" : "default"
          }}
        >
          <i className="ti ti-player-pause" />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: !isConnected || !hasData ? "var(--text-muted)" : isLive ? "var(--status-sim)" : "var(--mars-red)"
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: "rgba(255,255,255,0.55)",
            fontFamily: "monospace"
          }}
        >
          {!isConnected ? "OFFLINE" : !hasData ? "WAITING" : isLive ? "LIVE" : "PAUSED"}
        </span>
      </div>

      <div style={{ flex: 1, height: "100%", position: "relative", cursor: isConnected ? "grab" : "default" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
        />
        <div
          ref={scrollOverlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ position: "absolute", inset: 0, overflow: "scroll", scrollbarWidth: "none", userSelect: "none", WebkitUserSelect: "none" }}
        >
          <div style={{ width: 1000000, height: 1000000 }} />
        </div>
      </div>

      {showBackToLive && (
        <button
          onClick={handleGoLive}
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.3,
            flexShrink: 0,
            color: "var(--mars-red)",
            background: "transparent",
            border: "1px solid var(--border-main)",
            borderRadius: 3,
            padding: "3px 8px",
            cursor: "pointer"
          }}
        >
          ← BACK TO LIVE
        </button>
      )}
    </div>
  )
}

function drawTimeMarker(ctx: CanvasRenderingContext2D, x: number, height: number, color: string) {
  const triSide = 6
  const triHeight = 0.5 * Math.sqrt(3) * triSide
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, triHeight)
  ctx.lineTo(x - triSide / 2, 0)
  ctx.lineTo(x + triSide / 2, 0)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x, height - triHeight)
  ctx.lineTo(x - triSide / 2, height)
  ctx.lineTo(x + triSide / 2, height)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x, triHeight)
  ctx.lineTo(x, height - triHeight)
  ctx.stroke()
}

function drawCenteredMessage(ctx: CanvasRenderingContext2D, width: number, height: number, text: string, textColor: string, lineColor: string) {
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, height / 2)
  ctx.lineTo(width, height / 2)
  ctx.stroke()
  ctx.fillStyle = textColor
  ctx.font = "500 11px ui-sans-serif, system-ui"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)
}

const btnStyle: React.CSSProperties = {
  border: "none",
  color: "rgba(255,255,255,0.75)",
  fontSize: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 3
}