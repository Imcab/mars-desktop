// Los objetos que se dibujan SOBRE la cancha 3D: robots, fantasmas, piezas
// articuladas, trayectorias, marcas de visión, piezas de juego y marcadores.
//
// Cada tipo se construye una vez (cuando cambia la configuración) y después
// solo se ACTUALIZA por frame. Reconstruir la geometría en cada muestra sería
// lo más simple de escribir y lo peor de usar: con un par de trayectorias y un
// robot con componentes, la recolección de basura sola ya se come el
// presupuesto de 16 ms.
//
// Todo trabaja en el marco del modelo de la cancha: origen al centro, +X hacia
// el rojo, +Y hacia la izquierda vista desde el azul, +Z arriba. La página ya
// convirtió las poses antes de llegar acá.

import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, ConeGeometry, DoubleSide,
  DynamicDrawUsage, EdgesGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  LineSegments, Mesh, MeshPhongMaterial, Object3D, Points, PointsMaterial,
  SphereGeometry, TubeGeometry, Vector3,
} from "three"
import {
  Field3dObjectType, Field3dQuality, Field3dSettings,
} from "../../../store/appStore"
import { Pose3D, composePose, IDENTITY_POSE } from "../../../utils/field3d/frames"
import { ResolvedField3dOptions } from "../../../utils/field3d/objects"
import { GamePieceConfig, RobotAssetConfig, composeRotations } from "../../../utils/field3d/assetConfig"
import { LoadedAsset, disposeSceneTree, instantiateAsset } from "../../../utils/field3d/assetModels"
import { TrailStore } from "../../../utils/field3d/trails"
import { makeAxes, makeTextSprite } from "../three/sceneKit"

/** Un objeto de la lista con sus poses de este frame, ya en el marco del modelo. */
export interface RenderedField3dObject {
  id: string
  type: Field3dObjectType
  color: string
  label: string
  poses: Pose3D[]
  options: ResolvedField3dOptions
}

export interface RobotAssetEntry {
  config: RobotAssetConfig
  base: LoadedAsset
  /** `model_0.glb`, `model_1.glb`... en el orden de `config.components`. */
  components: LoadedAsset[]
}

export interface GamePieceEntry {
  config: GamePieceConfig
  asset: LoadedAsset | null
}

export interface VisualContext {
  settings: Field3dSettings
  quality: Field3dQuality
  robotAssets: Map<string, RobotAssetEntry>
  gamePieces: GamePieceEntry[]
}

/** Lo que cambia en cada frame y necesitan varios tipos de objeto. */
export interface FrameContext {
  now: number
  trails: TrailStore
  /** Pose del objeto `robot` al que se ancla un componente o una visión. */
  anchorPose: (anchorId: string | null) => Pose3D | null
  /** Cámara del asset del robot anclado, ya compuesta con su pose. */
  anchorCamera: (anchorId: string | null, cameraIndex: number) => Pose3D | null
}

export interface ObjectVisual {
  group: Group
  update(object: RenderedField3dObject, frame: FrameContext): void
  dispose(): void
}

// --- Utilidades compartidas ---------------------------------------------------

/** three guarda el cuaternión como (x, y, z, w); WPILib lo publica como (w, x, y, z). */
export function applyPose(object: Object3D, pose: Pose3D) {
  object.position.set(pose.x, pose.y, pose.z)
  object.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw)
}

function tint(object: Object3D, color: string | null, opacity: number, quality: Field3dQuality) {
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach(material => {
      const phong = material as MeshPhongMaterial
      if (color !== null) {
        // Los modelos importados traen su color en un atributo de VÉRTICE, y
        // ese atributo se MULTIPLICA con `material.color`. Sin apagarlo, pintar
        // un fantasma de azul daría azul-por-el-color-original, o sea casi
        // negro. Apagarlo es lo que hace que el color pedido sea el que se ve.
        phong.vertexColors = false
        phong.color?.set(color)
      }
      phong.transparent = opacity < 1
      phong.opacity = opacity
      // Sin esto, un fantasma se tapa a sí mismo: las caras traseras escriben
      // profundidad y las delanteras quedan descartadas contra ellas.
      phong.depthWrite = opacity >= 1
      phong.side = DoubleSide
      phong.needsUpdate = true
    })
    mesh.castShadow = quality === "cinematic" && opacity >= 1
    mesh.receiveShadow = false
  })
}

