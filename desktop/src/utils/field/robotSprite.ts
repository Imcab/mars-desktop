// Vista cenital de un modelo 3D, convertida en una imagen que el canvas 2D de
// la cancha puede pegar en la pose del robot.
//
// La alternativa era montar una escena three completa dentro del visualizador
// 2D, pero un robot visto desde arriba es SIEMPRE la misma imagen: solo cambia
// dónde se pega y cuánto se la gira. Así que se renderiza UNA vez con una
// cámara ortográfica mirando hacia abajo, se guarda el bitmap y a partir de
// ahí cada frame es un `drawImage` — que es lo que permite dibujar seis robots
// a 30 fps sin despeinarse.
//
// El marco es el mismo de todas las vistas 3D de la app (Z arriba, X adelante,
// Y a la izquierda), así que en la imagen resultante +X va a la derecha y +Y
// hacia arriba: pegarla con la rotación de la pose ya la deja apuntando bien.

import {
  AmbientLight, Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh,
  MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from "three"
import { instantiateModel, loadModel, materialsOf } from "./robotModel"

const DEG = Math.PI / 180

/** Techo del lado mayor del bitmap. Más que esto no se nota en pantalla. */
const MAX_SPRITE_PX = 1024
const MIN_SPRITE_PX = 96

export interface RobotSprite {
  canvas: HTMLCanvasElement
  /** Huella que cubre la imagen, en UNIDADES DEL ARCHIVO (no metros). */
  spanX: number
  spanY: number
  /** Triángulos del modelo, para avisar si es muy pesado. */
  triangles: number
}

export interface SpriteRequest {
  path: string
  /** Lado mayor del bitmap en píxeles. Se cuantiza para no re-renderizar al hacer zoom. */
  sizePx: number
  /** Color plano, o null para respetar los materiales del archivo. */
  color: string | null
  /** Giro en grados que lleva el frente del CAD a +X. */
  rotationDeg: number
}

// Un solo contexto WebGL para toda la app: los navegadores limitan cuántos
// puede haber vivos, y este se usa a ráfagas cortas.
let renderer: WebGLRenderer | null = null
let rendererBroken = false

const cache = new Map<string, Promise<RobotSprite>>()

function keyOf(req: SpriteRequest): string {
  return `${req.path}|${req.sizePx}|${req.color ?? "file"}|${req.rotationDeg}`
}

/**
 * Cuantiza el tamaño pedido a potencias de dos. Sin esto, cada píxel de zoom
 * dispararía un render nuevo del modelo entero.
 */
export function quantizeSpriteSize(pixels: number): number {
  const clamped = Math.min(MAX_SPRITE_PX, Math.max(MIN_SPRITE_PX, pixels))
  return Math.pow(2, Math.ceil(Math.log2(clamped)))
}

export function getRobotSprite(req: SpriteRequest): Promise<RobotSprite> {
  const key = keyOf(req)
  const hit = cache.get(key)
  if (hit) return hit

  const pending = render(req).catch(error => {
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

/** Tira los bitmaps de un modelo (al cambiarlo o soltarlo). */
export function forgetSprites(path?: string): void {
  if (path === undefined) {
    cache.clear()
    return
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${path}|`)) cache.delete(key)
  }
}

function getRenderer(): WebGLRenderer {
  if (renderer) return renderer
  if (rendererBroken) throw new Error("WebGL is not available in this window.")
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true })
    renderer.setClearAlpha(0)
    return renderer
  } catch (error) {
    rendererBroken = true
    throw new Error(`Could not start WebGL to render the model: ${String(error)}`)
  }
}

async function render(req: SpriteRequest): Promise<RobotSprite> {
  const model = await loadModel(req.path)

  const scene = new Scene()
  const group: Group = instantiateModel(model, "center")
  group.rotation.z = req.rotationDeg * DEG
  scene.add(group)
  group.updateMatrixWorld(true)

  if (req.color !== null) {
    const flat = new Color(req.color)
    materialsOf(group).forEach(material => {
      const standard = material as MeshStandardMaterial
      if (standard.color) standard.color.copy(flat)
    })
  }
  // Sin esto, un GLB con caras de una sola cara se ve agujereado desde arriba.
  group.traverse(child => {
    const mesh = child as Mesh
    if (mesh.isMesh) mesh.frustumCulled = false
  })

  // La caja se mide DESPUÉS del giro: es la huella real que va a ocupar el
  // robot en la cancha, y es lo que el auto-fit tiene que igualar al chasis.
  const box = new Box3().setFromObject(group)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  if (!isFinite(size.x) || size.x <= 0 || size.y <= 0) {
    throw new Error("The model has no footprint when seen from above.")
  }

  addLights(scene, size)

  const aspect = size.x / size.y
  const width = Math.max(8, Math.round(aspect >= 1 ? req.sizePx : req.sizePx * aspect))
  const height = Math.max(8, Math.round(aspect >= 1 ? req.sizePx / aspect : req.sizePx))

  // Ortográfica y no perspectiva: una cenital con perspectiva abre las
  // paredes del robot hacia afuera y la imagen deja de coincidir con la
  // huella que se está dibujando en la cancha.
  const camera = new OrthographicCamera(-size.x / 2, size.x / 2, size.y / 2, -size.y / 2, 0.01, size.z * 4 + 10)
  camera.position.set(center.x, center.y, box.max.z + size.z + 1)
  camera.up.set(0, 1, 0)
  camera.lookAt(center.x, center.y, box.min.z)

  const gl = getRenderer()
  gl.setPixelRatio(1)
  gl.setSize(width, height, false)
  gl.render(scene, camera)

  // El canvas del renderer se reutiliza para el próximo modelo, así que el
  // bitmap se copia a uno propio antes de devolverlo.
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not copy the rendered model.")
  ctx.drawImage(gl.domElement, 0, 0, width, height)

  scene.clear()

  return { canvas, spanX: size.x, spanY: size.y, triangles: model.triangles }
}

// Vista cenital: una luz solo desde arriba deja el techo del robot plano y sin
// relieve, así que la key se corre hacia adelante y a un costado.
function addLights(scene: Scene, size: Vector3): void {
  const reach = Math.max(size.x, size.y, size.z) * 3 + 1

  scene.add(new HemisphereLight(0xffffff, 0x8a8a92, 1.1))
  scene.add(new AmbientLight(0xffffff, 0.45))

  const key = new DirectionalLight(0xffffff, 1.5)
  key.position.set(reach * 0.5, reach * 0.7, reach)
  scene.add(key)

  const fill = new DirectionalLight(0xffffff, 0.45)
  fill.position.set(-reach * 0.6, -reach * 0.4, reach * 0.8)
  scene.add(fill)
}
