// La escena del Field 3D: la cancha, la cámara y todo lo que se dibuja encima.
//
// El mundo es Z ARRIBA, X hacia la alianza roja e Y hacia la izquierda vista
// desde el azul, con el origen en el CENTRO del área de juego. Es el marco del
// modelo de la cancha y el mismo que usa AdvantageScope, así que las
// posiciones de los AprilTags y de las driver stations que trae el config.json
// de cada asset entran tal cual, sin recalcular nada.
//
// La conversión desde el marco en que publica el robot ya la hizo la página
// (`utils/field3d/frames.ts`): acá todas las poses llegan listas para dibujar.
//
// El bucle de dibujo lee de REFS y no de props: los datos llegan a ~30 Hz pero
// la escena se redibuja a 60 (la cámara se mueve sola, con amortiguación), y
// recrear el loop en cada muestra tiraría a la basura ese trabajo.

import { useEffect, useRef } from "react"
import {
  BoxGeometry, Color, Group, HemisphereLight, Matrix4, Mesh, MeshBasicMaterial,
  MeshPhongMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PointLight,
  Quaternion, SRGBColorSpace, Scene, SpotLight, Vector3, WebGLRenderer,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Field3dSettings } from "../../../store/appStore"
import { FieldSize, Pose3D, composePose } from "../../../utils/field3d/frames"
import { FieldAssetConfig, composeRotations } from "../../../utils/field3d/assetConfig"
import { LoadedAsset, disposeSceneTree, instantiateAsset } from "../../../utils/field3d/assetModels"
import {
  DEFAULT_FIELD_SIZE, evergreenDriverStations, makeEvergreenField, makeFieldGrid,
} from "../../../utils/field3d/evergreen"
import { TrailStore } from "../../../utils/field3d/trails"
import { makeAxes, makeTextSprite } from "../three/sceneKit"
import {
  FrameContext, GamePieceEntry, ObjectVisual, RenderedField3dObject, RobotAssetEntry,
  VisualContext, applyPose, createObjectVisual, visualSignature,
} from "./objectVisuals"

interface Props {
  objects: RenderedField3dObject[]
  settings: Field3dSettings
  size: FieldSize
  /** Config de la cancha activa; null = la esquemática. */
  fieldConfig: FieldAssetConfig | null
  fieldAsset: LoadedAsset | null
  robotAssets: Map<string, RobotAssetEntry>
  gamePieces: GamePieceEntry[]
  /** Piezas con topic activo: sus copias "de fábrica" del modelo se ocultan. */
  activeGamePieces: Set<number>
  trails: TrailStore
  /** Cambia de valor cuando la página pide volver a la vista por defecto. */
  resetCameraToken: number
}

/**
 * Lleva de la convención de cámara de WPILib (+X hacia adelante, +Z arriba) a
 * la de three (-Z hacia adelante, +Y arriba).
 *
 * Sin esto, una cámara declarada en el asset del robot apuntaría al piso y
 * girada 90°, que es el error clásico al portar poses de visión.
 */
const CAMERA_FIX = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(
    new Vector3(0, -1, 0),   // +X de la cámara (derecha) = -Y del robot
    new Vector3(0, 0, 1),    // +Y de la cámara (arriba)  = +Z del robot
    new Vector3(-1, 0, 0),   // +Z de la cámara (atrás)   = -X del robot
  ),
)

/** Metros por pulgada, para leer el tamaño del tag de su variante. */
const INCH = 0.0254

interface SceneCore {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  controls: OrbitControls
  /** Cancha + decoraciones; se reconstruye al cambiar de asset. */
  fieldGroup: Group
  /** Objetos de la lista. */
  objectGroup: Group
  visuals: Map<string, ObjectVisual>
  /** Nodos del modelo que representan piezas ya colocadas, por índice de pieza. */
  staged: Map<number, { visible: boolean; nodes: Object3D[] }>
  lastFrame: number
}

