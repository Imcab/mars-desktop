import React, { useEffect, useMemo, useRef, useState } from "react"
import { FieldObjectType, FieldSettings } from "../../../store/appStore"
import { FieldPose, FIELD_LENGTH_M, FIELD_WIDTH_M } from "../../../utils/field/poseExtraction"
import {
  CoordinateSystem, FieldConfig, InternalPose, toInternal, fromInternal, flipInternal,
} from "../../../utils/field/fieldImages"
import { ResolvedObjectOptions } from "../../../utils/field/fieldObjects"
import { HistoryStore } from "../../../utils/field/poseHistory"
import { Heatmap, signatureOf } from "../../../utils/field/heatmap"
import { RobotSprite } from "../../../utils/field/robotSprite"
import { ModuleState } from "../../../utils/field/swerveExtraction"
import { moduleLocations } from "../../../utils/field/swerveKinematics"
import { applyArrangement } from "../../../hooks/useSwerveSources"

export interface RenderedObject {
  id: string
  type: FieldObjectType
  color: string
  label: string
  /** Poses tal como las publica el robot; la conversión de marco es del canvas. */
  poses: FieldPose[]
  options: ResolvedObjectOptions
  /** Solo para type === "swerve". */
  modules?: ModuleState[]
}

interface Props {
  objects: RenderedObject[]
  settings: FieldSettings
  /** null = dibujo esquemático (sin foto de la cancha). */
  field: FieldConfig | null
  /** Sistema en el que publica el robot; sobreescribe el del JSON. */
  coordinateSystem: CoordinateSystem
  /** Bitmap cenital del modelo del equipo, si hay uno cargado. */
  sprite?: RobotSprite | null
  /** Metros por unidad de archivo del sprite (auto-fit o escala manual). */
  spriteScale?: number
  /** false en las tarjetas del dashboard: sin zoom, paneo ni medición. */
  interactive?: boolean
  /** Herramienta de medir: click y arrastre para una regla sobre la cancha. */
  measureMode?: boolean
  /** Cambiarlo devuelve el encuadre a su posición inicial. */
  resetToken?: number
  /** Historial compartido con la página, para poder vaciarlo desde el panel. */
  history?: HistoryStore
}

const FIELD_MARGIN_M = 0.4 // aire alrededor de la cancha esquemática, en metros

const MIN_ZOOM = 0.5
const MAX_ZOOM = 14

// Orden de pintado. El mapa de calor va al fondo y el robot arriba de todo:
// si no, la mancha del heatmap taparía justo lo que uno está mirando.
const DRAW_ORDER: Record<FieldObjectType, number> = {
  heatmap: 0,
  trajectory: 1,
  target: 2,
  arrow: 3,
  ghost: 4,
  swerve: 5,
  robot: 6,
}

interface View {
  zoom: number
  panX: number
  panY: number
}

const IDENTITY_VIEW: View = { zoom: 1, panX: 0, panY: 0 }

interface Label {
  x: number
  y: number
  text: string
  color: string
}