/**
 * Chasis genérico: una caja con bumpers del color del objeto y una cuña al
 * frente. Es lo que se ve mientras el equipo no haya importado su CAD, y tiene
 * que ser suficiente por sí solo — la mayoría de las prácticas se miran así.
 */
function makeGenericChassis(settings: Field3dSettings, color: string): Group {
  const group = new Group()
  const { robotLength: length, robotWidth: width, robotHeight: height } = settings

  // El bumper es el anillo exterior de color; el cuerpo va gris y un poco más
  // chico, para que el color no se coma toda la silueta.
  const bumperHeight = Math.min(height * 0.35, 0.13)
  const bumper = new Mesh(
    new BoxGeometry(length, width, bumperHeight),
    new MeshPhongMaterial({ color, shininess: 0 }),
  )
  bumper.position.z = bumperHeight / 2 + 0.05
  group.add(bumper)

  const body = new Mesh(
    new BoxGeometry(length * 0.88, width * 0.88, height),
    new MeshPhongMaterial({ color: 0xababb4, shininess: 12 }),
  )
  body.position.z = height / 2
  group.add(body)

  const outline = new LineSegments(
    new EdgesGeometry(new BoxGeometry(length, width, height)),
    new LineBasicMaterial({ color: 0x1c1c22 }),
  )
  outline.position.z = height / 2
  group.add(outline)

  // Cuña al frente: sin ella no hay forma de saber hacia dónde mira el robot
  // cuando la cámara lo ve desde arriba, que es la vista más usada.
  const nose = new Mesh(
    new ConeGeometry(width * 0.12, length * 0.2, 4).rotateZ(-Math.PI / 2),
    new MeshPhongMaterial({ color: 0xf2f2f5, shininess: 0 }),
  )
  nose.position.set(length * 0.38, 0, height + 0.03)
  group.add(nose)

  return group
}

/**
 * Nodo intermedio con la colocación "en cero" que declara el asset.
 *
 * Los componentes y las cámaras de un asset de robot vienen exportados en el
 * origen; `zeroedPosition`/`zeroedRotations` dicen dónde van cuando la pose
 * publicada es la identidad. Meterlo como un nodo aparte deja que la pose
 * publicada se aplique al PADRE, que es exactamente la composición que hace
 * AdvantageScope.
 */
function makeZeroedSlot(position: [number, number, number], rotations: ReturnType<typeof composeRotations>): Group {
  const slot = new Group()
  slot.position.set(position[0], position[1], position[2])
  slot.quaternion.set(rotations[1], rotations[2], rotations[3], rotations[0])
  return slot
}

// --- Robot y fantasma ---------------------------------------------------------

function createRobot(object: RenderedField3dObject, ctx: VisualContext): ObjectVisual {
  const group = new Group()
  group.name = `robot:${object.id}`

  const entry = object.options.robotAssetKey
    ? ctx.robotAssets.get(object.options.robotAssetKey)
    : undefined

  let instance: Object3D
  let usedModel = false
  if (entry && object.options.useModel) {
    // El asset trae su propia orientación y su propio desplazamiento respecto
    // del centro del robot; el nodo de colocación los aplica una sola vez.
    const slot = makeZeroedSlot(entry.config.position, composeRotations(entry.config.rotations))
    slot.add(instantiateAsset(entry.base))
    instance = slot
    usedModel = true
  } else {
    instance = makeGenericChassis(ctx.settings, object.color)
  }

  // Con modelo importado se respetan sus materiales salvo que sea un fantasma:
  // ahí el color del objeto es la única forma de distinguirlo del robot real.
  const isGhost = object.type === "ghost"
  tint(instance, usedModel && !isGhost ? null : object.color, object.options.opacity, ctx.quality)

  // El grupo exterior se queda en el origen de la cancha y solo el interior se
  // mueve con la pose. La estela vive en coordenadas de CANCHA: colgada del
  // grupo que gira con el robot, se vería girar con él en vez de quedarse
  // marcada en el piso.
  const poseGroup = new Group()
  poseGroup.add(instance)
  group.add(poseGroup)

  if (object.options.showLabel) {
    const label = makeTextSprite(object.label)
    label.position.z = ctx.settings.robotHeight + 0.35
    poseGroup.add(label)
  }

  // La estela usa un buffer de tamaño fijo con un `drawRange` móvil: recrear
  // la geometría en cada frame es lo que hace que una estela larga arruine los
  // fps.
  const trail = makeTrailLine(object.options.trailSeconds > 0 ? object.color : null)
  if (trail) group.add(trail.line)

  return {
    group,
    update(next, frame) {
      const pose = next.poses[0]
      group.visible = pose !== undefined && !next.options.hidden
      if (!pose) return
      applyPose(poseGroup, pose)

      if (trail) {
        const store = frame.trails.get(next.id)
        store.push(pose.x, pose.y, pose.z, frame.now)
        updateTrailLine(trail, store.since(next.options.trailSeconds, frame.now))
      }
    },
    dispose() {
      disposeSceneTree(group)
    },
  }
}

