import React, { useEffect, useRef } from "react"
import { TimeSeriesPoint } from "../../../utils/functions/mathTransforms"
import { calcAxisStepSize } from "../../../utils/functions/axisTicks"
import { ErrorBandPoint } from "../../../utils/functions/seriesAlgebra"

export type PlottedAxis = "left" | "right"

export interface PlottedSeries {
  id: string
  label: string
  color: string
  axis: PlottedAxis
  unit: string | null
  points: TimeSeriesPoint[]
  errorBand?: ErrorBandPoint[]
}

interface Props {
  series: PlottedSeries[]
  windowSeconds: number
  isLive: boolean
  selectedTime: number | null
  title?: string
}

const PADDING_TOP = 30
const PADDING_BOTTOM = 32
const PADDING_OUTER = 12
const AXIS_LABEL_GAP = 8
const AXIS_TICK_LEN = 5
const Y_SMOOTHING = 0.15
const Y_STEP_TARGET_PX = 50
const X_STEP_TARGET_PX = 90
const ERROR_BAND_ALPHA = 0.18

interface YRange { yMin: number; yMax: number }
interface SmoothState { left: YRange | null; right: YRange | null }

export default function GraphCanvas({ series, windowSeconds, isLive, selectedTime, title = "Function Plot" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const smoothRef = useRef<SmoothState>({ left: null, right: null })

  useEffect(() => {
    let raf: number
    const draw = () => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) renderFrame(canvas, container, series, windowSeconds, title, smoothRef, isLive, selectedTime)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [series, windowSeconds, title, isLive, selectedTime])

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  )
}

function computeTargetRange(points: TimeSeriesPoint[], xMin: number): YRange {
  let yMin = Infinity
  let yMax = -Infinity
  points.forEach(p => {
    if (p.t < xMin) return
    if (p.v < yMin) yMin = p.v
    if (p.v > yMax) yMax = p.v
  })
  if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1 }
  if (yMax - yMin < 1e-6) { yMin -= 1; yMax += 1 }
  const pad = (yMax - yMin) * 0.08
  return { yMin: yMin - pad, yMax: yMax + pad }
}

function smoothTowards(current: YRange | null, target: YRange): YRange {
  if (!current) return target
  return {
    yMin: current.yMin + (target.yMin - current.yMin) * Y_SMOOTHING,
    yMax: current.yMax + (target.yMax - current.yMax) * Y_SMOOTHING,
  }
}

function formatTick(v: number, unit: string | null): string {
  const abs = Math.abs(v)
  const numeric = abs >= 1000 ? v.toFixed(0) : abs >= 1 ? v.toFixed(2) : v.toFixed(3)
  return unit ? `${numeric} ${unit}` : numeric
}

function axisUnit(seriesOnAxis: PlottedSeries[]): string | null {
  if (seriesOnAxis.length === 0) return null
  const first = seriesOnAxis[0].unit
  if (!first) return null
  return seriesOnAxis.every(s => s.unit === first) ? first : null
}