// Todo se dibuja en el marco INTERNO: origen en el centro del área de juego,
// +X a la derecha de la pantalla y +Y hacia arriba (ver fieldImages.ts). Las
// poses que publica el robot se traducen a ese marco según el sistema de
// coordenadas elegido, así que la foto y el dibujo esquemático coinciden.
//
// El texto NO se dibuja dentro de ese marco: con la escala en metros y el eje
// Y invertido, cualquier `fillText` saldría del revés y microscópico. Los
// objetos apuntan sus etiquetas a una lista con coordenadas ya proyectadas a
// píxeles, y un segundo pase las pinta cuando el canvas volvió a su
// transformación normal.
export default function FieldCanvas({
  objects, settings, field, coordinateSystem,
  sprite = null, spriteScale = 1,
  interactive = true, measureMode = false, resetToken = 0,
  history: sharedHistory,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // El draw actual vive en un ref para que el ResizeObserver se monte UNA vez
  // y no se recree en cada poll de valores (llegan a ~30Hz).
  const drawRef = useRef<() => void>(() => {})

  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const viewRef = useRef<View>({ ...IDENTITY_VIEW })
  // La matriz metros -> píxeles del último dibujo. Los handlers del puntero la
  // invierten para saber sobre qué punto de la cancha está el mouse.
  const matrixRef = useRef<DOMMatrix | null>(null)
  const dprRef = useRef(1)
  const cursorRef = useRef<InternalPose | null>(null)
  const measureRef = useRef<{ from: InternalPose; to: InternalPose } | null>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // Un historial propio si la página no comparte el suyo: las estelas y el
  // mapa de calor tienen que seguir funcionando en las tarjetas del dashboard.
  const ownHistory = useRef<HistoryStore | null>(null)
  if (ownHistory.current === null) ownHistory.current = new HistoryStore()
  const history = sharedHistory ?? ownHistory.current

  const heatmaps = useRef(new Map<string, Heatmap>())

  const sizeMeters = useMemo<[number, number]>(
    () => (field !== null ? field.sizeMeters : [FIELD_LENGTH_M, FIELD_WIDTH_M]),
    [field],
  )

  // La imagen se carga una sola vez por cancha; mientras tanto se dibuja el
  // esquemático, así que cambiar de cancha nunca deja el panel en blanco.
  useEffect(() => {
    if (field === null) {
      setImage(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => { if (!cancelled) setImage(img) }
    img.onerror = () => { if (!cancelled) setImage(null) }
    img.src = field.imageUrl
    return () => { cancelled = true }
  }, [field?.imageUrl])

  // Acumulación del historial. Va en su propio efecto y no dentro del dibujo:
  // el dibujo también corre al cambiar los ajustes o el tamaño, y eso metería
  // muestras repetidas que el mapa de calor contaría como tiempo real.
  useEffect(() => {
    const now = Date.now()
    objects.forEach(obj => {
      if (obj.type === "trajectory" || obj.type === "swerve") return
      history.get(obj.id).push(obj.poses, now)
    })
    history.prune(objects.map(o => o.id))
  }, [objects, history])

  useEffect(() => {
    viewRef.current = { ...IDENTITY_VIEW }
    drawRef.current()
  }, [resetToken])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const draw = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return

      // Redimensionar el canvas lo limpia por completo, así que solo se hace
      // cuando el tamaño cambió de verdad, no en cada frame de datos.
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      const pixelW = Math.round(width * dpr)
      const pixelH = Math.round(height * dpr)
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        canvas.width = pixelW
        canvas.height = pixelH
      }

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.lineCap = "round"
      ctx.lineJoin = "round"

      const view = viewRef.current
      const rotation = (-settings.orientation * Math.PI) / 180
      const cos = Math.abs(Math.cos(rotation))
      const sin = Math.abs(Math.sin(rotation))

      const useImage = field !== null && image !== null

      let ppmX: number
      let ppmY: number

      ctx.save()
      ctx.translate(width / 2 + view.panX, height / 2 + view.panY)
      ctx.scale(view.zoom, view.zoom)
      ctx.rotate(rotation)

      if (useImage) {
        const img = image!
        // Se encuadra la imagen ENTERA (no solo el área de juego): las paredes
        // y las estaciones de conductor son parte de lo que uno quiere ver.
        const rotW = img.naturalWidth * cos + img.naturalHeight * sin
        const rotH = img.naturalHeight * cos + img.naturalWidth * sin
        const scale = Math.min(width / rotW, height / rotH)

        const [tlx, tly] = field!.topLeft
        const [brx, bry] = field!.bottomRight
        ppmX = ((brx - tlx) * scale) / sizeMeters[0]
        ppmY = ((bry - tly) * scale) / sizeMeters[1]

        // La imagen se corre para que el CENTRO DEL ÁREA DE JUEGO (no el de la
        // foto) quede en el origen: el área de juego casi nunca está centrada
        // en la imagen, y todas las poses se miden desde su centro.
        const fieldCenterX = (tlx + brx) / 2
        const fieldCenterY = (tly + bry) / 2
        ctx.drawImage(
          img,
          -fieldCenterX * scale,
          -fieldCenterY * scale,
          img.naturalWidth * scale,
          img.naturalHeight * scale,
        )
      } else {
        const contentW = sizeMeters[0] + FIELD_MARGIN_M * 2
        const contentH = sizeMeters[1] + FIELD_MARGIN_M * 2
        const rotW = contentW * cos + contentH * sin
        const rotH = contentH * cos + contentW * sin
        ppmX = ppmY = Math.min(width / rotW, height / rotH)
      }

      // A partir de acá las unidades son METROS del marco interno.
      ctx.scale(ppmX, -ppmY)
      matrixRef.current = ctx.getTransform()

      // Píxeles de PANTALLA por metro, ya con el zoom aplicado: es la escala
      // con la que hay que convertir cualquier grosor o radio que deba
      // mantenerse constante mientras se hace zoom.
      const ppm = ppmX * view.zoom
      const px = (n: number) => n / ppm

      const flip = settings.allianceFlip
      const conv = (pose: FieldPose): InternalPose => {
        const internal = toInternal(coordinateSystem, pose.x, pose.y, pose.theta, sizeMeters)
        return flip ? flipInternal(internal) : internal
      }

      const matrix = matrixRef.current
      const project = (x: number, y: number) => {
        const point = matrix.transformPoint(new DOMPoint(x, y))
        return { x: point.x / dpr, y: point.y / dpr }
      }

      if (!useImage) drawSchematicField(ctx, px, sizeMeters, settings.showGrid, settings.gridSpacing)
      else if (settings.showGrid) drawGridOverlay(ctx, px, sizeMeters, settings.gridSpacing)

      if (settings.showAxes) drawOriginAxes(ctx, px, conv)

      const labels: Label[] = []
      const visible = objects.filter(o => !o.options.hidden)
      // El ancla de los objetos que no tienen pose propia: el primer robot de
      // la lista. Sin robot, un swerve o una marca de visión no sabrían dónde
      // pararse, así que simplemente no se dibujan.
      const anchor = visible.find(o => o.type === "robot" && o.poses.length > 0)
      const anchorPose = anchor ? conv(anchor.poses[0]) : null

      const env: DrawContext = {
        settings, anchorPose, sprite, spriteScale,
        heatmaps: heatmaps.current, history, sizeMeters,
        conv, project, labels,
      }

      const now = Date.now()
      const ordered = visible.slice().sort((a, b) => DRAW_ORDER[a.type] - DRAW_ORDER[b.type])

      for (const obj of ordered) {
        const opts = obj.options
        ctx.save()
        ctx.globalAlpha = opts.opacity

        if (opts.trailSeconds > 0 && obj.type !== "trajectory" && obj.type !== "heatmap") {
          const samples = history.get(obj.id).since(opts.trailSeconds, now)
          drawTrail(ctx, px, samples.map(conv), opts.trailColor ?? obj.color)
        }

        drawObject(ctx, px, obj, obj.poses.map(conv), env)

        if (settings.showLabels && opts.showLabel) {
          collectLabels(labels, obj, obj.poses, project, conv)
        }

        ctx.restore()
      }

      ctx.restore()

      // --- Pase de pantalla: todo lo que lleva texto ---
      drawLabels(ctx, labels)
      if (interactive) {
        drawMeasurement(ctx, measureRef.current, project, coordinateSystem, sizeMeters, flip)
        drawScaleBar(ctx, height, ppm, view.zoom)
        if (settings.showCursor) {
          drawCursorReadout(ctx, width, height, cursorRef.current, coordinateSystem, sizeMeters, flip)
        }
      }
    }

    drawRef.current = draw
    draw()
  }, [
    objects, settings, field, image, coordinateSystem, sizeMeters,
    sprite, spriteScale, interactive, history,
  ])

  // Redibujo por cambio de tamaño del contenedor, montado una sola vez.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // --- Puntero ---------------------------------------------------------------

  const toField = (event: { clientX: number; clientY: number }): InternalPose | null => {
    const matrix = matrixRef.current
    const canvas = canvasRef.current
    if (!matrix || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const dpr = dprRef.current
    const point = matrix.inverse().transformPoint(
      new DOMPoint((event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr),
    )
    return { x: point.x, y: point.y, theta: 0 }
  }

  const handleWheel = (event: React.WheelEvent) => {
    if (!interactive) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const view = viewRef.current

    // deltaY viene en píxeles o en líneas según el dispositivo; el signo es lo
    // único que importa acá, y un paso fijo hace el zoom predecible.
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
    if (next === view.zoom) return

    // Se conserva el punto bajo el cursor: hacer zoom siempre hacia el centro
    // obliga a repanear la vista después de cada rueda.
    const cx = event.clientX - rect.left - rect.width / 2
    const cy = event.clientY - rect.top - rect.height / 2
    const ratio = next / view.zoom
    view.panX = cx - (cx - view.panX) * ratio
    view.panY = cy - (cy - view.panY) * ratio
    view.zoom = next
    drawRef.current()
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!interactive) return
    if (event.button !== 0 && event.button !== 1) return
    canvasRef.current?.setPointerCapture(event.pointerId)

    if (measureMode && event.button === 0) {
      const point = toField(event)
      if (point) measureRef.current = { from: point, to: point }
      drawRef.current()
      return
    }

    const view = viewRef.current
    dragRef.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!interactive) return
    cursorRef.current = toField(event)

    const measure = measureRef.current
    if (measureMode && measure && dragRef.current === null && event.buttons === 1) {
      const point = toField(event)
      if (point) measureRef.current = { from: measure.from, to: point }
      drawRef.current()
      return
    }

    const drag = dragRef.current
    if (drag) {
      const view = viewRef.current
      view.panX = drag.panX + (event.clientX - drag.x)
      view.panY = drag.panY + (event.clientY - drag.y)
    }
    drawRef.current()
  }

  const endDrag = (event: React.PointerEvent) => {
    if (!interactive) return
    canvasRef.current?.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  const handlePointerLeave = () => {
    if (!interactive) return
    cursorRef.current = null
    dragRef.current = null
    drawRef.current()
  }

  const handleDoubleClick = () => {
    if (!interactive) return
    viewRef.current = { ...IDENTITY_VIEW }
    measureRef.current = null
    drawRef.current()
  }

  // Escape limpia la regla sin tener que apagar la herramienta.
  useEffect(() => {
    if (!interactive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      measureRef.current = null
      drawRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [interactive])

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        style={{
          display: "block",
          cursor: !interactive ? "default" : measureMode ? "crosshair" : "grab",
          touchAction: "none",
        }}
      />
    </div>
  )
}

// --- Cancha -----------------------------------------------------------------

// Se dibuja centrada en el origen, igual que la foto. La alianza AZUL va a la
// derecha porque es donde la deja el marco interno: en wall_blue el origen
// (esquina azul) es X=0, que se mapea a +X interno.
function drawSchematicField(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  size: [number, number],
  showGrid: boolean,
  gridSpacing: number,
) {
  const [length, widthM] = size
  const halfL = length / 2
  const halfW = widthM / 2

  ctx.fillStyle = "#fbfbfc"
  ctx.fillRect(-halfL, -halfW, length, widthM)

  // Zonas de alianza (un tercio de cancha a cada lado)
  const zone = length / 3
  ctx.fillStyle = "rgba(40, 90, 200, 0.07)"
  ctx.fillRect(halfL - zone, -halfW, zone, widthM)
  ctx.fillStyle = "rgba(200, 40, 40, 0.07)"
  ctx.fillRect(-halfL, -halfW, zone, widthM)

  if (showGrid) drawGrid(ctx, px, size, gridSpacing, "rgba(0, 0, 0, 0.07)")

  // Línea central
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)"
  ctx.lineWidth = px(1.5)
  ctx.beginPath()
  ctx.moveTo(0, -halfW)
  ctx.lineTo(0, halfW)
  ctx.stroke()

  // Perímetro
  ctx.strokeStyle = "#3f3f46"
  ctx.lineWidth = px(2)
  ctx.strokeRect(-halfL, -halfW, length, widthM)
}

