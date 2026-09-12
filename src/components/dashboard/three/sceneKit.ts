// Piezas de three.js compartidas por las vistas 3D (Swerve 3D, Mechanism 3D).
//
// Todas las escenas de la app trabajan con Z ARRIBA, X adelante y Y a la
// izquierda, que es el marco de WPILib: así los ángulos y las poses que
// publica el robot entran tal cual salen de NT, sin conversiones sueltas
// repartidas por el código.

import {
  BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry,
  Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera,
  Scene, Sprite, SpriteMaterial, AmbientLight, DirectionalLight, HemisphereLight,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

export const DEG = Math.PI / 180

/** Eje X rojo, Y verde, Z azul — el mismo código de color que RViz y WPILib. */
export const AXIS_COLORS = [0xc21c1c, 0x1c8f1c, 0x2f6fdb] as const

// --- Luces -------------------------------------------------------------------

/** Iluminación neutra: una key alta, un fill opuesto y ambiente para las sombras. */
export function addStandardLights(scene: Scene) {
  scene.add(new HemisphereLight(0xffffff, 0x9a9aa2, 1.4))
  scene.add(new AmbientLight(0xffffff, 0.35))

  const key = new DirectionalLight(0xffffff, 1.4)
  key.position.set(2.5, 3, 5)
  scene.add(key)

  const fill = new DirectionalLight(0xffffff, 0.5)
  fill.position.set(-3, -2, 2)
  scene.add(fill)
}

// --- Cámara ------------------------------------------------------------------

export function makeOrbitControls(
  camera: PerspectiveCamera | OrthographicCamera,
  dom: HTMLElement,
  options: { minDistance?: number; maxDistance?: number } = {},
): OrbitControls {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.minDistance = options.minDistance ?? 0.2
  controls.maxDistance = options.maxDistance ?? 40
  // Un poco antes del horizonte: mirar exactamente de canto deja la escena
  // reducida a una línea.
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  return controls
}

// --- Geometría de apoyo -------------------------------------------------------

/**
 * Grilla de piso en el plano XY. Conviene dibujarla mucho más grande que el
 * encuadre: las vistas que la desplazan (el piso móvil del swerve) no deben
 * dejar ver nunca dónde termina.
 */
export function makeFloorGrid(halfSize: number, cell: number, color = 0x9a9aa2): LineSegments {
  const points: number[] = []
  for (let i = -halfSize; i <= halfSize + 1e-6; i += cell) {
    points.push(i, -halfSize, 0, i, halfSize, 0)
    points.push(-halfSize, i, 0, halfSize, i, 0)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3))
  return new LineSegments(geometry, new LineBasicMaterial({
    color, transparent: true, opacity: 0.55,
  }))
}

/** Triedro X/Y/Z desde el origen del grupo en que se cuelgue. */
export function makeAxes(length: number): Group {
  const group = new Group()
  const directions: [number, number, number][] = [
    [length, 0, 0],
    [0, length, 0],
    [0, 0, length],
  ]
  directions.forEach((direction, i) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(
      [0, 0, 0.002, direction[0], direction[1], direction[2] + 0.002], 3,
    ))
    group.add(new LineSegments(geometry, new LineBasicMaterial({ color: AXIS_COLORS[i] })))
  })
  return group
}

/**
 * Flecha a lo largo de +X, de largo unitario. Se estira con `setArrowLength`
 * en vez de reconstruirse: escalar solo el cuerpo deja la punta sin deformar.
 */
export function makeArrow(color: string | number, radius: number): Group {
  const head = radius * 3.2
  const group = new Group()
  const material = new MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.55 })

  const shaft = new Mesh(
    new CylinderGeometry(radius, radius, 1, 10).rotateZ(-Math.PI / 2).translate(0.5, 0, 0),
    material,
  )
  shaft.name = "shaft"

  const tip = new Mesh(
    new ConeGeometry(radius * 2.2, head, 14).rotateZ(-Math.PI / 2).translate(head / 2, 0, 0),
    material,
  )
  tip.name = "head"

  group.add(shaft, tip)
  group.userData.headLength = head
  return group
}

/** `length` es el largo TOTAL de la flecha, punta incluida. */
export function setArrowLength(arrow: Group, length: number) {
  const head: number = arrow.userData.headLength
  arrow.visible = length > head * 0.6
  if (!arrow.visible) return

  const body = Math.max(length - head, 1e-4)
  arrow.getObjectByName("shaft")!.scale.x = body
  arrow.getObjectByName("head")!.position.x = body
}

export function arrowMaterial(arrow: Group): MeshStandardMaterial {
  return (arrow.getObjectByName("shaft") as Mesh).material as MeshStandardMaterial
}

export function setArrowOpacity(arrow: Group, opacity: number) {
  const material = arrowMaterial(arrow)
  material.transparent = opacity < 1
  material.opacity = opacity
  material.depthWrite = opacity >= 1
}

/**
 * Etiqueta de texto que siempre mira a la cámara. `depthTest: false` a
 * propósito: una etiqueta tapada por la pieza que nombra no sirve de nada.
 */
export function makeTextSprite(text: string, options: {
  /** Alto del sprite en metros de la escena. */
  height?: number
  color?: string
  background?: string
} = {}): Sprite {
  const height = options.height ?? 0.1
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!

  ctx.font = "bold 38px 'Segoe UI', Arial, sans-serif"
  const textWidth = Math.max(ctx.measureText(text).width, 8)
  canvas.width = Math.ceil(textWidth) + 24
  canvas.height = 64

  // Cambiar el tamaño del canvas resetea el contexto, así que la fuente se
  // vuelve a fijar después de dimensionarlo.
  ctx.font = "bold 38px 'Segoe UI', Arial, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = options.background ?? "rgba(255,255,255,0.85)"
  ctx.fillRect(0, 10, canvas.width, 44)
  ctx.fillStyle = options.color ?? "#1c1c1f"
  ctx.fillText(text, canvas.width / 2, 33)

  const sprite = new Sprite(new SpriteMaterial({
    map: new CanvasTexture(canvas), depthTest: false, transparent: true,
  }))
  sprite.scale.set((canvas.width / canvas.height) * height, height, 1)
  sprite.renderOrder = 10
  return sprite
}

/** Verde -> amarillo -> rojo según qué fracción del máximo se esté usando. */
export function ratioColor(ratio: number): Color {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  return new Color().setHSL((130 * (1 - clamped)) / 360, 0.72, 0.4)
}

// --- Limpieza ----------------------------------------------------------------

/**
 * Vacía un grupo liberando geometrías y materiales. Se usa cada vez que la
 * configuración cambia y hay que reconstruir: sin esto, tocar un checkbox
 * cincuenta veces deja cincuenta mallas huérfanas en la GPU.
 */
export function disposeGroup(group: Group) {
  group.children.slice().forEach(child => {
    group.remove(child)
    disposeObject(child)
  })
}

export function disposeObject(object: Object3D) {
  object.traverse((node: Object3D) => {
    const mesh = node as Mesh
    mesh.geometry?.dispose()
    const material = (mesh as any).material
    if (Array.isArray(material)) material.forEach((m: any) => m?.dispose())
    else material?.dispose()
  })
}
