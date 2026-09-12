import { useEffect, useRef } from "react"
import { SwerveSettings, SwerveModuleRole } from "../../../store/appStore"
import { ModuleState, ChassisVelocities } from "../../../utils/field/swerveExtraction"
import { wrapDegrees } from "../../../utils/field/swerveKinematics"

export interface ModuleSet {
  id: string
  label: string
  color: string
  values: ModuleState[]  // ya reordenados a FL, FR, BL, BR
  role?: SwerveModuleRole
}

export interface ChassisSet {
  id: string
  label: string
  color: string
  value: ChassisVelocities
}

interface Props {
  moduleSets: ModuleSet[]
  chassisSets: ChassisSet[]
  rotation: number       // radianes; orientación del chasis
  settings: SwerveSettings
  /** Vectores que la cinemática predice para cada módulo (FL, FR, BL, BR). */
  predicted?: ModuleState[]
  /** Centro instantáneo de rotación, en metros del marco del robot. */
  icr?: { x: number; y: number } | null
}

// Esquinas en coordenadas del robot (X adelante, Y a la izquierda), en el
// orden en que se dibujan: FL, FR, BL, BR.
const CORNERS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export default function SwerveCanvas({ moduleSets, chassisSets, rotation, settings, predicted, icr }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const draw = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return

      const dpr = window.devicePixelRatio || 1
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

      const size = Math.min(width, height)
      const center: [number, number] = [width / 2, height / 2]
      const theta = rotation + (settings.orientation * Math.PI) / 180

      // Escala: el chasis ocupa ~40% del lado corto, dejando lugar para los
      // vectores de velocidad y las etiquetas numéricas.
      const maxFrame = Math.max(settings.frameLength, settings.frameWidth) || 1
      const pxPerMeter = (size * 0.4) / maxFrame
      const halfL = (settings.frameLength * pxPerMeter) / 2
      const halfW = (settings.frameWidth * pxPerMeter) / 2
      const moduleRadius = size * 0.05
      const fullVector = size * 0.22

      drawFrame(ctx, center, theta, halfL, halfW, moduleRadius)
      drawHeading(ctx, center, theta, halfL, halfW)

      // Módulos: un anillo por esquina, y encima los datos de cada set.
      CORNERS.forEach((corner, index) => {
        const moduleCenter = transformPx(center, theta, [halfL * corner[0], halfW * corner[1]])

        // Vector "ideal" según el ajuste de cuerpo rígido, en gris punteado y
        // por debajo del medido: la separación entre ambos ES el residuo.
        const predictedState = predicted?.[index]
        if (settings.showPredicted && predictedState) {
          drawPredictedVector(ctx, moduleCenter, theta, predictedState, moduleRadius, fullVector, settings.maxSpeed)
        }

        moduleSets.forEach(set => {
          const state = set.values[index]
          if (!state) return
          drawModuleState(ctx, moduleCenter, theta, state, set.color, moduleRadius, fullVector, settings)
        })

        // Anillo del módulo. Si algún set supera la rapidez máxima configurada
        // se marca en rojo: es el síntoma de que falta desaturar velocidades.
        const overSpeed = moduleSets.some(set => {
          const s = set.values[index]
          return s !== undefined && Math.abs(s.speed) > settings.maxSpeed
        })
        ctx.strokeStyle = overSpeed ? "#c21c1c" : "#2b2b30"
        ctx.lineWidth = overSpeed ? 3.5 : 2.5
        ctx.beginPath()
        ctx.arc(moduleCenter[0], moduleCenter[1], moduleRadius, 0, Math.PI * 2)
        ctx.stroke()

        if (settings.showValues) {
          drawModuleLabel(ctx, moduleCenter, moduleSets, index, moduleRadius)
        }
      })

      chassisSets.forEach(set => {
        drawChassisVelocity(ctx, center, theta, set, halfW, moduleRadius, fullVector, settings.maxSpeed)
      })

      if (settings.showICR && icr) {
        drawICR(ctx, center, theta, icr, pxPerMeter, size)
      }
    }

    drawRef.current = draw
    draw()
  }, [moduleSets, chassisSets, rotation, settings, predicted, icr])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => drawRef.current())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  )
}

// --- Helpers geométricos ----------------------------------------------------

// Punto (x, y) en coordenadas del robot -> píxeles de pantalla. El eje Y de la
// pantalla apunta hacia abajo, por eso se resta.
function transformPx(center: [number, number], rotation: number, point: [number, number]): [number, number] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [
    center[0] + point[0] * cos - point[1] * sin,
    center[1] - (point[0] * sin + point[1] * cos),
  ]
}

// Verde -> amarillo -> rojo según qué fracción del máximo se está usando.
function speedColor(ratio: number): string {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  return `hsl(${Math.round(130 * (1 - clamped))}, 72%, 40%)`
}

// --- Dibujo -----------------------------------------------------------------