/** La misma grilla, pero encima de la foto: sirve para leer distancias a ojo. */
function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  size: [number, number],
  gridSpacing: number,
) {
  drawGrid(ctx, px, size, gridSpacing, "rgba(255, 255, 255, 0.35)")

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)"
  ctx.lineWidth = px(1.5)
  ctx.strokeRect(-size[0] / 2, -size[1] / 2, size[0], size[1])
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  size: [number, number],
  spacing: number,
  color: string,
) {
  const step = spacing > 0.05 ? spacing : 1
  const halfL = size[0] / 2
  const halfW = size[1] / 2

  ctx.strokeStyle = color
  ctx.lineWidth = px(1)
  ctx.beginPath()
  for (let x = -Math.floor(halfL / step) * step; x < halfL; x += step) {
    ctx.moveTo(x, -halfW)
    ctx.lineTo(x, halfW)
  }
  for (let y = -Math.floor(halfW / step) * step; y < halfW; y += step) {
    ctx.moveTo(-halfL, y)
    ctx.lineTo(halfL, y)
  }
  ctx.stroke()
}

/**
 * Triedro en el (0, 0) del robot, dibujado pasando los ejes unitarios por la
 * misma conversión que las poses. Con eso se ve de un vistazo si el sistema de
 * coordenadas elegido es el que el robot está publicando: si la flecha roja no
 * apunta hacia la alianza contraria, el selector está mal.
 */