export default function Field3dScene(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<SceneCore | null>(null)

  const propsRef = useRef(props)
  propsRef.current = props

  // --- Montaje: renderer, cámara, luces, loop --------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
    renderer.domElement.style.display = "block"
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    container.appendChild(renderer.domElement)

    // Sin esto los colores del modelo salen apagados: three interpreta el
    // color del material en espacio lineal y hay que convertirlo a sRGB al
    // escribir el framebuffer.
    renderer.outputColorSpace = SRGBColorSpace
    renderer.shadowMap.type = PCFSoftShadowMap

    const scene = new Scene()
    scene.background = new Color(0x222222)

    const camera = new PerspectiveCamera(50, 1, 0.05, 300)
    // Z arriba: sin esto la órbita giraría alrededor del eje equivocado y la
    // cancha se vería de canto.
    camera.up.set(0, 0, 1)
    camera.position.set(-10, -10, 7)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.minDistance = 1
    controls.maxDistance = 60
    // Un poco antes del horizonte: mirar exactamente de canto deja la cancha
    // reducida a una línea.
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.target.set(0, 0, 0)
    controls.update()

    const fieldGroup = new Group()
    fieldGroup.name = "field"
    const objectGroup = new Group()
    objectGroup.name = "objects"
    scene.add(fieldGroup, objectGroup)

    const core: SceneCore = {
      renderer, scene, camera, controls, fieldGroup, objectGroup,
      visuals: new Map(), staged: new Map(),
      lastFrame: 0,
    }
    coreRef.current = core

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    let frame = 0
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate)

      // En modo de bajo consumo se dibuja a 30 fps: en una notebook del pit
      // sin enchufe, la mitad de los frames es la diferencia entre que la app
      // responda y que no.
      const budget = propsRef.current.settings.quality === "lowPower" ? 33 : 0
      if (budget > 0 && time - core.lastFrame < budget) return
      core.lastFrame = time

      // `updateFrame` termina llamando a `controls.update()` cuando la cámara
      // es orbital. En las vistas fijas NO se llama a propósito: OrbitControls
      // recalcula la posición desde su estado interno en cada update, incluso
      // con `enabled` en false, y le pisaría a la escena la cámara que acaba
      // de colocar.
      updateFrame(core, propsRef.current)
      core.renderer.render(core.scene, core.camera)
    }
    frame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      core.controls.dispose()
      core.visuals.forEach(visual => visual.dispose())
      core.visuals.clear()
      clearFieldGroup(core)
      core.renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      coreRef.current = null
    }
  }, [])

  // --- Calidad de render ------------------------------------------------------
  // Cambia luces, sombras y resolución. Va aparte del montaje porque se toca
  // en caliente desde el panel y recrear el renderer perdería la cámara.
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    applyQuality(core, props.settings.quality)
  }, [props.settings.quality])

  // --- Cancha -----------------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    buildField(core, props)
    return () => { if (coreRef.current) clearFieldGroup(coreRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.fieldAsset, props.fieldConfig, props.size.length, props.size.width,
    props.settings.showGrid, props.settings.gridCell, props.settings.showFieldAxes,
    props.settings.showAprilTags, props.settings.showAprilTagIds,
    props.settings.showDriverStations, props.settings.quality,
  ])

  // --- Objetos ----------------------------------------------------------------
  // Se reconstruyen solo cuando cambia algo que altera mallas o materiales; las
  // poses se aplican en el loop, que únicamente toca matrices.
  const signature = props.objects.map(visualSignature).join("~")

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    syncVisuals(core, propsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, props.robotAssets, props.gamePieces, props.settings.quality,
      props.settings.robotLength, props.settings.robotWidth, props.settings.robotHeight])

  // --- Vista por defecto -------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    resetCamera(core, propsRef.current.size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetCameraToken, props.size.length])

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", touchAction: "none" }}
    />
  )
}

// --- Calidad -------------------------------------------------------------------

