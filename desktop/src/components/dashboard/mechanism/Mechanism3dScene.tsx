// Escena del Mechanism 3D.
//
// El mecanismo es un árbol. Cada pieza arma esta cadena de grupos:
//
//   originGroup   colocación FIJA respecto del padre (origin + originRotation)
//     └ pivotOut  +pivot   ─┐ juntos hacen que el giro ocurra alrededor del
//         └ jointGroup      │  pivote y no del origen: en reposo se cancelan,
//             └ pivotIn  -pivot  así que mover el pivote NO mueve la pieza.
//                 ├ modelSlot   el STL/GLB o la primitiva
//                 └ originGroup de cada hijo…
//
// Los indicadores de junta (el anillo del revoluto, el riel del prismático)
// cuelgan de originGroup, no del joint: marcan por dónde pasa el eje, así que
// tienen que quedarse quietos mientras la pieza se mueve.
//
// La reconstrucción del árbol solo ocurre cuando cambia la estructura o la
// apariencia; los valores se aplican en el frame loop tocando únicamente
// transformaciones, que es barato.

import { useEffect, useRef } from "react"
import {
  BoxGeometry, BoxHelper, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  OrthographicCamera, PerspectiveCamera, Quaternion, Raycaster, Scene, SphereGeometry,
  Sprite, TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import { Mechanism3dPart, Mechanism3dRoutine, Mechanism3dSettings } from "../../../store/appStore"
import {
  LoadedModel, instantiateModel, materialsOf, disposeInstance,
} from "../../../utils/field/robotModel"
import {
  buildPartTree, evaluateRoutine, jointTransform, jointTransformFromValue, jointValue,
  normalizeAxis, PartNode, routineDuration, sweepRange, travelRange, unitScale,
} from "../../../utils/mechanism/mechanism3d"
import {
  DEG, addStandardLights, disposeGroup, makeAxes, makeFloorGrid, makeOrbitControls,
  makeTextSprite,
} from "../three/sceneKit"

interface Props {
  parts: Mechanism3dPart[]
  settings: Mechanism3dSettings
  /** Modelos ya cargados, indexados por ruta. */
  models: Map<string, LoadedModel>
  /** Último valor de cada topic que maneja alguna articulación. */
  values: Record<string, any>
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Se llama al SOLTAR el gizmo, con los campos que cambió. */
  onCommit: (id: string, updates: Partial<Mechanism3dPart>) => void
  resetCameraToken: number

  // --- Reproducción de rutinas ---
  /** Rutina elegida, o null si no hay ninguna. */
  routine: Mechanism3dRoutine | null
  /** La rutina manda sobre los topics y sobre el valor manual. */
  routineActive: boolean
  /** Avanza el reloj. En pausa se queda mostrando la pose actual. */
  routinePlaying: boolean
  routineSpeed: number
  /** Cambia de valor para mandar el reloj de vuelta a cero. */
  routineSeekToken: number
  /**
   * Progreso, ~10 veces por segundo. Va como callback y no como estado de
   * React a propósito: el reloj corre a 60 fps y re-renderizar la página a ese
   * ritmo volvería a montar los paneles enteros en cada cuadro.
   */
  onRoutineTick?: (timeMs: number, fraction: number) => void
}

const FLOOR_HALF = 6
const SELECTION_COLOR = 0x4a5fd9
const PRIMITIVE_COLOR = 0x9aa0ad
const PIVOT_COLOR = 0xd97706

// Morado = gira, turquesa = desliza. Mismo código en el badge del árbol.
const REVOLUTE_COLOR = 0x7c3aed
const PRISMATIC_COLOR = 0x0e9aa7

const SWEEP_SEGMENTS = 60
const JOINT_RADIUS = 0.09      // m, antes de multiplicar por settings.jointScale

const THEME = {
  light: { clear: 0xe6e6ea, grid: 0x9a9aa2, label: "#1c1c1f", labelBg: "rgba(255,255,255,0.85)" },
  dark: { clear: 0x1b1b20, grid: 0x50505a, label: "#f2f2f5", labelBg: "rgba(20,20,24,0.8)" },
}

/** Lo que el frame loop necesita mover en el indicador de una junta. */
interface JointVisual {
  kind: "revolute" | "prismatic"
  /** Segmentos del arco de barrido, se muestran los primeros n. */
  sweep: Group | null
  segments: Mesh[]
  /** Punta que corre por el anillo o por el riel. */
  head: Object3D | null
  /** Extremos del riel, en metros, para no dibujar fuera de él. */
  travel: { min: number; max: number }
}

interface PartVisual {
  id: string
  originGroup: Group
  jointGroup: Group
  pivotMarker: Object3D | null
  joint: JointVisual | null
}

interface SceneCore {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera
  controls: OrbitControls
  /** Raíz del mecanismo; se vacía y rearma en cada reconstrucción. */
  root: Group
  floor: Group
  transform: TransformControls | null
  selectionBox: BoxHelper | null
  visuals: Map<string, PartVisual>
  raycaster: Raycaster
  pointer: Vector2
  /** Reloj de la rutina, en ms. */
  routineClock: number
  lastFrame: number
  lastTick: number
}

export default function Mechanism3dScene({
  parts, settings, models, values, selectedId, onSelect, onCommit, resetCameraToken,
  routine, routineActive, routinePlaying, routineSpeed, routineSeekToken, onRoutineTick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const coreRef = useRef<SceneCore | null>(null)

  // El loop corre a 60 fps y los datos llegan a ~30 Hz: lee de refs para no
  // tener que recrearse en cada muestra.
  const liveRef = useRef({ parts, settings, values, routine, routineActive, routinePlaying, routineSpeed })
  liveRef.current = { parts, settings, values, routine, routineActive, routinePlaying, routineSpeed }
  const tickRef = useRef(onRoutineTick)
  tickRef.current = onRoutineTick
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  // --- Montaje ---------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.display = "block"
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    container.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 1, 0.02, 200)
    camera.up.set(0, 0, 1)
    camera.position.set(-1.2, -1.2, 0.9)

    const controls = makeOrbitControls(camera, renderer.domElement, { minDistance: 0.1, maxDistance: 30 })
    controls.target.set(0, 0, 0.3)
    controls.update()

    addStandardLights(scene)

    const floor = new Group()
    scene.add(floor)
    const root = new Group()
    scene.add(root)

    const core: SceneCore = {
      renderer, scene, camera, controls, root, floor,
      transform: null, selectionBox: null,
      visuals: new Map(),
      raycaster: new Raycaster(),
      pointer: new Vector2(),
      routineClock: 0,
      lastFrame: performance.now(),
      lastTick: 0,
    }
    coreRef.current = core

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return
      core.renderer.setSize(width, height, false)
      const cam = core.camera
      if (cam instanceof PerspectiveCamera) {
        cam.aspect = width / height
      } else {
        const halfWidth = cam.top * (width / height)
        cam.left = -halfWidth
        cam.right = halfWidth
      }
      cam.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    // --- Selección por click ---
    // Se distingue un click de un arrastre de cámara por la distancia
    // recorrida: sin esto, orbitar seleccionaría una pieza al azar al soltar.
    let downAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      downAt = { x: event.clientX, y: event.clientY }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !downAt) return
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      downAt = null
      if (moved > 4) return
      if (core.transform?.dragging) return   // el click es del gizmo

      const rect = core.renderer.domElement.getBoundingClientRect()
      core.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      core.raycaster.setFromCamera(core.pointer, core.camera)
      const hits = core.raycaster.intersectObject(core.root, true)
      const hit = hits.find(h => (h.object as Sprite).isSprite !== true)
      selectRef.current(hit ? findPartId(hit.object) : null)
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown)
    renderer.domElement.addEventListener("pointerup", onPointerUp)

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)

      const now = performance.now()
      // Se acota el paso: volver a la pestana despues de un rato daria un dt
      // enorme y la rutina saltaria varios segundos de golpe.
      const dt = Math.min(now - core.lastFrame, 100)
      core.lastFrame = now

      updateFrame(core, liveRef.current, dt, tickRef.current, now)
      core.selectionBox?.update()
      core.controls.update()
      core.renderer.render(core.scene, core.camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener("pointerdown", onPointerDown)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)
      core.transform?.detach()
      core.transform?.dispose()
      core.controls.dispose()
      clearTree(core.root)
      disposeGroup(core.floor)
      core.renderer.dispose()
      if (core.renderer.domElement.parentNode === container) {
        container.removeChild(core.renderer.domElement)
      }
      coreRef.current = null
    }
  }, [])

  // --- Piso, fondo y ejes del mundo ------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    const theme = THEME[settings.background]

    core.renderer.setClearColor(theme.clear, 1)
    disposeGroup(core.floor)
    if (settings.showFloor) core.floor.add(makeFloorGrid(FLOOR_HALF, settings.gridCell, theme.grid))
    if (settings.showWorldAxes) core.floor.add(makeAxes(0.35))
  }, [settings.showFloor, settings.gridCell, settings.showWorldAxes, settings.background])

  // --- Árbol de piezas --------------------------------------------------------
  // La firma deja afuera el valor manual de cada articulación: es el único
  // campo que se edita arrastrando, y rebuildear en cada frame del slider haría
  // parpadear la escena entera.
  const structureSignature = JSON.stringify(parts.map(p => ({
    ...p,
    joint: { ...p.joint, manual: 0 },
  })))
  const modelsSignature = [...models.keys()].sort().join("|")

  useEffect(() => {
    const core = coreRef.current
    if (!core) return

    detachGizmo(core)
    clearTree(core.root)
    core.visuals.clear()

    const theme = THEME[settings.background]
    buildPartTree(parts).forEach(node => buildNode(node, core.root, core, models, settings, theme))

    return () => {
      detachGizmo(core)
      clearTree(core.root)
      core.visuals.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    structureSignature, modelsSignature,
    settings.showJointAxes, settings.showJointLimits, settings.jointScale,
    settings.showPartLabels, settings.background,
  ])

  // --- Selección: caja y marcador de pivote -----------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return

    if (core.selectionBox) {
      core.scene.remove(core.selectionBox)
      core.selectionBox.geometry.dispose()
      core.selectionBox = null
    }

    // El marcador de pivote solo aparece en la pieza seleccionada: uno por
    // pieza sería una nube de puntos naranjas sin significado.
    core.visuals.forEach(visual => {
      if (visual.pivotMarker) visual.pivotMarker.visible = visual.id === selectedId
    })

    const visual = selectedId ? core.visuals.get(selectedId) : undefined
    if (visual && settings.showBounds) {
      const box = new BoxHelper(visual.jointGroup, new Color(SELECTION_COLOR))
      // Sin esto la caja desaparece cuando queda justo sobre la superficie.
      box.material.depthTest = false
      box.renderOrder = 5
      core.scene.add(box)
      core.selectionBox = box
    }
  }, [selectedId, settings.showBounds, structureSignature, modelsSignature])

  // --- Gizmo ------------------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    detachGizmo(core)

    const part = parts.find(p => p.id === selectedId)
    const visual = selectedId ? core.visuals.get(selectedId) : undefined
    if (settings.gizmo === "off" || !part || !visual || part.locked) return

    // El modo "pivot" arrastra el marcador naranja, no la pieza: mientras se
    // arrastra solo se mueve el marcador, que es exactamente lo que se está
    // eligiendo (dónde va a quedar el eje).
    const movingPivot = settings.gizmo === "pivot"
    const target = movingPivot ? visual.pivotMarker : visual.originGroup
    if (!target) return
    if (movingPivot) target.visible = true

    const transform = new TransformControls(core.camera, core.renderer.domElement)
    // `pivot` es un modo nuestro, no de TransformControls: por debajo es un
    // translate, lo único distinto es a qué objeto se engancha.
    transform.setMode(movingPivot || settings.gizmo === "translate" ? "translate" : "rotate")
    transform.setSpace(movingPivot ? "local" : settings.gizmoSpace)
    transform.setTranslationSnap(settings.gizmoSnap ? 0.01 : null)
    transform.setRotationSnap(settings.gizmoSnap ? 5 * DEG : null)
    transform.attach(target)

    // Orbitar y arrastrar el gizmo al mismo tiempo pelearía por el puntero.
    const onDragging = (event: { value: unknown }) => {
      core.controls.enabled = !event.value
      if (event.value) return

      // El commit va al SOLTAR: mandar el estado en cada frame del arrastre
      // dispararía una reconstrucción del árbol por movimiento del mouse.
      if (movingPivot) {
        commitRef.current(part.id, {
          pivot: [round(target.position.x), round(target.position.y), round(target.position.z)],
        })
        return
      }
      commitRef.current(part.id, {
        origin: [round(target.position.x), round(target.position.y), round(target.position.z)],
        originRotation: [
          round(target.rotation.x / DEG, 3),
          round(target.rotation.y / DEG, 3),
          round(target.rotation.z / DEG, 3),
        ],
      })
    }
    transform.addEventListener("dragging-changed", onDragging)

    core.scene.add(transform.getHelper())
    core.transform = transform

    return () => {
      transform.removeEventListener("dragging-changed", onDragging)
      detachGizmo(core)
      core.controls.enabled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedId, settings.gizmo, settings.gizmoSpace, settings.gizmoSnap,
    structureSignature, modelsSignature, settings.projection,
  ])

  // --- Proyección --------------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    const container = containerRef.current
    if (!core || !container) return
    const wantsOrtho = settings.projection === "orthographic"
    if (wantsOrtho === (core.camera instanceof OrthographicCamera)) return

    const old = core.camera
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
    const distance = old.position.distanceTo(core.controls.target)

    let camera: PerspectiveCamera | OrthographicCamera
    if (wantsOrtho) {
      const halfHeight = distance * Math.tan(22.5 * DEG)
      camera = new OrthographicCamera(
        -halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.02, 200,
      )
    } else {
      camera = new PerspectiveCamera(45, aspect, 0.02, 200)
    }
    camera.up.set(0, 0, 1)
    camera.position.copy(old.position)
    camera.updateProjectionMatrix()

    core.controls.dispose()
    const controls = makeOrbitControls(camera, core.renderer.domElement, { minDistance: 0.1, maxDistance: 30 })
    controls.target.copy(core.controls.target)
    controls.update()

    core.camera = camera
    core.controls = controls
  }, [settings.projection])

  // --- Rutina: volver al principio ----------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    core.routineClock = 0
    onRoutineTick?.(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineSeekToken])

  // --- Encuadre por defecto ----------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    core.camera.position.set(-1.1, -1.1, 0.8)
    core.controls.target.set(0, 0, 0.3)
    core.controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCameraToken])

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", touchAction: "none" }}
    />
  )
}