function drawOriginAxes(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  conv: (pose: FieldPose) => InternalPose,
) {
  const origin = conv({ x: 0, y: 0, theta: 0 })
  const axisX = conv({ x: 1, y: 0, theta: 0 })
  const axisY = conv({ x: 0, y: 1, theta: 0 })

  ctx.lineWidth = px(2.5)
  ctx.strokeStyle = "#c21c1c"
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(axisX.x, axisX.y)
  ctx.stroke()

  ctx.strokeStyle = "#1c8f1c"
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(axisY.x, axisY.y)
  ctx.stroke()

  ctx.fillStyle = "#18181b"
  ctx.beginPath()
  ctx.arc(origin.x, origin.y, px(3), 0, Math.PI * 2)
  ctx.fill()
}

// --- Objetos ----------------------------------------------------------------

interface DrawContext {
  settings: FieldSettings
  anchorPose: InternalPose | null
  sprite: RobotSprite | null
  spriteScale: number
  heatmaps: Map<string, Heatmap>
  history: HistoryStore
  sizeMeters: [number, number]
  conv: (pose: FieldPose) => InternalPose
  project: (x: number, y: number) => { x: number; y: number }
  labels: Label[]
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  obj: RenderedObject,
  poses: InternalPose[],
  env: DrawContext,
) {
  const opts = obj.options
  const length = env.settings.robotSizeMeters
  const widthM = env.settings.robotWidthMeters

  switch (obj.type) {
    case "trajectory":
      drawTrajectory(ctx, px, poses, obj.color, opts)
      break

    case "robot":
    case "ghost": {
      const ghost = obj.type === "ghost"
      const useSprite = opts.useModel && env.sprite !== null
      poses.forEach(pose => {
        if (useSprite) {
          drawSprite(ctx, pose, env.sprite!, env.spriteScale, ghost)
          if (env.settings.showBumpers) {
            drawChassisOutline(ctx, px, pose, length, widthM, obj.color, ghost)
          }
        } else {
          drawChassis(ctx, px, pose, length, widthM, obj.color, ghost)
        }
      })
      break
    }

    case "arrow":
      poses.forEach(pose => {
        ctx.save()
        ctx.translate(pose.x, pose.y)
        ctx.rotate(pose.theta)
        ctx.strokeStyle = obj.color
        ctx.fillStyle = obj.color
        ctx.lineWidth = px(2.5)
        drawAnchoredArrow(ctx, opts.arrowLength, opts.arrowAnchor)
        ctx.restore()
      })
      break

    case "heatmap":
      drawHeatmap(ctx, obj, env)
      break

    case "target":
      drawTargets(ctx, px, poses, obj, env)
      break

    case "swerve":
      if (env.anchorPose && obj.modules && obj.modules.length > 0) {
        drawSwerveModules(ctx, px, env.anchorPose, obj, length, widthM)
      }
      break
  }
}