function applyQuality(core: SceneCore, quality: Field3dSettings["quality"]) {
  const { renderer, scene } = core
  const cinematic = quality === "cinematic"

  // En bajo consumo se dibuja por DEBAJO de la resolución de pantalla. Es lo
  // que de verdad se nota: el resto del ahorro (menos detalle geométrico, sin
  // sombras) ya lo aplicó el optimizador al cargar el modelo.
  renderer.setPixelRatio(quality === "lowPower" ? 0.75 : Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = cinematic

  // Las luces se rehacen enteras: son unos pocos objetos y mantener
  // sincronizadas sus intensidades con un `if` por luz es más frágil.
  scene.children
    .filter(child => child.userData.isLight === true)
    .forEach(child => {
      scene.remove(child)
      ;(child as any).dispose?.()
    })

  const add = (light: any) => {
    light.userData.isLight = true
    scene.add(light)
  }

  // El hemisférico hace casi todo el trabajo fuera de cinematográfico: con
  // intensidad 2 la cancha se lee plana y clara, que es exactamente lo que uno
  // quiere para mirar datos. Bajarlo y compensar con direccionales produce esas
  // escenas oscuras con medio modelo en sombra que no dejan ver nada.
  // En cinematográfico el rebote ambiental va apenas cálido y con el suelo
  // más oscuro: es lo que hace que el modo se lea como un venue iluminado y
  // no como el modo normal con el brillo bajado.
  add(cinematic
    ? new HemisphereLight(0xfff4e8, 0x2b2b33, 0.5)
    : new HemisphereLight(0xffffff, 0x444444, 2))

  if (!cinematic) {
    // Un solo punto de luz alto para dar algo de relieve al plano.
    const point = new PointLight(0xffffff, 0.5)
    point.position.set(0, 0, 10)
    add(point)
    return
  }

  // En cinematográfico se imitan las luminarias de un venue: cuatro focos
  // desde arriba, que son los que proyectan las sombras. La luz es blanca
  // cálida y NO va teñida de azul y rojo por los extremos: ese tinte es la
  // firma visual de AdvantageScope y, peor, falsea el color de los materiales
  // del robot, que es exactamente lo que uno viene a mirar a esta pestaña.
  // El volumen sale de dónde pega cada foco y con cuánta fuerza, no del color.
  const SPOTS: [number, number, number, number][] = [
    // x, y, z, intensidad. Asimétricas a propósito: el foco de un lado hace de
    // key y el opuesto de fill, que es lo que separa las caras del robot.
    // Cuatro focos idénticos aplanan el modelo tanto como una sola ambiental.
    [3, 7, 10, 200], [-3, -7, 10, 95], [8, -2, 10, 140], [-8, 2, 10, 120],
  ]
  SPOTS.forEach(([x, y, z, intensity]) => {
    const spot = new SpotLight(0xfff3e2, intensity, 0, 50 * (Math.PI / 180), 0.25, 2)
    spot.position.set(x, y, z)
    spot.target.position.set(0, 0, 0)
    spot.castShadow = true
    spot.shadow.mapSize.set(2048, 2048)
    // Sin esto la alfombra se llena del moteado clásico de auto-sombreado.
    spot.shadow.bias = -0.0001
    add(spot)
    add(spot.target)
  })

  // Dos rasantes bajos en los extremos, en blanco frío muy suave. Cumplen el
  // papel que antes hacían las luces de alianza — despegar del fondo negro las
  // paredes del fondo y el contorno del robot cuando la cámara gira — pero sin
  // pintar nada: el contraste lo dan el ángulo y la caída, no el matiz.
  ;[-4.6, 4.6].forEach(x => {
    const rim = new PointLight(0xe6edf7, 22, 13, 2)
    rim.position.set(x, 0, 2.6)
    add(rim)
  })
}

// --- Cancha ---------------------------------------------------------------------

function clearFieldGroup(core: SceneCore) {
  core.fieldGroup.children.slice().forEach(child => {
    core.fieldGroup.remove(child)
    // `disposeSceneTree` respeta lo prestado: la geometría de una instancia de
    // asset la comparten todas las copias y la caché del loader, y soltarla
    // dejaría la cancha en negro la próxima vez que se abra la pestaña.
    disposeSceneTree(child)
  })
  core.staged.clear()
}

function buildField(core: SceneCore, props: Props) {
  clearFieldGroup(core)
  const { fieldAsset, fieldConfig, settings, size } = props

  if (fieldAsset && fieldConfig) {
    // El modelo se carga crudo; los giros que lo llevan al marco Z-arriba los
    // declara su config (normalmente un +90° en X, que es lo que separa la
    // convención Y-arriba de glTF de la Z-arriba de WPILib).
    const rotation = composeRotations(fieldConfig.rotations)
    const holder = new Group()
    holder.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0])
    holder.add(instantiateAsset(fieldAsset))
    // Las banderas de sombra ya las puso el optimizador al cargar el modelo,
    // que es quien sabe qué malla es la alfombra y cuál un vidrio.
    core.fieldGroup.add(holder)

    // Las piezas que el modelo trae ya colocadas se indexan por pieza para
    // poder apagarlas cuando el robot publique su topic.
    // Los nodos se buscan sobre la COPIA recién colgada y no sobre el original
    // cacheado: apagar el original afectaría a cualquier otra pestaña Field 3D
    // abierta sobre la misma cancha.
    fieldConfig.gamePieces.forEach((piece, index) => {
      const wanted = new Set(piece.stagedObjects)
      const nodes: Object3D[] = []
      holder.traverse(child => { if (wanted.has(child.name)) nodes.push(child) })
      core.staged.set(index, { visible: true, nodes })
    })
  } else {
    core.fieldGroup.add(makeEvergreenField(size))
  }

  if (settings.showGrid) core.fieldGroup.add(makeFieldGrid(size, settings.gridCell))

  if (settings.showFieldAxes) {
    // El triedro va en el origen de coordenadas del ROBOT (la esquina azul en
    // el sistema clásico), no en el centro: es donde uno espera ver el (0,0)
    // al comparar con los números que imprime el código.
    const axes = makeAxes(1.2)
    axes.position.set(-size.length / 2, -size.width / 2, 0.01)
    core.fieldGroup.add(axes)
  }

  if (settings.showAprilTags && fieldConfig) {
    core.fieldGroup.add(makeAprilTags(fieldConfig, settings.showAprilTagIds))
  }

  if (settings.showDriverStations) {
    const stations = fieldConfig?.driverStations.length
      ? fieldConfig.driverStations
      : evergreenDriverStations(size)
    core.fieldGroup.add(makeDriverStationMarkers(stations))
  }
}