// --- Utilidades ------------------------------------------------------------------

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function detachGizmo(core: SceneCore) {
  if (!core.transform) return
  core.scene.remove(core.transform.getHelper())
  core.transform.detach()
  core.transform.dispose()
  core.transform = null
}

/** Vacía el árbol liberando materiales de las instancias y el resto de mallas. */
function clearTree(root: Group) {
  root.children.slice().forEach(child => {
    root.remove(child)
    child.traverse(node => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      // Las mallas importadas comparten geometría con el modelo cacheado, así
      // que solo se descarta lo propio: sus materiales y las primitivas.
      if (node.userData.imported) disposeInstance(node)
      else {
        mesh.geometry?.dispose()
        const material = (mesh as any).material
        if (Array.isArray(material)) material.forEach((m: any) => m?.dispose())
        else material?.dispose()
      }
    })
  })
}

/** Sube por los padres hasta encontrar a qué pieza pertenece la malla tocada. */
function findPartId(object: Object3D): string | null {
  let current: Object3D | null = object
  while (current) {
    if (typeof current.userData.partId === "string") return current.userData.partId
    current = current.parent
  }
  return null
}

// --- Construcción del árbol --------------------------------------------------------

function buildNode(
  node: PartNode,
  parent: Group,
  core: SceneCore,
  models: Map<string, LoadedModel>,
  settings: Mechanism3dSettings,
  theme: typeof THEME["light"],
) {
  const part = node.part
  const [px, py, pz] = part.pivot

  const originGroup = new Group()
  originGroup.name = `origin:${part.id}`
  originGroup.position.set(part.origin[0], part.origin[1], part.origin[2])
  originGroup.rotation.set(
    part.originRotation[0] * DEG,
    part.originRotation[1] * DEG,
    part.originRotation[2] * DEG,
  )
  parent.add(originGroup)

  // pivotOut/pivotIn se cancelan en reposo: el par es lo que traslada el centro
  // de giro sin mover la pieza de donde está.
  const pivotOut = new Group()
  pivotOut.position.set(px, py, pz)
  originGroup.add(pivotOut)

  const jointGroup = new Group()
  jointGroup.name = `joint:${part.id}`
  pivotOut.add(jointGroup)

  const pivotIn = new Group()
  pivotIn.position.set(-px, -py, -pz)
  // El id va acá y no en originGroup: el gizmo mueve el origen, y si el raycast
  // devolviera ese mismo objeto el helper se estaría seleccionando a sí mismo.
  pivotIn.userData.partId = part.id
  jointGroup.add(pivotIn)

  const modelSlot = new Group()
  modelSlot.visible = part.visible
  pivotIn.add(modelSlot)
  fillModelSlot(modelSlot, part, models)

  // El indicador marca por dónde pasa el eje, así que va en el marco FIJO.
  let joint: JointVisual | null = null
  if (settings.showJointAxes) {
    const built = buildJointIndicator(part, settings)
    if (built) {
      built.group.position.set(px, py, pz)
      built.group.userData.partId = part.id
      originGroup.add(built.group)
      joint = built.visual
    }
  }

  const pivotMarker = makePivotMarker(settings.jointScale)
  pivotMarker.position.set(px, py, pz)
  pivotMarker.visible = false
  pivotMarker.userData.partId = part.id
  originGroup.add(pivotMarker)

  if (settings.showPartLabels) {
    const label = makeTextSprite(part.name, {
      height: 0.06, color: theme.label, background: theme.labelBg,
    })
    label.position.set(0, 0, 0.08)
    pivotIn.add(label)
  }

  core.visuals.set(part.id, { id: part.id, originGroup, jointGroup, pivotMarker, joint })

  node.children.forEach(child => buildNode(child, pivotIn, core, models, settings, theme))
}

