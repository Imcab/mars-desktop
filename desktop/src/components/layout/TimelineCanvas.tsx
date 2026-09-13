import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import ScrollSensor from "../../utils/nt/ScrollSensor"
import { calcAxisStepSize, clampValue, cleanFloat, scaleValue } from "../../utils/nt/timelineMath"

const DEFAULT_SPAN_US = 10_000_000
const MIN_SPAN_US = 1_000_000
const STEP_TARGET_PX = 90

import type { TimelineMarker } from "../../store/markerStore"

export interface TimelineCanvasHandle {
  goLive: () => void
  pause: () => void
  /** Suelta el seguimiento del presente sin tocar selectedTime. */
  stopFollowingLive: () => void
}

interface Props {
  isConnected: boolean
  hasData: boolean
  startUs: number | null
  getEstimatedNowUs: () => number | null
  isLive: boolean
  selectedTime: number | null
  markers: TimelineMarker[]
  onMarkerContextMenu: (id: string) => void
  goLive: () => void
  pauseAt: (t: number) => void
  scrubTo: (t: number) => void
  setHovered: (t: number | null) => void
}

// Motor de dibujo + interacción de la timeline: canvas, drag-para-scrubbear
// y scroll/pinch para paneo y zoom. Todo lo que es "chrome" (botones,
// badge de estado) vive en TimelineGlobal, que es quien monta este
// componente y controla goLive()/pause() a través del ref imperativo.
const TimelineCanvas = forwardRef<TimelineCanvasHandle, Props>(function TimelineCanvas(
  { isConnected, hasData, startUs, getEstimatedNowUs, isLive, selectedTime, markers, onMarkerContextMenu, goLive, pauseAt, scrubTo, setHovered },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollOverlayRef = useRef<HTMLDivElement>(null)
  const scrollSensorRef = useRef<ScrollSensor | null>(null)

  const rangeStartUsRef = useRef(0)
  const spanUsRef = useRef(DEFAULT_SPAN_US)
  const followLiveRef = useRef(true)
  // Espejo en estado del ref de arriba: el ref es lo que lee el loop de
  // dibujo (60fps, sin re-render), y este es lo único que puede hacer
  // aparecer el botón "BACK TO LIVE".
  const [followingLive, setFollowingLive] = useState(true)
  const setFollowLive = useCallback((value: boolean) => {
    followLiveRef.current = value
    setFollowingLive(value)
  }, [])

  const draggingRef = useRef(false)
  const dragMovedRef = useRef(false)
  const dragStartXRef = useRef(0)
  const hoveredXRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

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
    getEstimatedNowUs,
    markers
  })
  useEffect(() => {
    latestRef.current = { isConnected, hasData, startUs, isLive, selectedTime, getEstimatedNowUs, markers }
  })

  // Rectángulos de las banderitas en pantalla, para poder saber sobre cuál se
  // hizo click sin volver a calcular la proyección.
  const markerHitboxesRef = useRef<{ id: string; x0: number; x1: number }[]>([])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    // Igual que Timeline.isHidden() en AdvantageScope: si no es visible no
    // se puede leer el scroll ni tiene sentido dibujar.
    if (container.clientWidth === 0 || container.clientHeight === 0) return

    scrollSensorRef.current?.periodic()

    const { isConnected, hasData, startUs, isLive, selectedTime, getEstimatedNowUs, markers } = latestRef.current

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = container.clientHeight
    const pixelW = Math.round(width * dpr)
    const pixelH = Math.round(height * dpr)
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW
      canvas.height = pixelH
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    // El canvas 2D no resuelve var(--token) por sí solo: hay que leer el
    // valor real vía getComputedStyle, igual para los 4 colores.
    const style = getComputedStyle(container)
    const cssBorder = style.getPropertyValue("--border-main").trim()
    const cssMuted = style.getPropertyValue("--text-header-eyebrow").trim()
    const cssBright = style.getPropertyValue("--text-header-title").trim()
    const cssAccent = style.getPropertyValue("--mars-red").trim()

    if (!isConnected) {
      drawCenteredMessage(ctx, width, height, "NO SIGNAL", cssMuted)
      return
    }
    if (!hasData || startUs === null) {
      drawCenteredMessage(ctx, width, height, "WAITING FOR DATA", cssMuted)
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

    // Regla plana tipo AdvantageScope: sin eje central, ticks colgando de un
    // solo borde (arriba) y la etiqueta debajo de cada tick — nada de línea
    // divisoria a mitad de barra, que la hacía leerse como gráfico y no
    // como regla.
    const stepSize = calcAxisStepSize(elapsedRange, width, STEP_TARGET_PX)
    ctx.font = "500 11px ui-monospace, SFMono-Regular, monospace"
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    let stepPos = Math.ceil(cleanFloat(elapsedRange[0] / stepSize)) * stepSize
    let iter = 0
    while (iter++ < 200) {
      const x = scaleValue(stepPos, elapsedRange, [0, width])
      if (x > width + 1) break

      ctx.strokeStyle = cssBorder
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(x, 4)
      ctx.lineTo(x, 11)
      ctx.stroke()

      ctx.fillStyle = cssBright
      ctx.globalAlpha = 0.8
      ctx.fillText(cleanFloat(stepPos) + "s", clampValue(x, 24, width - 24), 15)

      stepPos += stepSize
    }
    ctx.globalAlpha = 1

    // Las marcas van DEBAJO del cursor: el cursor es lo que se mueve y tiene
    // que quedar legible cuando pasa justo por encima de una.
    markerHitboxesRef.current = []
    markers.forEach(marker => {
      if (marker.timeUs < rangeStartUs || marker.timeUs > rangeEndUs) return
      const x = scaleX(marker.timeUs)
      drawMarkerFlag(ctx, x, height, marker.color, marker.label)
      markerHitboxesRef.current.push({ id: marker.id, x0: x - 3, x1: x + 46 })
    })

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
      ctx.textBaseline = "middle"
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

      // Si la ventana visible es MÁS LARGA que los datos que hay, el tope de
      // paneo (nowUs - span) queda por detrás del inicio. clampValue con
      // min > max devuelve el max, o sea que se podía panear antes del primer
      // dato y quedaba media pantalla vacía.
      const maxRangeStart = (span: number) => Math.max(t0, nowUs - span)

      if (dy !== 0) {
        const factor = Math.exp(dy * 0.002)
        const maxSpan = Math.max(MIN_SPAN_US, nowUs - t0)
        const newSpan = clampValue(spanUsRef.current * factor, MIN_SPAN_US, maxSpan)
        if (!followLiveRef.current) {
          const center = rangeStartUsRef.current + spanUsRef.current / 2
          rangeStartUsRef.current = clampValue(center - newSpan / 2, t0, maxRangeStart(newSpan))
        }
        spanUsRef.current = newSpan
      }

      if (dx !== 0) {
        setFollowLive(false)
        const width = scrollOverlayRef.current?.clientWidth || 1
        const dUs = (dx / width) * spanUsRef.current
        rangeStartUsRef.current = clampValue(
          rangeStartUsRef.current + dUs, t0, maxRangeStart(spanUsRef.current),
        )
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
    setFollowLive(false)

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
          setFollowLive(false)
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

  const handleContextMenu = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const hit = markerHitboxesRef.current.find(h => x >= h.x0 && x <= h.x1)
    if (!hit) return
    e.preventDefault()
    onMarkerContextMenu(hit.id)
  }

  useImperativeHandle(ref, () => ({
    goLive: () => {
      setFollowLive(true)
      goLive()
    },
    stopFollowingLive: () => setFollowLive(false),
    pause: () => {
      const t = getEstimatedNowUs()
      if (t === null) return
      setFollowLive(false)
      pauseAt(t)
    }
  }), [goLive, pauseAt, getEstimatedNowUs, setFollowLive])

  const showBackToLive = isLive && !followingLive

  return (
    <>
      <div
        ref={containerRef}
        style={{ flex: 1, height: "100%", position: "relative", cursor: isConnected ? "grab" : "default" }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
        />
        <div
          ref={scrollOverlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          style={{ position: "absolute", inset: 0, overflow: "scroll", scrollbarWidth: "none", userSelect: "none", WebkitUserSelect: "none" }}
        >
          <div style={{ width: 1000000, height: 1000000 }} />
        </div>
      </div>

      {showBackToLive && (
        <button
          onClick={() => {
            setFollowLive(true)
            goLive()
          }}
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
    </>
  )
})

export default TimelineCanvas

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

// Banderita: línea punteada de arriba a abajo + etiqueta en la parte alta.
function drawMarkerFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  height: number,
  color: string,
  label: string,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([2, 2])
  ctx.globalAlpha = 0.75
  ctx.beginPath()
  ctx.moveTo(x + 0.5, 0)
  ctx.lineTo(x + 0.5, height)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // Triangulito de mástil, para que se lea como bandera y no como otro cursor.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x + 7, 3.5)
  ctx.lineTo(x, 7)
  ctx.closePath()
  ctx.fill()

  ctx.font = "600 9px ui-sans-serif, system-ui"
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const text = label.length > 14 ? label.slice(0, 13) + "…" : label
  const w = ctx.measureText(text).width
  ctx.fillStyle = color
  ctx.globalAlpha = 0.92
  ctx.fillRect(x + 8, 0, w + 6, 11)
  ctx.globalAlpha = 1
  ctx.fillStyle = "#ffffff"
  ctx.fillText(text, x + 11, 1)
  ctx.restore()
}

function drawCenteredMessage(ctx: CanvasRenderingContext2D, width: number, height: number, text: string, textColor: string) {
  ctx.fillStyle = textColor
  ctx.font = "500 10px ui-monospace, SFMono-Regular, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)
}