// --- Trayectorias -----------------------------------------------------------

function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  poses: InternalPose[],
  color: string,
  opts: ResolvedObjectOptions,
) {
  if (poses.length === 0) return

  if (opts.trajectoryStyle === "points") {
    ctx.fillStyle = color
    poses.forEach(pose => {
      ctx.beginPath()
      ctx.arc(pose.x, pose.y, px(opts.trajectoryWidth * 0.9), 0, Math.PI * 2)
      ctx.fill()
    })
  } else if (poses.length >= 2) {
    ctx.lineWidth = px(opts.trajectoryWidth)

    if (opts.trajectoryStyle === "gradient") {
      // El degradado va del principio al final del camino: es la forma más
      // barata de ver hacia dónde corre la trayectoria sin llenarla de flechas.
      const first = poses[0]
      const last = poses[poses.length - 1]
      const gradient = ctx.createLinearGradient(first.x, first.y, last.x, last.y)
      gradient.addColorStop(0, withAlpha(color, 0.2))
      gradient.addColorStop(1, color)
      ctx.strokeStyle = gradient
    } else {
      ctx.strokeStyle = color
      if (opts.trajectoryStyle === "dashed") ctx.setLineDash([px(9), px(7)])
    }

    ctx.beginPath()
    poses.forEach((pose, i) => {
      if (i === 0) ctx.moveTo(pose.x, pose.y)
      else ctx.lineTo(pose.x, pose.y)
    })
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (opts.showWaypoints) {
    ctx.fillStyle = color
    poses.forEach(pose => {
      ctx.beginPath()
      ctx.arc(pose.x, pose.y, px(opts.trajectoryWidth * 0.8), 0, Math.PI * 2)
      ctx.fill()
    })
  }

  if (opts.showHeading) {
    // Como mucho una docena de flechas: una por waypoint sobre una trayectoria
    // de 300 puntos es una mancha sólida.
    const stride = Math.max(1, Math.ceil(poses.length / 12))
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = px(1.5)
    for (let i = 0; i < poses.length; i += stride) {
      const pose = poses[i]
      ctx.save()
      ctx.translate(pose.x, pose.y)
      ctx.rotate(pose.theta)
      drawAnchoredArrow(ctx, 0.35, "back")
      ctx.restore()
    }
  }

  // Principio y fin: sobre una cancha con varias trayectorias superpuestas es
  // lo primero que uno busca.
  if (poses.length >= 2) {
    const first = poses[0]
    const last = poses[poses.length - 1]

    ctx.lineWidth = px(2)
    ctx.strokeStyle = color
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.arc(first.x, first.y, px(4.5), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = color
    const side = px(7)
    ctx.fillRect(last.x - side / 2, last.y - side / 2, side, side)
  }
}

// --- Chasis -----------------------------------------------------------------

function drawChassis(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  pose: InternalPose,
  length: number,
  widthM: number,
  color: string,
  ghost: boolean,
) {
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.theta)

  const halfL = length / 2
  const halfW = widthM / 2
  // Bumper de 3" reales, acotado para que en un chasis chico no se coma todo.
  const bumper = Math.min(0.076, Math.min(length, widthM) * 0.16)
  const radius = Math.min(halfL, halfW) * 0.18

  if (ghost) {
    ctx.globalAlpha *= 0.55
    ctx.fillStyle = withAlpha(color, 0.16)
    roundRect(ctx, -halfL, -halfW, length, widthM, radius)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = px(2)
    ctx.setLineDash([px(7), px(5)])
    roundRect(ctx, -halfL, -halfW, length, widthM, radius)
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    // Bumpers de color por fuera y chasis oscuro por dentro: es la lectura que
    // uno ya tiene entrenada de mirar la cancha desde las gradas.
    ctx.fillStyle = color
    roundRect(ctx, -halfL, -halfW, length, widthM, radius)
    ctx.fill()

    ctx.fillStyle = "rgba(24, 24, 28, 0.92)"
    roundRect(
      ctx,
      -halfL + bumper, -halfW + bumper,
      length - bumper * 2, widthM - bumper * 2,
      Math.max(0, radius - bumper),
    )
    ctx.fill()

    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)"
    ctx.lineWidth = px(1)
    roundRect(ctx, -halfL, -halfW, length, widthM, radius)
    ctx.stroke()
  }

  // Cuña de frente: una flecha centrada se confunde con la del objeto de al
  // lado; una cuña pegada al bumper delantero, no.
  ctx.fillStyle = ghost ? withAlpha(color, 0.8) : "#ffffff"
  const tip = halfL - bumper * 1.2
  const back = tip - Math.min(halfL, halfW) * 0.55
  ctx.beginPath()
  ctx.moveTo(tip, 0)
  ctx.lineTo(back, halfW * 0.42)
  ctx.lineTo(back, -halfW * 0.42)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

/** Solo el contorno: se dibuja encima del modelo 3D para marcar los bumpers. */
function drawChassisOutline(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  pose: InternalPose,
  length: number,
  widthM: number,
  color: string,
  ghost: boolean,
) {
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.theta)

  const radius = Math.min(length, widthM) * 0.09
  ctx.strokeStyle = color
  ctx.lineWidth = px(ghost ? 1.5 : 2.5)
  if (ghost) ctx.setLineDash([px(7), px(5)])
  roundRect(ctx, -length / 2, -widthM / 2, length, widthM, radius)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.restore()
}