/** Crucecita naranja que marca el centro de rotación de la pieza seleccionada. */
function makePivotMarker(scale: number): Group {
  const size = 0.02 * scale
  const group = new Group()
  const material = new MeshBasicMaterial({ color: PIVOT_COLOR, depthTest: false })

  const ball = new Mesh(new SphereGeometry(size * 0.55, 14, 10), material)
  ball.renderOrder = 8
  group.add(ball)

  // Tres varillas cortas: una bolita sola es difícil de ubicar en profundidad.
  const arms: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  arms.forEach(dir => {
    const arm = new Mesh(new CylinderGeometry(size * 0.12, size * 0.12, size * 3, 6), material)
    arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...dir))
    arm.renderOrder = 8
    group.add(arm)
  })
  return group
}

// --- Indicadores de junta -----------------------------------------------------------

/**
 * Anillo (revoluto) o riel (prismático) sobre el eje de la articulación, con la
 * porción recorrida resaltada. Es lo que en Onshape deja ver de un vistazo qué
 * junta es cada una, hacia dónde se mueve y cuánto le queda de recorrido.
 */
function buildJointIndicator(
  part: Mechanism3dPart,
  settings: Mechanism3dSettings,
): { group: Group; visual: JointVisual } | null {
  const { joint } = part
  if (joint.type === "fixed") return null

  const group = new Group()

  // Una pose no tiene eje: se marca el marco que va a tomar del topic.
  if (joint.type === "pose") {
    group.add(makeAxes(0.1 * settings.jointScale))
    return {
      group,
      visual: { kind: "revolute", sweep: null, segments: [], head: null, travel: { min: 0, max: 0 } },
    }
  }

  // Todo el indicador se dibuja con el eje en +Z y después se lo orienta: es
  // mucho más simple que construir cada pieza sobre un eje arbitrario.
  const axis = normalizeAxis(joint.axis)
  group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(axis[0], axis[1], axis[2]))

  const scale = settings.jointScale
  const rotational = joint.type !== "prismatic"
  const color = rotational ? REVOLUTE_COLOR : PRISMATIC_COLOR
  const trackMaterial = new MeshBasicMaterial({ color, transparent: true, opacity: 0.45 })
  const liveMaterial = new MeshBasicMaterial({ color, side: DoubleSide })

  if (rotational) {
    const radius = JOINT_RADIUS * scale
    const tube = radius * 0.035

    // Anillo completo: la "pista" sobre la que corre el barrido.
    group.add(new Mesh(new TorusGeometry(radius, tube, 8, 64), trackMaterial))

    // Varilla del eje, que es lo que hace evidente alrededor de qué gira.
    const rod = new Mesh(
      new CylinderGeometry(tube * 0.8, tube * 0.8, radius * 2.6, 10).rotateX(Math.PI / 2),
      trackMaterial,
    )
    group.add(rod)

    // Sector de los límites: se ve de una cuánto recorrido queda de cada lado.
    const range = settings.showJointLimits ? sweepRange(joint) : null
    if (range) {
      const sector = new Mesh(
        new CircleGeometry(radius * 0.94, 48, range.min, range.max - range.min),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: DoubleSide }),
      )
      group.add(sector)
      // Topes: dos varillas radiales en los extremos del recorrido.
      ;[range.min, range.max].forEach(angle => {
        const stop = new Mesh(new BoxGeometry(radius * 0.9, tube * 1.6, tube * 1.6), trackMaterial)
        stop.position.set(Math.cos(angle) * radius * 0.45, Math.sin(angle) * radius * 0.45, 0)
        stop.rotation.z = angle
        group.add(stop)
      })
    }

    // Marca del cero, para saber desde dónde se está midiendo.
    const zero = new Mesh(new BoxGeometry(radius * 0.34, tube * 2.2, tube * 2.2), liveMaterial)
    zero.position.x = radius * 1.12
    group.add(zero)

    // Barrido: trozos fijos de los que se muestran los primeros n. Cambiar
    // `thetaLength` obligaría a rehacer la geometría en cada frame.
    const sweep = new Group()
    const step = (Math.PI * 2) / SWEEP_SEGMENTS
    const segmentGeometry = new TorusGeometry(radius, tube * 2.1, 6, 6, step * 1.06)
    const segments: Mesh[] = []
    for (let i = 0; i < SWEEP_SEGMENTS; i++) {
      const segment = new Mesh(segmentGeometry, liveMaterial)
      segment.rotation.z = i * step
      segment.visible = false
      sweep.add(segment)
      segments.push(segment)
    }

    // Punta tangente al anillo: marca dónde está la pieza ahora mismo.
    const head = new Group()
    const cone = new Mesh(new ConeGeometry(tube * 4, tube * 10, 12).rotateZ(-Math.PI / 2), liveMaterial)
    cone.position.x = radius
    cone.rotation.z = Math.PI / 2
    head.add(cone)
    sweep.add(head)
    group.add(sweep)

    return {
      group,
      visual: { kind: "revolute", sweep, segments, head, travel: { min: 0, max: 0 } },
    }
  }

  // --- Prismático: riel con topes y un cursor que corre por él ---
  const travel = travelRange(joint, 0.15 * scale)
  const span = Math.max(travel.max - travel.min, 1e-3)
  const tube = 0.006 * scale

  const rail = new Mesh(
    new CylinderGeometry(tube, tube, span, 10).rotateX(Math.PI / 2),
    trackMaterial,
  )
  rail.position.z = (travel.min + travel.max) / 2
  group.add(rail)

  // Topes en las dos puntas del recorrido.
  ;[travel.min, travel.max].forEach((z, i) => {
    const stop = new Mesh(new CylinderGeometry(tube * 3.4, tube * 3.4, tube * 1.4, 16).rotateX(Math.PI / 2), trackMaterial)
    stop.position.z = z
    group.add(stop)

    const arrow = new Mesh(new ConeGeometry(tube * 3, tube * 8, 12).rotateX(Math.PI / 2), trackMaterial)
    arrow.position.z = z + (i === 0 ? -tube * 5 : tube * 5)
    arrow.rotation.x = i === 0 ? Math.PI : 0
    group.add(arrow)
  })

  const head = new Mesh(new TorusGeometry(tube * 3.6, tube * 1.5, 8, 20), liveMaterial)
  group.add(head)

  return { group, visual: { kind: "prismatic", sweep: null, segments: [], head, travel } }
}