function drawFrame(
  ctx: CanvasRenderingContext2D,
  center: [number, number],
  theta: number,
  halfL: number,
  halfW: number,
  moduleRadius: number,
) {
  ctx.strokeStyle = "#2b2b30"
  ctx.lineWidth = 3

  // Cuatro lados con hueco en las esquinas, para que los módulos "encajen"
  // en el chasis en vez de quedar tapados por la línea.
  const edges: [[number, number], [number, number]][] = [
    [[halfL, halfW - moduleRadius], [halfL, -halfW + moduleRadius]],      // frente
    [[-halfL, halfW - moduleRadius], [-halfL, -halfW + moduleRadius]],    // atrás
    [[halfL - moduleRadius, halfW], [-halfL + moduleRadius, halfW]],      // izquierda
    [[halfL - moduleRadius, -halfW], [-halfL + moduleRadius, -halfW]],    // derecha
  ]

  edges.forEach(([from, to]) => {
    ctx.beginPath()
    ctx.moveTo(...transformPx(center, theta, from))
    ctx.lineTo(...transformPx(center, theta, to))
    ctx.stroke()
  })
}

// Flecha central que marca hacia dónde apunta el frente del chasis.
function drawHeading(
  ctx: CanvasRenderingContext2D,
  center: [number, number],
  theta: number,
  halfL: number,
  halfW: number,
) {
  ctx.strokeStyle = "#2b2b30"
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(...transformPx(center, theta, [-halfL * 0.35, 0]))
  ctx.lineTo(...transformPx(center, theta, [halfL * 0.35, 0]))
  ctx.moveTo(...transformPx(center, theta, [halfL * 0.15, halfW * 0.18]))
  ctx.lineTo(...transformPx(center, theta, [halfL * 0.35, 0]))
  ctx.lineTo(...transformPx(center, theta, [halfL * 0.15, -halfW * 0.18]))
  ctx.stroke()
}

function drawModuleState(
  ctx: CanvasRenderingContext2D,
  moduleCenter: [number, number],
  theta: number,
  state: ModuleState,
  baseColor: string,
  moduleRadius: number,
  fullVector: number,
  settings: SwerveSettings,
) {
  const ratio = settings.maxSpeed > 0 ? Math.abs(state.speed) / settings.maxSpeed : 0
  const color = settings.gradient ? speedColor(ratio) : baseColor
  const fullRotation = theta + state.angle

  // Cuña que indica hacia dónde apunta el módulo.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(...moduleCenter)
  ctx.arc(
    moduleCenter[0], moduleCenter[1], moduleRadius,
    -(fullRotation + (5 * Math.PI) / 6),
    -(fullRotation - (5 * Math.PI) / 6),
  )
  ctx.closePath()
  ctx.fill()

  // Vector de rapidez. Una rapidez negativa apunta hacia atrás.
  if (Math.abs(state.speed) < 0.02) return
  const vectorRotation = state.speed < 0 ? fullRotation + Math.PI : fullRotation
  // Se deja pasar un poco del 100% para que la desaturación se vea a simple vista.
  const length = Math.min(ratio, 1.35) * fullVector

  ctx.strokeStyle = color
  ctx.lineWidth = 3
  const back = transformPx(moduleCenter, vectorRotation, [moduleRadius, 0])
  const front = transformPx(moduleCenter, vectorRotation, [moduleRadius + length, 0])
  const left = transformPx(moduleCenter, vectorRotation, [moduleRadius + length - moduleRadius * 0.45, moduleRadius * 0.45])
  const right = transformPx(moduleCenter, vectorRotation, [moduleRadius + length - moduleRadius * 0.45, -moduleRadius * 0.45])

  ctx.beginPath()
  ctx.moveTo(...back)
  ctx.lineTo(...front)
  ctx.moveTo(...left)
  ctx.lineTo(...front)
  ctx.lineTo(...right)
  ctx.stroke()
}

// Vector que el módulo TENDRÍA si el movimiento fuera perfectamente rígido.
// Punteado y en gris para que se lea como referencia, no como dato medido.
function drawPredictedVector(
  ctx: CanvasRenderingContext2D,
  moduleCenter: [number, number],
  theta: number,
  state: ModuleState,
  moduleRadius: number,
  fullVector: number,
  maxSpeed: number,
) {
  if (Math.abs(state.speed) < 0.02 || maxSpeed <= 0) return

  const ratio = Math.abs(state.speed) / maxSpeed
  const rotation = state.speed < 0 ? theta + state.angle + Math.PI : theta + state.angle
  const length = Math.min(ratio, 1.35) * fullVector

  ctx.save()
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = "rgba(80, 80, 90, 0.75)"
  ctx.lineWidth = 2

  const back = transformPx(moduleCenter, rotation, [moduleRadius, 0])
  const front = transformPx(moduleCenter, rotation, [moduleRadius + length, 0])
  ctx.beginPath()
  ctx.moveTo(...back)
  ctx.lineTo(...front)
  ctx.stroke()
  ctx.restore()
}