// Convierte un color hex ("#6262f1") a rgba con el alpha dado, para el
// relleno translúcido de la banda de error usando el mismo color de la serie.
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean
  const value = parseInt(full, 16)
  if (isNaN(value)) return `rgba(128, 128, 128, ${alpha})`
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function renderFrame(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  series: PlottedSeries[],
  windowSeconds: number,
  title: string,
  smoothRef: React.MutableRefObject<SmoothState>,
  isLive: boolean,
  selectedTime: number | null,
) {
  const dpr = window.devicePixelRatio || 1
  const width = container.clientWidth
  const height = container.clientHeight
  if (width === 0 || height === 0) return
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr
    canvas.height = height * dpr
  }
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const styles = getComputedStyle(document.documentElement)
  const colorText = styles.getPropertyValue("--text-primary").trim() || "#e8e6e1"
  const colorMuted = styles.getPropertyValue("--text-muted").trim() || "#807d78"
  const colorGrid = styles.getPropertyValue("--border-light").trim() || "#2c2a28"
  const colorBorder = styles.getPropertyValue("--border-main").trim() || "#383532"
  const colorPlotBg = styles.getPropertyValue("--bg-input").trim() || "#0f0e0d"

  const leftSeries = series.filter(s => s.axis === "left")
  const rightSeries = series.filter(s => s.axis === "right")
  const showLeftAxis = leftSeries.length > 0 || rightSeries.length === 0
  const showRightAxis = rightSeries.length > 0

  const now = isLive || selectedTime === null ? Date.now() / 1000 : selectedTime / 1e6
  const xMin = now - windowSeconds
  const xMax = now

  const targetLeft = computeTargetRange(leftSeries.flatMap(s => s.points), xMin)
  const targetRight = computeTargetRange(rightSeries.flatMap(s => s.points), xMin)
  if (showLeftAxis) smoothRef.current.left = smoothTowards(smoothRef.current.left, targetLeft)
  if (showRightAxis) smoothRef.current.right = smoothTowards(smoothRef.current.right, targetRight)
  const leftRange = smoothRef.current.left ?? targetLeft
  const rightRange = smoothRef.current.right ?? targetRight

  const leftUnit = axisUnit(leftSeries)
  const rightUnit = axisUnit(rightSeries)

  ctx.font = "10px 'Segoe UI', Arial, sans-serif"

  const graphTop = PADDING_TOP
  const graphBottom = height - PADDING_BOTTOM
  const graphHeightPx = Math.max(1, graphBottom - graphTop)

  const leftStep = calcAxisStepSize([leftRange.yMin, leftRange.yMax], graphHeightPx, Y_STEP_TARGET_PX)
  const rightStep = calcAxisStepSize([rightRange.yMin, rightRange.yMax], graphHeightPx, Y_STEP_TARGET_PX)

  const measureAxisTextWidth = (range: YRange, step: number, unit: string | null): number => {
    let widest = 0
    let v = Math.ceil(range.yMin / step) * step
    let guard = 0
    while (v <= range.yMax && guard++ < 200) {
      widest = Math.max(widest, ctx.measureText(formatTick(v, unit)).width)
      v += step
    }
    return Math.ceil(widest / 2) * 2
  }

  const graphLeft = PADDING_OUTER + (showLeftAxis ? AXIS_LABEL_GAP + measureAxisTextWidth(leftRange, leftStep, leftUnit) : 0)
  const graphRight = width - (PADDING_OUTER + (showRightAxis ? AXIS_LABEL_GAP + measureAxisTextWidth(rightRange, rightStep, rightUnit) : 0))
  const graphWidth = Math.max(1, graphRight - graphLeft)
  const graphHeight = graphHeightPx

  ctx.fillStyle = colorPlotBg
  ctx.fillRect(graphLeft, graphTop, graphWidth, graphHeight)

  const toX = (t: number) => graphLeft + ((t - xMin) / (xMax - xMin)) * graphWidth
  const toY = (v: number, range: YRange) => graphBottom - ((v - range.yMin) / (range.yMax - range.yMin)) * graphHeight

  const gridRange = showLeftAxis ? leftRange : rightRange
  const gridStep = showLeftAxis ? leftStep : rightStep
  ctx.strokeStyle = colorGrid
  ctx.lineWidth = 1
  {
    let v = Math.ceil(gridRange.yMin / gridStep) * gridStep
    let guard = 0
    while (v <= gridRange.yMax && guard++ < 200) {
      const y = toY(v, gridRange)
      ctx.beginPath()
      ctx.moveTo(graphLeft, y)
      ctx.lineTo(graphRight, y)
      ctx.stroke()
      v += gridStep
    }
  }

  if (showLeftAxis) {
    ctx.fillStyle = colorMuted
    ctx.strokeStyle = colorMuted
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    let v = Math.ceil(leftRange.yMin / leftStep) * leftStep
    let guard = 0
    while (v <= leftRange.yMax && guard++ < 200) {
      const y = toY(v, leftRange)
      ctx.fillText(formatTick(v, leftUnit), graphLeft - AXIS_LABEL_GAP, y)
      ctx.beginPath()
      ctx.moveTo(graphLeft - AXIS_TICK_LEN, y)
      ctx.lineTo(graphLeft, y)
      ctx.stroke()
      v += leftStep
    }
  }

  if (showRightAxis) {
    ctx.fillStyle = colorMuted
    ctx.strokeStyle = colorMuted
    ctx.textAlign = "left"
    ctx.textBaseline = "middle"
    let v = Math.ceil(rightRange.yMin / rightStep) * rightStep
    let guard = 0
    while (v <= rightRange.yMax && guard++ < 200) {
      const y = toY(v, rightRange)
      ctx.fillText(formatTick(v, rightUnit), graphRight + AXIS_LABEL_GAP, y)
      ctx.beginPath()
      ctx.moveTo(graphRight, y)
      ctx.lineTo(graphRight + AXIS_TICK_LEN, y)
      ctx.stroke()
      v += rightStep
    }
  }

  const xStep = calcAxisStepSize([xMin, xMax], graphWidth, X_STEP_TARGET_PX)
  let xTick = Math.ceil(xMin / xStep) * xStep
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.fillStyle = colorMuted
  let guard = 0
  while (xTick <= xMax && guard++ < 200) {
    const x = toX(xTick)
    ctx.strokeStyle = colorGrid
    ctx.beginPath()
    ctx.moveTo(x, graphTop)
    ctx.lineTo(x, graphBottom)
    ctx.stroke()
    ctx.fillText(`${Math.round(xTick - now)}s`, x, graphBottom + 8)
    xTick += xStep
  }

  series.forEach(s => {
    if (!s.errorBand || s.errorBand.length < 2) return
    const range = s.axis === "left" ? leftRange : rightRange
    const visible = s.errorBand.filter(p => p.t >= xMin - xStep)
    if (visible.length < 2) return

    ctx.beginPath()
    visible.forEach((p, i) => {
      const x = toX(p.t)
      const y = toY(p.actual, range)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    for (let k = visible.length - 1; k >= 0; k--) {
      const p = visible[k]
      ctx.lineTo(toX(p.t), toY(p.target, range))
    }
    ctx.closePath()
    ctx.fillStyle = hexToRgba(s.color, ERROR_BAND_ALPHA)
    ctx.fill()
  })

  series.forEach(s => {
    const range = s.axis === "left" ? leftRange : rightRange
    const visible = s.points.filter(p => p.t >= xMin - xStep)
    if (visible.length < 2) return
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.6
    ctx.lineJoin = "round"
    ctx.beginPath()
    visible.forEach((p, i) => {
      const x = toX(p.t)
      const y = toY(p.v, range)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })

  ctx.strokeStyle = colorBorder
  ctx.lineWidth = 1
  ctx.strokeRect(graphLeft, graphTop, graphWidth, graphHeight)

  ctx.fillStyle = colorText
  ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  ctx.fillText(title, (graphLeft + graphRight) / 2, 18)

  if (series.length === 0) {
    ctx.fillStyle = colorMuted
    ctx.font = "12px 'Segoe UI', Arial, sans-serif"
    ctx.textBaseline = "middle"
    ctx.fillText("Drag a double value here to plot it", (graphLeft + graphRight) / 2, (graphTop + graphBottom) / 2)
  }
}