// --- Modelo de cada pieza -----------------------------------------------------------

function fillModelSlot(slot: Group, part: Mechanism3dPart, models: Map<string, LoadedModel>) {
  const wrapper = new Group()
  wrapper.position.set(part.modelOffset[0], part.modelOffset[1], part.modelOffset[2])
  wrapper.rotation.set(
    part.modelRotation[0] * DEG,
    part.modelRotation[1] * DEG,
    part.modelRotation[2] * DEG,
  )
  slot.add(wrapper)

  const model = part.modelPath ? models.get(part.modelPath) : undefined
  if (model) {
    const instance = instantiateModel(model, part.modelAnchor)
    const largest = Math.max(model.size.x, model.size.y, model.size.z, 1e-6)
    const scale = part.modelAutoFit ? part.modelFitSize / largest : part.modelScale
    instance.scale.setScalar(isFinite(scale) && scale > 0 ? scale : 1)
    instance.traverse(node => { node.userData.imported = true })
    applyAppearance(instance, part, null)
    wrapper.add(instance)
    return
  }

  if (part.shape === "none") return
  const mesh = new Mesh(primitiveGeometry(part), new MeshStandardMaterial({
    color: PRIMITIVE_COLOR, metalness: 0.1, roughness: 0.7,
  }))
  applyAppearance(mesh, part, PRIMITIVE_COLOR)
  wrapper.add(mesh)
}