/** Tamaño físico del tag, leído de su variante ("36h11-6.5in" -> 0.165 m). */
function tagSize(variant: string): number {
  const match = /(\d+(?:\.\d+)?)in/.exec(variant)
  return match ? Number(match[1]) * INCH : 6.5 * INCH
}

function makeAprilTags(config: FieldAssetConfig, withIds: boolean): Group {
  const group = new Group()
  group.name = "apriltags"

  // Un material compartido por todos los tags: son 32 en la cancha 2026 y cada
  // uno con material propio serían 32 programas de shader por nada.
  const faceMaterial = new MeshBasicMaterial({ color: 0x101014 })
  const borderMaterial = new MeshBasicMaterial({ color: 0xf5f5f8 })

  // Una cancha usa un solo tamaño de tag, así que la geometría se comparte por
  // lado en vez de crear 64 cajas idénticas.
  const geometries = new Map<number, { face: BoxGeometry; border: BoxGeometry }>()
  const geometryFor = (side: number) => {
    let hit = geometries.get(side)
    if (!hit) {
      // El tag mira hacia +X en el marco de WPILib, así que la placa es
      // delgada en X y cuadrada en Y/Z.
      hit = {
        face: new BoxGeometry(0.008, side, side),
        border: new BoxGeometry(0.006, side * 1.25, side * 1.25),
      }
      geometries.set(side, hit)
    }
    return hit
  }

  config.aprilTags.forEach(tag => {
    const side = tagSize(tag.variant)
    const pivot = new Group()
    pivot.position.set(tag.position[0], tag.position[1], tag.position[2])
    const rotation = composeRotations(tag.rotations)
    pivot.quaternion.set(rotation[1], rotation[2], rotation[3], rotation[0])

    const shared = geometryFor(side)
    pivot.add(new Mesh(shared.border, borderMaterial), new Mesh(shared.face, faceMaterial))

    if (withIds) {
      const label = makeTextSprite(String(tag.id), { height: side * 0.7 })
      label.position.set(0.02, 0, 0)
      pivot.add(label)
    }

    group.add(pivot)
  })

  return group
}