// --- Componentes articulados ---------------------------------------------------

/**
 * Las piezas móviles del robot, movidas por un `Pose3d[]` relativo al robot.
 *
 * El índice de cada pose elige el `model_N.glb` del asset: la pose 0 mueve el
 * componente 0, y así. Es la convención de AdvantageScope, y la que ya usan
 * los equipos que publican `AdvantageKit`.
 */
function createComponents(object: RenderedField3dObject, ctx: VisualContext): ObjectVisual {
  const group = new Group()
  group.name = `components:${object.id}`

  const entry = object.options.robotAssetKey
    ? ctx.robotAssets.get(object.options.robotAssetKey)
    : undefined

  interface Slot { pivot: Group; instance: Object3D }
  const slots: Slot[] = []

  if (entry) {
    entry.components.forEach((component, index) => {
      const config = entry.config.components[index]
      const pivot = new Group()
      const slot = makeZeroedSlot(
        config?.zeroedPosition ?? [0, 0, 0],
        composeRotations(config?.zeroedRotations ?? []),
      )
      const instance = instantiateAsset(component)
      slot.add(instance)
      pivot.add(slot)
      pivot.visible = false
      group.add(pivot)
      slots.push({ pivot, instance })
    })
  }

  const opacity = object.options.opacity
  slots.forEach(slot => tint(slot.instance, null, opacity, ctx.quality))

  return {
    group,
    update(next, frame) {
      const anchor = frame.anchorPose(next.options.anchorId) ?? IDENTITY_POSE
      group.visible = !next.options.hidden && slots.length > 0
      if (!group.visible) return

      slots.forEach((slot, index) => {
        const pose = next.poses[index]
        // Un componente sin pose publicada se apaga en vez de quedarse en la
        // última que llegó: en un log recortado eso deja el brazo levantado
        // para siempre y confunde más que no dibujarlo.
        slot.pivot.visible = pose !== undefined
        if (pose) applyPose(slot.pivot, composePose(anchor, pose))
      })
    },
    dispose() {
      disposeSceneTree(group)
    },
  }
}

// --- Trayectoria ---------------------------------------------------------------

const TRAJECTORY_SEGMENTS = 6  // lados del tubo; más no se nota a esta escala