function primitiveGeometry(part: Mechanism3dPart) {
  const [a, b, c] = part.shapeSize.map(v => Math.max(Math.abs(v), 1e-4))
  switch (part.shape) {
    case "cylinder":
      // El cilindro de three tiene el eje en Y; acá todo se piensa con Z arriba.
      return new CylinderGeometry(a, a, c, 24).rotateX(Math.PI / 2)
    case "sphere":
      return new SphereGeometry(a, 24, 16)
    default:
      return new BoxGeometry(a, b, c)
  }
}

function applyAppearance(object: Object3D, part: Mechanism3dPart, fallbackColor: number | null) {
  materialsOf(object).forEach(material => {
    const standard = material as MeshStandardMaterial
    if (part.color) standard.color?.set(part.color)
    else if (fallbackColor !== null) standard.color?.set(fallbackColor)
    standard.wireframe = part.wireframe
    standard.transparent = part.opacity < 1
    standard.opacity = part.opacity
    standard.depthWrite = part.opacity >= 1
    standard.needsUpdate = true
  })
}

// --- Actualización por frame ----------------------------------------------------------

const tmpQuat = new Quaternion()

interface LiveState {
  parts: Mechanism3dPart[]
  settings: Mechanism3dSettings
  values: Record<string, any>
  routine: Mechanism3dRoutine | null
  routineActive: boolean
  routinePlaying: boolean
  routineSpeed: number
}