function makeDriverStationMarkers(stations: [number, number][]): Group {
  const group = new Group()
  group.name = "driver-stations"

  stations.forEach((station, index) => {
    // Las tres primeras son azules y las tres siguientes rojas, que es el
    // orden en que las lista el config de AdvantageScope.
    const color = index < stations.length / 2 ? 0x2f6fdb : 0xd63b3b
    const marker = new Mesh(
      new BoxGeometry(0.35, 0.9, 0.05),
      new MeshPhongMaterial({ color, shininess: 0, transparent: true, opacity: 0.8 }),
    )
    marker.position.set(station[0], station[1], 0.03)
    group.add(marker)

    const label = makeTextSprite(`DS${index + 1}`, { height: 0.28 })
    label.position.set(station[0], station[1], 0.5)
    group.add(label)
  })

  return group
}

// --- Objetos ---------------------------------------------------------------------

function syncVisuals(core: SceneCore, props: Props) {
  const ctx: VisualContext = {
    settings: props.settings,
    quality: props.settings.quality,
    robotAssets: props.robotAssets,
    gamePieces: props.gamePieces,
  }

  const alive = new Set(props.objects.map(o => o.id))
  core.visuals.forEach((visual, id) => {
    if (alive.has(id)) return
    core.objectGroup.remove(visual.group)
    visual.dispose()
    core.visuals.delete(id)
  })

  // Todo se reconstruye de una: la firma que dispara este efecto ya juntó los
  // cambios de TODOS los objetos, y distinguir cuál cambió pediría guardarse
  // la firma de cada uno para ganar unos milisegundos que nadie ve.
  props.objects.forEach(object => {
    const existing = core.visuals.get(object.id)
    if (existing) {
      core.objectGroup.remove(existing.group)
      existing.dispose()
    }
    const visual = createObjectVisual(object, ctx)
    core.objectGroup.add(visual.group)
    core.visuals.set(object.id, visual)
  })

  props.trails.prune(alive)
}

// --- Frame -----------------------------------------------------------------------

function updateFrame(core: SceneCore, props: Props) {
  const now = Date.now()

  // Las poses de los objetos `robot` se resuelven primero: los componentes y
  // las marcas de visión cuelgan de ellas, y en el mismo frame tienen que ver
  // la pose de ESTE frame, no la del anterior.
  const robotPoses = new Map<string, Pose3D>()
  props.objects.forEach(object => {
    if (object.type !== "robot" && object.type !== "ghost") return
    const pose = object.poses[0]
    if (pose) robotPoses.set(object.id, pose)
  })

  // El "robot principal" es el primero de tipo `robot` que tenga pose. Es a lo
  // que apuntan la cámara que sigue al robot y los objetos sin ancla explícita.
  const primaryId = props.objects.find(o => o.type === "robot" && robotPoses.has(o.id))?.id ?? null
  const primaryPose = primaryId === null ? null : robotPoses.get(primaryId) ?? null

  const anchorPose = (anchorId: string | null): Pose3D | null => {
    if (anchorId !== null) return robotPoses.get(anchorId) ?? null
    // Sin ancla explícita se usa el primer robot de la lista: es lo que quiere
    // decir alguien que suelta un topic de componentes y no toca nada más.
    return primaryPose
  }

  // Qué asset usa un objeto anclado: el suyo si lo fijó, si no el default de
  // la pestaña. La cámara del robot y su campo de visión tienen que resolverlo
  // igual, o el encuadre saldría de un asset y la lente de otro.
  const assetKeyOf = (anchorId: string | null): string | null => {
    const object = props.objects.find(o => o.id === (anchorId ?? primaryId))
    return object?.options.robotAssetKey ?? props.settings.robotAssetKey
  }

  const anchorCamera = (anchorId: string | null, cameraIndex: number): Pose3D | null => {
    const pose = anchorPose(anchorId)
    if (pose === null || cameraIndex < 0) return pose
    const key = assetKeyOf(anchorId)
    const camera = key ? props.robotAssets.get(key)?.config.cameras[cameraIndex] : undefined
    if (!camera) return pose
    const rotation = composeRotations(camera.rotations)
    return composePose(pose, {
      x: camera.position[0], y: camera.position[1], z: camera.position[2],
      qw: rotation[0], qx: rotation[1], qy: rotation[2], qz: rotation[3],
    })
  }

  const frame: FrameContext = { now, trails: props.trails, anchorPose, anchorCamera }

  props.objects.forEach(object => {
    core.visuals.get(object.id)?.update(object, frame)
  })

  // Las piezas que el modelo trae colocadas se apagan en cuanto el robot
  // publica ese tipo de pieza: si no, cada una se vería dos veces, la de
  // verdad y la que viene pintada en la cancha.
  core.staged.forEach((entry, index) => {
    const visible = props.settings.showStagedPieces && !props.activeGamePieces.has(index)
    if (entry.visible === visible) return
    entry.visible = visible
    entry.nodes.forEach(node => { node.visible = visible })
  })

  updateCamera(core, props, primaryPose, anchorCamera, assetKeyOf(null))
}