function createTrajectory(object: RenderedField3dObject, ctx: VisualContext): ObjectVisual {
  const group = new Group()
  group.name = `trajectory:${object.id}`

  const material = new MeshPhongMaterial({
    color: object.color, shininess: 10,
    transparent: object.options.opacity < 1, opacity: object.options.opacity,
  })
  const lineMaterial = new LineBasicMaterial({
    color: object.color, transparent: object.options.opacity < 1, opacity: object.options.opacity,
  })
  const pointMaterial = new PointsMaterial({
    color: object.color, size: object.options.trajectoryWidth * 3, sizeAttenuation: true,
  })

  let drawn: Object3D | null = null
  let signature = ""

  const waypoints = new Group()
  group.add(waypoints)
  const waypointGeometry = new SphereGeometry(object.options.trajectoryWidth * 1.6, 10, 8)
  const waypointMaterial = new MeshPhongMaterial({ color: object.color, shininess: 10 })

  const rebuild = (poses: Pose3D[], options: ResolvedField3dOptions) => {
    if (drawn) {
      group.remove(drawn)
      drawn.traverse(node => (node as Mesh).geometry?.dispose())
      drawn = null
    }
    if (poses.length < 2) return

    const points = poses.map(p => new Vector3(p.x, p.y, p.z + options.trajectoryHeight))

    if (options.trajectoryStyle === "points") {
      const geometry = new BufferGeometry().setFromPoints(points)
      drawn = new Points(geometry, pointMaterial)
    } else if (options.trajectoryStyle === "line") {
      const geometry = new BufferGeometry().setFromPoints(points)
      drawn = new Line(geometry, lineMaterial)
    } else {
      // El tubo se muestrea más fino que los waypoints para que las curvas no
      // se vean facetadas, pero con un techo: una trayectoria de mil puntos no
      // necesita cinco mil segmentos.
      const curve = new CatmullRomCurve3(points, false, "catmullrom", 0.1)
      const segments = Math.min(Math.max(points.length * 4, 24), 900)
      drawn = new Mesh(
        new TubeGeometry(curve, segments, options.trajectoryWidth / 2, TRAJECTORY_SEGMENTS, false),
        material,
      )
      drawn.castShadow = ctx.quality === "cinematic"
    }
    group.add(drawn)
  }

  const rebuildWaypoints = (poses: Pose3D[], options: ResolvedField3dOptions) => {
    waypoints.clear()
    if (!options.showWaypoints) return
    poses.forEach(pose => {
      const marker = new Mesh(waypointGeometry, waypointMaterial)
      marker.position.set(pose.x, pose.y, pose.z + options.trajectoryHeight)
      waypoints.add(marker)
    })
  }

  return {
    group,
    update(next) {
      group.visible = !next.options.hidden
      if (!group.visible) return

      // Una trayectoria se publica una vez y no cambia; rehacer el tubo en
      // cada frame sería tirar el presupuesto entero. La firma barata detecta
      // el cambio sin recorrer dos veces el array.
      let checksum = 0
      for (const pose of next.poses) checksum += pose.x + pose.y * 3 + pose.z * 7
      const nextSignature = [
        next.poses.length, checksum.toFixed(4),
        next.options.trajectoryStyle, next.options.trajectoryWidth,
        next.options.trajectoryHeight, next.options.showWaypoints,
      ].join("|")

      if (nextSignature !== signature) {
        signature = nextSignature
        rebuild(next.poses, next.options)
        rebuildWaypoints(next.poses, next.options)
      }
    },
    dispose() {
      waypointGeometry.dispose()
      waypointMaterial.dispose()
      material.dispose()
      lineMaterial.dispose()
      pointMaterial.dispose()
      disposeSceneTree(group)
    },
  }
}

// --- Marcas de visión ----------------------------------------------------------

/** Techo de marcas dibujadas a la vez; por encima el buffer se recorta. */
const MAX_VISION_TARGETS = 64