function updateFrame(
  core: SceneCore,
  live: LiveState,
  dt: number,
  onTick: ((timeMs: number, fraction: number) => void) | undefined,
  now: number,
) {
  // La rutina, si esta activa, manda sobre los topics y sobre el valor manual.
  let routineValues: Record<string, number> | null = null
  if (live.routine && live.routineActive) {
    const duration = routineDuration(live.routine)

    if (live.routinePlaying && duration > 0) {
      core.routineClock += dt * live.routineSpeed
      if (core.routineClock > duration) {
        core.routineClock = live.routine.loop ? core.routineClock % duration : duration
      }
    }
    routineValues = evaluateRoutine(live.routine, core.routineClock)

    // El progreso sale a ~10 Hz: es suficiente para una barra y evita
    // re-renderizar la pagina sesenta veces por segundo.
    if (onTick && now - core.lastTick > 100) {
      core.lastTick = now
      onTick(core.routineClock, duration > 0 ? core.routineClock / duration : 0)
    }
  } else if (core.routineClock !== 0 && !live.routineActive) {
    core.routineClock = 0
  }

  live.parts.forEach(part => {
    const visual = core.visuals.get(part.id)
    if (!visual) return

    const routineValue = routineValues?.[part.id]
    const liveValue = part.joint.topicName ? live.values[part.joint.topicName] : undefined
    const transform = routineValue !== undefined
      ? jointTransformFromValue(part.joint, routineValue)
      : jointTransform(part.joint, liveValue, live.settings.manualOverride)

    visual.jointGroup.position.set(transform.position[0], transform.position[1], transform.position[2])
    tmpQuat.set(transform.quaternion[0], transform.quaternion[1], transform.quaternion[2], transform.quaternion[3])
    visual.jointGroup.quaternion.copy(tmpQuat)

    if (!visual.joint || part.joint.type === "pose" || part.joint.type === "fixed") return
    const value = routineValue !== undefined
      ? routineValue
      : jointValue(part.joint, liveValue, live.settings.manualOverride)

    if (visual.joint.kind === "revolute" && visual.joint.sweep) {
      const angle = value * unitScale(part.joint.units, "angle")
      const magnitude = Math.min(Math.abs(angle), Math.PI * 2)
      const count = Math.round((magnitude / (Math.PI * 2)) * SWEEP_SEGMENTS)
      visual.joint.segments.forEach((segment, i) => { segment.visible = i < count })
      // Con ángulo negativo se espeja el barrido entero, que es lo mismo que
      // dibujarlo en sentido horario.
      visual.joint.sweep.scale.y = angle < 0 ? -1 : 1
      if (visual.joint.head) {
        visual.joint.head.visible = count > 0
        visual.joint.head.rotation.z = (count / SWEEP_SEGMENTS) * Math.PI * 2
      }
      return
    }

    if (visual.joint.head) {
      const distance = value * unitScale(part.joint.units, "length")
      const { min, max } = visual.joint.travel
      visual.joint.head.position.z = Math.min(Math.max(distance, min), max)
    }
  })
}