// --- Cámara -----------------------------------------------------------------------

function resetCamera(core: SceneCore, size: FieldSize) {
  // Tres cuartos desde la esquina azul: es el encuadre en que se ve la cancha
  // entera y todavía se entiende la profundidad.
  const reach = Math.max(size.length, DEFAULT_FIELD_SIZE.length)
  core.camera.position.set(-reach * 0.62, -reach * 0.5, reach * 0.42)
  core.controls.target.set(0, 0, 0)
  core.controls.update()
}

function updateCamera(
  core: SceneCore,
  props: Props,
  robotPose: Pose3D | null,
  anchorCamera: (anchorId: string | null, cameraIndex: number) => Pose3D | null,
  /** Asset del robot principal, del que sale la lente en la vista de cámara. */
  robotAssetKey: string | null,
) {
  const { settings, size } = props
  const camera = core.camera

  const fov = settings.cameraMode === "robotCamera"
    ? robotCameraFov(props, robotAssetKey)
    : settings.fov
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }

  switch (settings.cameraMode) {
    case "orbit":
      core.controls.enabled = true
      core.controls.update()
      return

    case "orbitRobot": {
      // La órbita sigue al robot pero NO gira con él: la cámara se queda donde
      // el usuario la dejó y el robot se mueve por debajo. Girar con el heading
      // marea y hace imposible leer hacia dónde va.
      core.controls.enabled = true
      if (robotPose) {
        const dx = robotPose.x - core.controls.target.x
        const dy = robotPose.y - core.controls.target.y
        const dz = robotPose.z - core.controls.target.z
        core.controls.target.set(robotPose.x, robotPose.y, robotPose.z)
        camera.position.x += dx
        camera.position.y += dy
        camera.position.z += dz
      }
      core.controls.update()
      return
    }

    case "driverStation": {
      core.controls.enabled = false
      const stations = props.fieldConfig?.driverStations.length
        ? props.fieldConfig.driverStations
        : evergreenDriverStations(size)
      const station = stations[Math.min(settings.driverStationIndex, stations.length - 1)]
      if (!station) return
      // Un metro por detrás de la pared y a la altura de los ojos: es lo que
      // ve el piloto, que es el punto de esta vista.
      const outward = Math.sign(station[0]) || 1
      camera.position.set(station[0] + outward * 1.1, station[1], 1.6)
      camera.lookAt(0, 0, 0.6)
      return
    }

    case "robotCamera": {
      core.controls.enabled = false
      const pose = anchorCamera(null, settings.robotCameraIndex)
      if (!pose) return
      applyPose(camera, pose)
      // La cámara de three mira hacia -Z; la del robot, hacia +X.
      camera.quaternion.multiply(CAMERA_FIX)
      return
    }
  }
}

/**
 * FOV VERTICAL de la cámara elegida del robot.
 *
 * El config declara el HORIZONTAL, que es como lo publican los fabricantes de
 * cámaras; three quiere el vertical, y la conversión depende del aspecto real
 * del sensor, no del de la ventana.
 */
function robotCameraFov(props: Props, robotAssetKey: string | null): number {
  const camera = robotAssetKey
    ? props.robotAssets.get(robotAssetKey)?.config.cameras[props.settings.robotCameraIndex]
    : undefined
  if (!camera) return props.settings.fov

  const aspect = camera.resolution[0] / Math.max(camera.resolution[1], 1)
  const horizontal = (camera.fov * Math.PI) / 180
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / Math.max(aspect, 1e-3))
  return Math.min(Math.max((vertical * 180) / Math.PI, 5), 160)
}