// Las marcas no proyectan sombra (flotan en el aire y la sombra confundiría
// más de lo que ayuda), así que este tipo no mira la calidad de render.
function createVision(object: RenderedField3dObject): ObjectVisual {
  const group = new Group()
  group.name = `vision:${object.id}`

  // Un par de vértices por marca, con el buffer reservado de entrada: la
  // cantidad de marcas cambia de frame a frame y recrear la geometría cada vez
  // es lo que hace que la visión sea el objeto más caro de la escena.
  const positions = new Float32BufferAttribute(new Float32Array(MAX_VISION_TARGETS * 6), 3)
  positions.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", positions)

  const lines = new LineSegments(geometry, new LineBasicMaterial({
    color: object.color, transparent: true, opacity: Math.min(object.options.opacity, 0.9),
  }))
  group.add(lines)

  const markers = new Group()
  group.add(markers)
  const markerGeometry = new SphereGeometry(object.options.markerSize / 2, 12, 10)
  // Las marcas de visión se emiten un poco: son puntos de interés que tienen
  // que leerse aunque queden en la sombra de una estructura de la cancha.
  const markerMaterial = new MeshPhongMaterial({
    color: object.color, emissive: object.color, emissiveIntensity: 0.35, shininess: 20,
  })
  const pool: Mesh[] = []

  return {
    group,
    update(next, frame) {
      group.visible = !next.options.hidden
      if (!group.visible) return

      const from = frame.anchorCamera(next.options.anchorId, next.options.visionCameraIndex)
        ?? frame.anchorPose(next.options.anchorId)
      const targets = next.poses.slice(0, MAX_VISION_TARGETS)

      // Se crean marcadores a demanda y no se destruyen: la cuenta de marcas
      // oscila mucho (una cámara ve tres tags y al frame siguiente uno), y
      // crear y tirar mallas a ese ritmo se nota.
      while (pool.length < targets.length) {
        const marker = new Mesh(markerGeometry, markerMaterial)
        markers.add(marker)
        pool.push(marker)
      }
      pool.forEach((marker, index) => {
        const target = targets[index]
        marker.visible = target !== undefined
        if (target) marker.position.set(target.x, target.y, target.z)
      })

      const array = positions.array as Float32Array
      let written = 0
      if (from) {
        targets.forEach(target => {
          const base = written * 6
          array[base] = from.x
          array[base + 1] = from.y
          array[base + 2] = from.z
          array[base + 3] = target.x
          array[base + 4] = target.y
          array[base + 5] = target.z
          written++
        })
      }
      geometry.setDrawRange(0, written * 2)
      positions.needsUpdate = true
      lines.visible = written > 0
    },
    dispose() {
      markerGeometry.dispose()
      markerMaterial.dispose()
      disposeSceneTree(group)
    },
  }
}

// --- Piezas de juego ------------------------------------------------------------

/** Techo de piezas dibujadas a la vez. */
const MAX_GAME_PIECES = 128

function createGamePiece(object: RenderedField3dObject, ctx: VisualContext): ObjectVisual {
  const group = new Group()
  group.name = `gamePiece:${object.id}`

  const entry = ctx.gamePieces[object.options.gamePieceIndex]
  const pool: Object3D[] = []

  // El config de la cancha dice cómo está exportada la pieza; ese giro y ese
  // desplazamiento son parte del modelo, no de la pose publicada.
  const zeroedRotation = composeRotations(entry?.config.rotations ?? [])
  const zeroedPosition = entry?.config.position ?? [0, 0, 0]

  // Sin modelo (cancha esquemática, o una pieza que el asset no trae) se cae a
  // una esfera del color del objeto: es mejor ver DÓNDE está la pieza con la
  // forma equivocada que no verla.
  const fallbackGeometry = new SphereGeometry(object.options.markerSize / 2, 14, 12)
  const fallbackMaterial = new MeshPhongMaterial({
    color: object.color, shininess: 10,
    transparent: object.options.opacity < 1, opacity: object.options.opacity,
  })

  const spawn = (): Object3D => {
    const pivot = new Group()
    if (entry?.asset) {
      const slot = makeZeroedSlot(zeroedPosition, zeroedRotation)
      const instance = instantiateAsset(entry.asset)
      tint(instance, null, object.options.opacity, ctx.quality)
      slot.add(instance)
      pivot.add(slot)
    } else {
      const mesh = new Mesh(fallbackGeometry, fallbackMaterial)
      mesh.castShadow = ctx.quality === "cinematic"
      pivot.add(mesh)
    }
    group.add(pivot)
    return pivot
  }

  return {
    group,
    update(next) {
      group.visible = !next.options.hidden
      if (!group.visible) return

      const poses = next.poses.slice(0, MAX_GAME_PIECES)
      while (pool.length < poses.length) pool.push(spawn())
      pool.forEach((pivot, index) => {
        const pose = poses[index]
        pivot.visible = pose !== undefined
        if (pose) applyPose(pivot, pose)
      })
    },
    dispose() {
      fallbackGeometry.dispose()
      fallbackMaterial.dispose()
      disposeSceneTree(group)
    },
  }
}

// --- Marcadores simples ----------------------------------------------------------

const MAX_MARKERS = 128