/**
 * El bitmap cenital del modelo, pegado en la pose.
 *
 * El `scale(1, -1)` es obligatorio: el canvas de la cancha trabaja con el eje
 * Y hacia arriba y `drawImage` asume lo contrario, así que sin ese giro el
 * robot saldría reflejado.
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  pose: InternalPose,
  sprite: RobotSprite,
  metersPerUnit: number,
  ghost: boolean,
) {
  const width = sprite.spanX * metersPerUnit
  const height = sprite.spanY * metersPerUnit
  if (!isFinite(width) || width <= 0 || height <= 0) return

  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.theta)
  ctx.scale(1, -1)
  if (ghost) ctx.globalAlpha *= 0.45
  ctx.drawImage(sprite.canvas, -width / 2, -height / 2, width, height)
  ctx.restore()
}

// --- Flechas ----------------------------------------------------------------

/** Flecha de largo `length` apuntando a +X, con el ancla pedida en el origen. */
function drawAnchoredArrow(
  ctx: CanvasRenderingContext2D,
  length: number,
  anchor: "front" | "center" | "back",
) {
  const back = anchor === "front" ? -length : anchor === "back" ? 0 : -length / 2
  const front = back + length
  const head = Math.min(length * 0.32, 0.3)

  ctx.beginPath()
  ctx.moveTo(back, 0)
  ctx.lineTo(front, 0)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(front, 0)
  ctx.lineTo(front - head, head * 0.55)
  ctx.lineTo(front - head, -head * 0.55)
  ctx.closePath()
  ctx.fill()
}

// --- Estelas ----------------------------------------------------------------