// Centro instantáneo de rotación: el punto del plano que en este instante
// tiene velocidad cero. Si cae dentro del chasis, el robot está girando sobre
// sí mismo; si se va lejos, el movimiento es casi traslación pura.
function drawICR(
  ctx: CanvasRenderingContext2D,
  center: [number, number],
  theta: number,
  icr: { x: number; y: number },
  pxPerMeter: number,
  size: number,
) {
  const point = transformPx(center, theta, [icr.x * pxPerMeter, icr.y * pxPerMeter])

  // Si queda muy afuera del lienzo no se dibuja: el marcador estaría fuera de
  // pantalla y la línea punteada sola no aporta.
  const margin = size
  if (
    point[0] < center[0] - margin || point[0] > center[0] + margin ||
    point[1] < center[1] - margin || point[1] > center[1] + margin
  ) return

  const r = size * 0.02

  ctx.save()
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = "rgba(124, 58, 237, 0.5)"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(center[0], center[1])
  ctx.lineTo(point[0], point[1])
  ctx.stroke()
  ctx.restore()

  ctx.strokeStyle = "#7c3aed"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(point[0], point[1], r, 0, Math.PI * 2)
  ctx.moveTo(point[0] - r * 1.8, point[1])
  ctx.lineTo(point[0] + r * 1.8, point[1])
  ctx.moveTo(point[0], point[1] - r * 1.8)
  ctx.lineTo(point[0], point[1] + r * 1.8)
  ctx.stroke()

  ctx.font = "10px 'Segoe UI', Arial, sans-serif"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "#7c3aed"
  ctx.fillText("ICR", point[0] + r * 2.4, point[1])
}

// Etiqueta numérica junto al módulo: rapidez y ángulo de cada set.
function drawModuleLabel(
  ctx: CanvasRenderingContext2D,
  moduleCenter: [number, number],
  moduleSets: ModuleSet[],
  index: number,
  moduleRadius: number,
) {
  const lines = moduleSets
    .map(set => {
      const s = set.values[index]
      if (!s) return null
      const deg = wrapDegrees((s.angle * 180) / Math.PI).toFixed(0)
      return { text: `${s.speed.toFixed(2)} m/s  ${deg}°`, color: set.color }
    })
    .filter((l): l is { text: string; color: string } => l !== null)

  if (lines.length === 0) return

  ctx.font = "10px 'Segoe UI', Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"

  const top = moduleCenter[1] + moduleRadius + 4
  const widest = Math.max(...lines.map(l => ctx.measureText(l.text).width))

  // Fondo semitransparente para que los números se lean sobre los vectores.
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)"
  ctx.fillRect(moduleCenter[0] - widest / 2 - 3, top - 2, widest + 6, lines.length * 12 + 4)

  lines.forEach((line, i) => {
    ctx.fillStyle = line.color
    ctx.fillText(line.text, moduleCenter[0], top + i * 12)
  })
}

// Velocidad del chasis completo: flecha lineal desde el centro + arco de giro.
function drawChassisVelocity(
  ctx: CanvasRenderingContext2D,
  center: [number, number],
  theta: number,
  set: ChassisSet,
  halfW: number,
  moduleRadius: number,
  fullVector: number,
  maxSpeed: number,
) {
  const { vx, vy, omega } = set.value
  ctx.strokeStyle = set.color
  ctx.lineWidth = 3

  const linear = Math.hypot(vx, vy)
  if (linear >= 0.02 && maxSpeed > 0) {
    const angle = Math.atan2(vy, vx)
    const length = Math.min(linear / maxSpeed, 1.35) * fullVector
    const direction = theta + angle

    const front = transformPx(center, direction, [length, 0])
    const left = transformPx(center, direction, [length - moduleRadius * 0.45, moduleRadius * 0.45])
    const right = transformPx(center, direction, [length - moduleRadius * 0.45, -moduleRadius * 0.45])

    ctx.beginPath()
    ctx.moveTo(center[0], center[1])
    ctx.lineTo(...front)
    ctx.moveTo(...left)
    ctx.lineTo(...front)
    ctx.lineTo(...right)
    ctx.stroke()
  }

  // Giro: arco proporcional a ω, en el sentido correspondiente.
  if (Math.abs(omega) > 0.05) {
    const radius = halfW * 0.5
    ctx.beginPath()
    ctx.arc(center[0], center[1], radius, -theta, -(theta + omega), omega > 0)
    ctx.stroke()

    const tip = transformPx(center, theta + omega, [radius, 0])
    const tail = transformPx(center, theta + omega - 0.3 * Math.sign(omega), [radius - moduleRadius * 0.4, 0])
    const tail2 = transformPx(center, theta + omega - 0.3 * Math.sign(omega), [radius + moduleRadius * 0.4, 0])
    ctx.beginPath()
    ctx.moveTo(...tail)
    ctx.lineTo(...tip)
    ctx.lineTo(...tail2)
    ctx.stroke()
  }
}