function createMarker(object: RenderedField3dObject, ctx: VisualContext): ObjectVisual {
  const group = new Group()
  group.name = `${object.type}:${object.id}`

  const size = object.options.markerSize
  const isAxes = object.type === "axes"

  const geometry = isAxes ? null : new ConeGeometry(size / 2, size * 1.6, 16)
  const material = isAxes ? null : new MeshPhongMaterial({
    color: object.color, shininess: 10,
    transparent: object.options.opacity < 1, opacity: object.options.opacity,
  })

  const pool: Object3D[] = []

  const spawn = (): Object3D => {
    const pivot = new Group()
    if (isAxes) {
      pivot.add(makeAxes(size * 2))
    } else {
      // El cono se dibuja apuntando hacia ARRIBA y elevado media altura: así
      // la punta marca el punto y el cuerpo no queda enterrado en la alfombra.
      const mesh = new Mesh(geometry!, material!)
      mesh.rotation.x = Math.PI / 2
      mesh.position.z = size * 0.8
      mesh.castShadow = ctx.quality === "cinematic"
      pivot.add(mesh)
    }
    group.add(pivot)
    return pivot
  }

  return {
    group,
    update(next) {
      group.visible = !next.options.hidden
      if (!group.visible) return

      const poses = next.poses.slice(0, MAX_MARKERS)
      while (pool.length < poses.length) pool.push(spawn())
      pool.forEach((pivot, index) => {
        const pose = poses[index]
        pivot.visible = pose !== undefined
        if (pose) applyPose(pivot, pose)
      })
    },
    dispose() {
      geometry?.dispose()
      material?.dispose()
      disposeSceneTree(group)
    },
  }
}

// --- Estelas ---------------------------------------------------------------------

/** Techo de puntos de una estela; por encima se muestran los más recientes. */
const MAX_TRAIL_POINTS = 4000

interface TrailLine {
  line: Line
  positions: Float32BufferAttribute
  geometry: BufferGeometry
}

function makeTrailLine(color: string | null): TrailLine | null {
  if (color === null) return null

  const positions = new Float32BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3)
  positions.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", positions)
  geometry.setDrawRange(0, 0)

  const line = new Line(geometry, new LineBasicMaterial({
    color, transparent: true, opacity: 0.75, depthWrite: false,
  }))
  line.renderOrder = 3
  return { line, positions, geometry }
}

function updateTrailLine(trail: TrailLine, samples: { x: number; y: number; z: number }[]) {
  const array = trail.positions.array as Float32Array
  const start = Math.max(0, samples.length - MAX_TRAIL_POINTS)
  const count = samples.length - start

  for (let i = 0; i < count; i++) {
    const sample = samples[start + i]
    array[i * 3] = sample.x
    array[i * 3 + 1] = sample.y
    // Un pelo sobre la alfombra: a la misma altura la línea desaparece a
    // trozos por el z-fighting contra el piso.
    array[i * 3 + 2] = sample.z + 0.02
  }

  trail.geometry.setDrawRange(0, count)
  trail.positions.needsUpdate = true
  trail.line.visible = count > 1
}

// --- Fábrica ----------------------------------------------------------------------

export function createObjectVisual(
  object: RenderedField3dObject,
  ctx: VisualContext,
): ObjectVisual {
  switch (object.type) {
    case "robot":
    case "ghost":
      return createRobot(object, ctx)
    case "component":
      return createComponents(object, ctx)
    case "trajectory":
      return createTrajectory(object, ctx)
    case "vision":
      return createVision(object)
    case "gamePiece":
      return createGamePiece(object, ctx)
    case "cone":
    case "axes":
      return createMarker(object, ctx)
  }
}

/**
 * Firma con todo lo que obliga a RECONSTRUIR el objeto (y no solo a moverlo).
 *
 * Cambiar el color o el tipo cambia mallas y materiales; cambiar la pose no.
 * Separar las dos cosas es lo que permite que la escena solo toque matrices en
 * el 99 % de los frames.
 */
export function visualSignature(object: RenderedField3dObject): string {
  const o = object.options
  return [
    object.id, object.type, object.color, object.label,
    o.opacity, o.showLabel, o.robotAssetKey ?? "", o.useModel,
    o.trajectoryStyle, o.trajectoryWidth, o.markerSize, o.gamePieceIndex,
    o.trailSeconds > 0,
  ].join("|")
}