/**
 * La estela se dibuja por tramos con alfa creciente: un solo `stroke` con
 * degradado no sirve porque el camino se cruza consigo mismo y el degradado
 * lineal del canvas no sigue la curva.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  samples: InternalPose[],
  color: string,
) {
  if (samples.length < 2) return

  // Con 20 Hz y 10 s de estela hay 200 tramos; por encima de eso se saltean
  // muestras, que a esa escala son un par de milímetros.
  const stride = Math.max(1, Math.ceil(samples.length / 220))
  ctx.lineWidth = px(2)

  for (let i = stride; i < samples.length; i += stride) {
    const from = samples[i - stride]
    const to = samples[i]
    ctx.strokeStyle = withAlpha(color, 0.08 + 0.62 * (i / samples.length))
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
}

// --- Mapa de calor ----------------------------------------------------------

function drawHeatmap(ctx: CanvasRenderingContext2D, obj: RenderedObject, env: DrawContext) {
  const frame = {
    sizeMeters: env.sizeMeters,
    cell: obj.options.heatmapCell,
    radius: obj.options.heatmapRadius,
  }
  const signature = signatureOf(frame)

  let heatmap = env.heatmaps.get(obj.id)
  // Si cambió la cancha o algún parámetro, la grilla vieja ya no representa
  // nada: se tira y se rearma desde el historial completo.
  if (!heatmap || heatmap.signature !== signature) {
    heatmap = new Heatmap(frame)
    env.heatmaps.set(obj.id, heatmap)
  }

  const samples = env.history.get(obj.id).all()
  if (heatmap.consumed > samples.length) heatmap.reset()

  if (heatmap.consumed < samples.length) {
    // El historial guarda el dato CRUDO, así que la conversión de marco pasa
    // acá: cambiar la vista de alianza remapea el mapa entero en vez de
    // dejarlo pegado al encuadre con el que se grabó.
    const fresh: { x: number; y: number }[] = []
    for (let i = heatmap.consumed; i < samples.length; i++) {
      fresh.push(env.conv(samples[i]))
    }
    heatmap.add(fresh)
    heatmap.consumed = samples.length
  }

  const image = heatmap.toCanvas()
  if (!image) return

  const [length, widthM] = env.sizeMeters
  ctx.save()
  // Mismo giro que el sprite: la grilla se generó con la fila 0 arriba.
  ctx.scale(1, -1)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, -length / 2, -widthM / 2, length, widthM)
  ctx.restore()
}

// --- Marcas de visión -------------------------------------------------------

function drawTargets(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  poses: InternalPose[],
  obj: RenderedObject,
  env: DrawContext,
) {
  const opts = obj.options
  const anchor = env.anchorPose
  const radius = px(7)

  poses.forEach(pose => {
    if (opts.targetLines && anchor) {
      ctx.strokeStyle = withAlpha(obj.color, 0.65)
      ctx.lineWidth = px(1.5)
      ctx.setLineDash([px(6), px(5)])
      ctx.beginPath()
      ctx.moveTo(anchor.x, anchor.y)
      ctx.lineTo(pose.x, pose.y)
      ctx.stroke()
      ctx.setLineDash([])

      if (opts.targetLabels) {
        const distance = Math.hypot(pose.x - anchor.x, pose.y - anchor.y)
        // El ángulo se da RESPECTO DEL FRENTE del robot: es el error que hay
        // que corregir para apuntar, no una orientación absoluta.
        const bearing = normalizeAngle(
          Math.atan2(pose.y - anchor.y, pose.x - anchor.x) - anchor.theta,
        )
        const mid = env.project((anchor.x + pose.x) / 2, (anchor.y + pose.y) / 2)
        env.labels.push({
          x: mid.x,
          y: mid.y,
          text: `${distance.toFixed(2)} m  ${degrees(bearing).toFixed(0)}°`,
          color: obj.color,
        })
      }
    }

    // Retícula: círculo con una cruz. Se lee como "punto de interés" y no se
    // confunde con un waypoint de trayectoria.
    ctx.strokeStyle = obj.color
    ctx.lineWidth = px(2)
    ctx.beginPath()
    ctx.arc(pose.x, pose.y, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(pose.x - radius * 1.6, pose.y)
    ctx.lineTo(pose.x + radius * 1.6, pose.y)
    ctx.moveTo(pose.x, pose.y - radius * 1.6)
    ctx.lineTo(pose.x, pose.y + radius * 1.6)
    ctx.stroke()

    ctx.fillStyle = obj.color
    ctx.beginPath()
    ctx.arc(pose.x, pose.y, px(2), 0, Math.PI * 2)
    ctx.fill()
  })
}

// --- Módulos swerve ---------------------------------------------------------

function drawSwerveModules(
  ctx: CanvasRenderingContext2D,
  px: (n: number) => number,
  anchor: InternalPose,
  obj: RenderedObject,
  length: number,
  widthM: number,
) {
  const states = applyArrangement(obj.modules!, obj.options.swerveArrangement)
  const corners = moduleLocations(length, widthM)
  const maxSpeed = obj.options.swerveMaxSpeed
  const maxVector = Math.min(length, widthM) * 0.75

  ctx.save()
  ctx.translate(anchor.x, anchor.y)
  ctx.rotate(anchor.theta)

  corners.forEach((corner, i) => {
    const state = states[i]
    if (!state) return

    ctx.save()
    ctx.translate(corner.x, corner.y)

    // Marca del módulo: siempre visible, aunque la rueda esté quieta. Un
    // módulo parado pero girado 90° es exactamente el error que uno viene a
    // buscar acá.
    ctx.strokeStyle = withAlpha(obj.color, 0.8)
    ctx.lineWidth = px(1.5)
    ctx.beginPath()
    ctx.arc(0, 0, px(3.5), 0, Math.PI * 2)
    ctx.stroke()

    ctx.rotate(state.angle)
    const ratio = maxSpeed > 0 ? Math.min(1.4, Math.abs(state.speed) / maxSpeed) : 0
    const vector = Math.max(0.06, ratio * maxVector) * (state.speed < 0 ? -1 : 1)

    ctx.strokeStyle = obj.color
    ctx.fillStyle = obj.color
    ctx.lineWidth = px(2.5)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(vector, 0)
    ctx.stroke()

    if (Math.abs(vector) > 0.1) {
      const head = Math.min(0.12, Math.abs(vector) * 0.35) * (vector < 0 ? -1 : 1)
      ctx.beginPath()
      ctx.moveTo(vector, 0)
      ctx.lineTo(vector - head, Math.abs(head) * 0.55)
      ctx.lineTo(vector - head, -Math.abs(head) * 0.55)
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()
  })

  ctx.restore()
}

// --- Pase de texto ----------------------------------------------------------

function collectLabels(
  labels: Label[],
  obj: RenderedObject,
  poses: FieldPose[],
  project: (x: number, y: number) => { x: number; y: number },
  conv: (pose: FieldPose) => InternalPose,
) {
  if (poses.length === 0) return
  // Solo la primera pose: etiquetar los 300 puntos de una trayectoria taparía
  // la cancha entera.
  const raw = poses[0]
  const internal = conv(raw)
  const screen = project(internal.x, internal.y)

  const text = obj.type === "trajectory" || obj.type === "target"
    ? `${obj.label} (${poses.length})`
    : `${obj.label}  ${raw.x.toFixed(2)}, ${raw.y.toFixed(2)}, ${degrees(raw.theta).toFixed(0)}°`

  labels.push({ x: screen.x, y: screen.y - 16, text, color: obj.color })
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: Label[]) {
  if (labels.length === 0) return
  ctx.save()
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  labels.forEach(label => {
    const width = ctx.measureText(label.text).width + 10
    ctx.fillStyle = "rgba(16, 16, 20, 0.78)"
    roundRect(ctx, label.x - width / 2, label.y - 9, width, 18, 3)
    ctx.fill()
    ctx.fillStyle = label.color
    ctx.fillText(label.text, label.x, label.y)
  })

  ctx.restore()
}

function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  measure: { from: InternalPose; to: InternalPose } | null,
  project: (x: number, y: number) => { x: number; y: number },
  system: CoordinateSystem,
  sizeMeters: [number, number],
  flip: boolean,
) {
  if (!measure) return
  const distance = Math.hypot(measure.to.x - measure.from.x, measure.to.y - measure.from.y)
  if (distance === 0) return

  const from = project(measure.from.x, measure.from.y)
  const to = project(measure.to.x, measure.to.y)

  ctx.save()
  ctx.strokeStyle = "#f0b429"
  ctx.fillStyle = "#f0b429"
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.setLineDash([])

  for (const point of [from, to]) {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // El ángulo y los deltas se informan en el marco del robot y no en el
  // interno: son los números que uno va a escribir después en el código.
  const a = toUser(measure.from, system, sizeMeters, flip)
  const b = toUser(measure.to, system, sizeMeters, flip)
  const heading = degrees(Math.atan2(b.y - a.y, b.x - a.x))
  const text = `${distance.toFixed(3)} m · ${heading.toFixed(1)}° · Δ ${(b.x - a.x).toFixed(2)}, ${(b.y - a.y).toFixed(2)}`

  drawChip(ctx, (from.x + to.x) / 2, (from.y + to.y) / 2 - 18, text, "#f0b429")
  ctx.restore()
}

function drawCursorReadout(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cursor: InternalPose | null,
  system: CoordinateSystem,
  sizeMeters: [number, number],
  flip: boolean,
) {
  if (!cursor) return
  const user = toUser(cursor, system, sizeMeters, flip)
  drawChip(ctx, width - 12, height - 16, `x ${user.x.toFixed(2)}   y ${user.y.toFixed(2)}`, "#e6e6ea", "right")
}

/** Regla de referencia: sin ella, el zoom deja la escala en el aire. */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  height: number,
  ppm: number,
  zoom: number,
) {
  // Se elige el múltiplo "redondo" de metro cuya barra caiga por encima de
  // 60 px: una regla de 12 px no se puede leer.
  const candidates = [0.25, 0.5, 1, 2, 5, 10]
  const meters = candidates.find(m => m * ppm >= 60) ?? candidates[candidates.length - 1]
  const bar = meters * ppm
  if (!isFinite(bar) || bar <= 0) return

  const x = 14
  const y = height - 18

  ctx.save()
  ctx.strokeStyle = "rgba(240, 240, 244, 0.9)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y - 4)
  ctx.lineTo(x, y + 4)
  ctx.moveTo(x, y)
  ctx.lineTo(x + bar, y)
  ctx.moveTo(x + bar, y - 4)
  ctx.lineTo(x + bar, y + 4)
  ctx.stroke()

  ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  const text = `${meters} m   ·   ${Math.round(zoom * 100)}%`
  const textWidth = ctx.measureText(text).width + 8
  ctx.fillStyle = "rgba(16, 16, 20, 0.7)"
  roundRect(ctx, x - 4, y - 22, textWidth, 15, 3)
  ctx.fill()
  ctx.fillStyle = "rgba(240, 240, 244, 0.95)"
  ctx.fillText(text, x, y - 14)
  ctx.restore()
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  align: CanvasTextAlign = "center",
) {
  ctx.save()
  ctx.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace"
  ctx.textAlign = align
  ctx.textBaseline = "middle"
  const width = ctx.measureText(text).width + 12
  const left = align === "right" ? x - width + 6 : x - width / 2
  ctx.fillStyle = "rgba(16, 16, 20, 0.82)"
  roundRect(ctx, left, y - 9, width, 18, 3)
  ctx.fill()
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

// --- Utilidades -------------------------------------------------------------

function toUser(
  pose: InternalPose,
  system: CoordinateSystem,
  sizeMeters: [number, number],
  flip: boolean,
): InternalPose {
  const unflipped = flip ? flipInternal(pose) : pose
  return fromInternal(system, unflipped.x, unflipped.y, unflipped.theta, sizeMeters)
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/** Lleva un ángulo a (-π, π]. */
function normalizeAngle(radians: number): number {
  let angle = radians
  while (angle > Math.PI) angle -= 2 * Math.PI
  while (angle <= -Math.PI) angle += 2 * Math.PI
  return angle
}

/** Alfa sobre un color en hex; es lo único que se necesita de un parser CSS. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height - r)
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
  ctx.lineTo(x + r, y + height)
  ctx.arcTo(x, y + height, x, y + height - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
