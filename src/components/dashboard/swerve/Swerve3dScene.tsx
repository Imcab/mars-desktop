// Vista 3D del swerve: el mismo diagrama que SwerveCanvas, pero con volumen y
// con el modelo real del robot encima.
//
// El robot NO se traslada: se queda en el origen y lo que se mueve es el piso,
// al revés que el chasis. Así se ve la velocidad sin necesitar odometría ni
// una cancha, que es justo lo que hace falta para calibrar módulos.
//
// Todo se arma con Z arriba, X adelante y Y a la izquierda (el marco de
// WPILib): los ángulos de módulo y el heading entran tal cual salen de NT.

import { useEffect, useRef, useState } from "react"
import {
  Box3, BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, EdgesGeometry, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PerspectiveCamera, Scene, TorusGeometry, WebGLRenderer,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Swerve3dModulePlacement, Swerve3dSettings, SwerveSettings } from "../../../store/appStore"
import { ChassisVelocities, ModuleState } from "../../../utils/field/swerveExtraction"
import {
  LoadedModel, instantiateModel, materialsOf, disposeInstance, DEFAULT_MODEL_COLOR,
} from "../../../utils/field/robotModel"
import {
  DEG, addStandardLights, arrowMaterial, disposeGroup, makeArrow, makeAxes, makeFloorGrid,
  makeOrbitControls, makeTextSprite, ratioColor, setArrowLength, setArrowOpacity,
} from "../three/sceneKit"
import { ModuleSet, ChassisSet } from "./SwerveCanvas"

export interface Swerve3dFrameData {
  moduleSets: ModuleSet[]
  chassisSets: ChassisSet[]
  /** Heading del chasis en radianes. */
  rotation: number
  /** Velocidad usada para el arco de ω y para desplazar el piso. */
  velocity: ChassisVelocities | null
}

interface Props {
  data: Swerve3dFrameData
  settings: SwerveSettings
  view: Swerve3dSettings
  /** FL, FR, BL, BR ya resueltas (automáticas o manuales). */
  placements: Swerve3dModulePlacement[]
  /** Modelo ya cargado, o null para el chasis genérico. */
  model: LoadedModel | null
  /** Cambia de valor cuando la página pide volver a la vista por defecto. */
  resetCameraToken: number
}

const CORNER_LABELS = ["FL", "FR", "BL", "BR"]

const FLOOR_HALF = 14        // m; el piso es mucho más grande que lo visible
const FLOOR_CELL = 0.5       // m entre líneas de la grilla
const OMEGA_SEGMENTS = 48    // trozos del arco de ω (se muestran los primeros n)
// --- Piezas propias de esta vista -------------------------------------------

// Caja de alambre con el tamaño declarado del chasis: es la referencia contra
// la que se compara si el modelo importado quedó a escala.
function makeFrameBox(length: number, width: number, height: number): LineSegments {
  const box = new LineSegments(
    new EdgesGeometry(new BoxGeometry(length, width, height)),
    new LineBasicMaterial({ color: 0x3a3a42 }),
  )
  box.position.z = height / 2
  return box
}

// --- Estructura de la escena ------------------------------------------------

interface ArrowVisual {
  setId: string
  /** Gira con el desvío de ESTE set respecto del azimut medido. */
  pivot: Group
  arrow: Group
  baseColor: string
  ghost: boolean
}

interface ModuleVisual {
  azimuth: Group
  ring: Mesh
  arrows: ArrowVisual[]
}

interface ChassisVisual {
  setId: string
  pivot: Group
  arrow: Group
}

interface Visuals {
  modules: ModuleVisual[]
  chassis: ChassisVisual[]
  omega: { group: Group; segments: Mesh[]; head: Group } | null
}

interface SceneCore {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera
  controls: OrbitControls
  robotGroup: Group
  modelSlot: Group
  contents: Group
  floorGroup: Group
  floorInner: Group
  visuals: Visuals | null
  offset: { x: number; y: number }
  lastTime: number
}

export default function Swerve3dScene({
  data, settings, view, placements, model, resetCameraToken,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Los datos llegan a ~30 Hz por props, pero la escena se redibuja a 60 fps
  // (la cámara y el piso se mueven solos). Por eso el frame loop lee de refs y
  // no de las props: así no hace falta recrear el loop en cada muestra.
  const dataRef = useRef(data)
  dataRef.current = data
  const configRef = useRef({ settings, view, placements })
  configRef.current = { settings, view, placements }

  const coreRef = useRef<SceneCore | null>(null)

  // Altura real que ocupa el modelo ya escalado y girado. La flecha del chasis
  // y el arco de ω se dibujan por ENCIMA de eso: si se dejaran a la altura del
  // chasis quedarían enterrados dentro de la malla del robot.
  const [modelTop, setModelTop] = useState(0)

  // --- Montaje: renderer, cámara, luces, piso, loop --------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0xe6e6ea, 1)
    renderer.domElement.style.display = "block"
    renderer.domElement.style.width = "100%"
    renderer.domElement.style.height = "100%"
    container.appendChild(renderer.domElement)

    const scene = new Scene()

    const camera = new PerspectiveCamera(45, 1, 0.05, 200)
    // Z arriba: sin esto la órbita giraría alrededor del eje equivocado y el
    // robot se vería acostado.
    camera.up.set(0, 0, 1)
    camera.position.set(-1.8, -1.8, 1.4)

    const controls = makeOrbitControls(camera, renderer.domElement, { minDistance: 0.4, maxDistance: 25 })
    controls.target.set(0, 0, 0.2)
    controls.update()

    addStandardLights(scene)

    const floorGroup = new Group()
    const floorInner = new Group()
    floorInner.add(makeFloorGrid(FLOOR_HALF, FLOOR_CELL))
    floorGroup.add(floorInner)
    scene.add(floorGroup)

    const robotGroup = new Group()
    const modelSlot = new Group()
    const contents = new Group()
    robotGroup.add(modelSlot, contents)
    scene.add(robotGroup)

    const core: SceneCore = {
      renderer, scene, camera, controls, robotGroup, modelSlot, contents,
      floorGroup, floorInner, visuals: null,
      offset: { x: 0, y: 0 }, lastTime: performance.now(),
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
        // En ortográfica el encuadre lo fija el alto, no la distancia.
        const halfWidth = cam.top * (width / height)
        cam.left = -halfWidth
        cam.right = halfWidth
      }
      cam.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    let frame = 0
    const animate = () => {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      // Se acota el paso: volver a la pestaña después de un rato daría un dt
      // enorme y el piso saltaría metros de golpe.
      const dt = Math.min((now - core.lastTime) / 1000, 0.1)
      core.lastTime = now

      updateScene(core, dataRef.current, configRef.current, dt)
      core.controls.update()
      core.renderer.render(core.scene, core.camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      core.controls.dispose()
      disposeGroup(core.contents)
      clearModelSlot(core.modelSlot)
      core.renderer.dispose()
      if (core.renderer.domElement.parentNode === container) {
        container.removeChild(core.renderer.domElement)
      }
      coreRef.current = null
    }
  }, [])

  // --- Proyección: la cámara se recrea porque cambia de clase ----------------
  useEffect(() => {
    const core = coreRef.current
    const container = containerRef.current
    if (!core || !container) return
    const wantsOrtho = view.projection === "orthographic"
    if (wantsOrtho === (core.camera instanceof OrthographicCamera)) return

    const old = core.camera
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
    const distance = old.position.distanceTo(core.controls.target)

    let camera: PerspectiveCamera | OrthographicCamera
    if (wantsOrtho) {
      // El alto se elige para que la ortográfica arranque mostrando más o
      // menos lo mismo que venía mostrando la perspectiva.
      const halfHeight = distance * Math.tan(22.5 * DEG)
      camera = new OrthographicCamera(
        -halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.05, 200,
      )
    } else {
      camera = new PerspectiveCamera(45, aspect, 0.05, 200)
    }
    camera.up.set(0, 0, 1)
    camera.position.copy(old.position)
    camera.updateProjectionMatrix()

    core.controls.dispose()
    const controls = makeOrbitControls(camera, core.renderer.domElement, { minDistance: 0.4, maxDistance: 25 })
    controls.target.copy(core.controls.target)
    controls.update()

    core.camera = camera
    core.controls = controls
  }, [view.projection])

  // --- Vista por defecto -----------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    const reach = Math.max(settings.frameLength, settings.frameWidth) * 2.6 + 0.5
    core.camera.position.set(-reach * 0.72, -reach * 0.72, reach * 0.55)
    core.controls.target.set(0, 0, 0.15)
    core.controls.update()
    core.offset.x = 0
    core.offset.y = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCameraToken])

  // --- Modelo del robot ------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return

    clearModelSlot(core.modelSlot)
    if (!model || !view.showModel) {
      setModelTop(0)
      return
    }

    const instance = instantiateModel(model, "base")
    const scale = view.modelAutoFit
      ? Math.max(settings.frameLength, settings.frameWidth) / Math.max(model.size.x, model.size.y, 1e-6)
      : view.modelScale
    instance.scale.setScalar(isFinite(scale) && scale > 0 ? scale : 1)

    materialsOf(instance).forEach(material => {
      const standard = material as MeshStandardMaterial
      if (view.modelColor) standard.color?.set(view.modelColor)
      else if (model.format === "stl") standard.color?.set(DEFAULT_MODEL_COLOR)
      standard.wireframe = view.modelWireframe
      standard.transparent = view.modelOpacity < 1
      standard.opacity = view.modelOpacity
      standard.depthWrite = view.modelOpacity >= 1
      standard.side = DoubleSide
      standard.needsUpdate = true
    })

    // El wrapper es el que gira: el modelo ya viene centrado en XY y apoyado en
    // z = 0, así que el pivote queda en el centro del chasis a ras de piso.
    const wrapper = new Group()
    wrapper.add(instance)
    wrapper.rotation.set(view.modelRotX * DEG, view.modelRotY * DEG, view.modelRotZ * DEG)
    wrapper.position.set(view.modelOffsetX, view.modelOffsetY, view.modelOffsetZ)
    core.modelSlot.add(wrapper)

    // Apoyar la base en el piso va DESPUÉS de escalar y girar: cuál es la cara
    // de abajo depende de la rotación que se le haya puesto.
    wrapper.updateMatrixWorld(true)
    const box = new Box3().setFromObject(wrapper)
    if (view.modelDropToFloor && isFinite(box.min.z)) {
      wrapper.position.z += view.modelOffsetZ - box.min.z
      setModelTop(box.max.z - box.min.z + view.modelOffsetZ)
    } else {
      setModelTop(isFinite(box.max.z) ? box.max.z : 0)
    }
  }, [
    model, view.showModel, view.modelScale, view.modelAutoFit, view.modelColor,
    view.modelOpacity, view.modelWireframe, view.modelDropToFloor,
    view.modelRotX, view.modelRotY, view.modelRotZ,
    view.modelOffsetX, view.modelOffsetY, view.modelOffsetZ,
    settings.frameLength, settings.frameWidth,
  ])

  // --- Módulos, chasis y arco de ω ------------------------------------------
  // Se reconstruyen cuando cambia la configuración o el juego de fuentes; los
  // valores en sí se aplican en el loop, que solo toca transformaciones.
  const setSignature = data.moduleSets.map(s => `${s.id}:${s.color}:${s.role}`).join("|")
  const chassisSignature = data.chassisSets.map(s => `${s.id}:${s.color}`).join("|")
  const placementSignature = placements.map(p => `${p.x},${p.y},${p.z}`).join("|")
  const hasModel = model !== null && view.showModel

  useEffect(() => {
    const core = coreRef.current
    if (!core) return

    disposeGroup(core.contents)
    core.visuals = buildVisuals(core.contents, {
      settings, view, placements,
      moduleSets: dataRef.current.moduleSets,
      chassisSets: dataRef.current.chassisSets,
      hasModel, modelTop,
    })

    return () => {
      disposeGroup(core.contents)
      core.visuals = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setSignature, chassisSignature, placementSignature, hasModel, modelTop,
    settings.frameLength, settings.frameWidth,
    view.showFrame, view.showModules, view.showVectors, view.showSetpoints,
    view.showChassisVector, view.showOmega, view.showLabels, view.showAxes,
    view.wheelRadius, view.wheelWidth, view.gradient,
  ])

  // --- Piso ------------------------------------------------------------------
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    core.floorGroup.visible = view.showFloor
    if (!view.motionFloor) {
      core.offset.x = 0
      core.offset.y = 0
    }
  }, [view.showFloor, view.motionFloor])

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", touchAction: "none" }}
    />
  )
}

// --- Construcción ------------------------------------------------------------

function clearModelSlot(slot: Group) {
  slot.children.slice().forEach(child => {
    slot.remove(child)
    disposeInstance(child)
  })
}

function buildVisuals(
  root: Group,
  args: {
    settings: SwerveSettings
    view: Swerve3dSettings
    placements: Swerve3dModulePlacement[]
    moduleSets: ModuleSet[]
    chassisSets: ChassisSet[]
    hasModel: boolean
    /** Altura del punto más alto del modelo, para no dibujar dentro de él. */
    modelTop: number
  },
): Visuals {
  const { settings, view, placements, moduleSets, chassisSets, hasModel, modelTop } = args
  const frameHeight = Math.max(view.wheelRadius * 2 + 0.06, 0.12)
  // Altura a la que flotan la flecha del chasis y el arco de ω.
  const topHeight = Math.max(frameHeight, modelTop) + 0.07

  if (view.showFrame) {
    root.add(makeFrameBox(settings.frameLength, settings.frameWidth, frameHeight))
  }

  // Sin modelo importado se dibuja un chasis genérico: la vista tiene que
  // servir apenas se abre la pestaña, no solo después de elegir un archivo.
  if (!hasModel) {
    const body = new Mesh(
      new BoxGeometry(settings.frameLength * 0.94, settings.frameWidth * 0.94, frameHeight * 0.8),
      new MeshStandardMaterial({
        color: 0xb9bcc4, metalness: 0.1, roughness: 0.7, transparent: true, opacity: 0.55,
      }),
    )
    body.position.z = frameHeight / 2
    root.add(body)

    // Cuña en el frente, para saber hacia dónde mira el robot sin depender de
    // los ejes.
    const nose = new Mesh(
      new ConeGeometry(settings.frameWidth * 0.13, settings.frameLength * 0.22, 4).rotateZ(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0xa83c3c, roughness: 0.6 }),
    )
    nose.position.set(settings.frameLength * 0.36, 0, frameHeight + 0.02)
    root.add(nose)
  }

  if (view.showAxes) root.add(makeAxes(Math.max(settings.frameLength, settings.frameWidth) * 0.8))

  const wheelGeometry = new CylinderGeometry(view.wheelRadius, view.wheelRadius, view.wheelWidth, 22)
  const ringGeometry = new TorusGeometry(view.wheelRadius * 1.6, view.wheelRadius * 0.1, 8, 30)

  const modules: ModuleVisual[] = []
  if (view.showModules) {
    placements.forEach((placement, index) => {
      const group = new Group()
      group.position.set(placement.x, placement.y, placement.z)

      const azimuth = new Group()
      group.add(azimuth)

      // La rueda es un cilindro con el eje en Y: así rueda hacia +X y girar el
      // grupo `azimuth` alrededor de Z la apunta al azimut del módulo.
      azimuth.add(new Mesh(wheelGeometry, new MeshStandardMaterial({
        color: 0x2f3038, metalness: 0.2, roughness: 0.75,
      })))

      // Anillo en el piso alrededor del módulo: se pone rojo cuando ese módulo
      // pasa la rapidez máxima, igual que el círculo del canvas 2D.
      const ring = new Mesh(ringGeometry, new MeshBasicMaterial({ color: 0x6a6a72 }))
      ring.position.z = -placement.z + 0.004
      group.add(ring)

      const arrows: ArrowVisual[] = []
      if (view.showVectors) {
        moduleSets.forEach(set => {
          const ghost = set.role === "setpoint"
          if (ghost && !view.showSetpoints) return
          const pivot = new Group()
          const arrow = makeArrow(set.color, view.wheelRadius * (ghost ? 0.16 : 0.24))
          if (ghost) setArrowOpacity(arrow, 0.5)
          pivot.add(arrow)
          azimuth.add(pivot)
          arrows.push({ setId: set.id, pivot, arrow, baseColor: set.color, ghost })
        })
      }

      if (view.showLabels) {
        const label = makeTextSprite(CORNER_LABELS[index] ?? `M${index}`)
        label.position.set(0, 0, view.wheelRadius + 0.12)
        group.add(label)
      }

      root.add(group)
      modules.push({ azimuth, ring, arrows })
    })
  }

  const chassis: ChassisVisual[] = []
  if (view.showChassisVector) {
    chassisSets.forEach(set => {
      const pivot = new Group()
      pivot.position.z = topHeight
      const arrow = makeArrow(set.color, 0.016)
      pivot.add(arrow)
      root.add(pivot)
      chassis.push({ setId: set.id, pivot, arrow })
    })
  }

  let omega: Visuals["omega"] = null
  if (view.showOmega) {
    // El arco se arma con trozos fijos y se muestran los primeros n: cambiar
    // `thetaLength` obligaría a rehacer la geometría en cada frame.
    const radius = Math.max(settings.frameLength, settings.frameWidth) * 0.75
    const step = (Math.PI * 2) / OMEGA_SEGMENTS
    const segmentGeometry = new TorusGeometry(radius, 0.008, 6, 6, step * 1.05)
    const material = new MeshBasicMaterial({ color: 0x7c3aed, side: DoubleSide })

    const group = new Group()
    group.position.z = topHeight + 0.04
    const segments: Mesh[] = []
    for (let i = 0; i < OMEGA_SEGMENTS; i++) {
      const segment = new Mesh(segmentGeometry, material)
      segment.rotation.z = i * step
      segment.visible = false
      group.add(segment)
      segments.push(segment)
    }

    // La punta va en tangente al arco, que es la dirección del giro.
    const head = new Group()
    const cone = new Mesh(new ConeGeometry(0.024, 0.065, 12).rotateZ(-Math.PI / 2), material)
    cone.position.x = radius
    cone.rotation.z = Math.PI / 2
    head.add(cone)
    group.add(head)

    root.add(group)
    omega = { group, segments, head }
  }

  return { modules, chassis, omega }
}

// --- Actualización por frame -------------------------------------------------

function updateScene(
  core: SceneCore,
  data: Swerve3dFrameData,
  config: { settings: SwerveSettings; view: Swerve3dSettings; placements: Swerve3dModulePlacement[] },
  dt: number,
) {
  const { settings, view } = config
  const heading = data.rotation

  // El robot gira con el gyro; con followHeading apagado se queda quieto y lo
  // que gira es el piso, que es la vista solidaria al chasis.
  core.robotGroup.rotation.z = view.followHeading ? heading : 0
  core.floorGroup.rotation.z = view.followHeading ? 0 : -heading

  if (view.motionFloor && data.velocity) {
    // La velocidad viene en el marco del robot: para desplazar el piso hay que
    // pasarla al marco de la cancha.
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    core.offset.x += (data.velocity.vx * cos - data.velocity.vy * sin) * dt
    core.offset.y += (data.velocity.vx * sin + data.velocity.vy * cos) * dt
    // Se envuelve por celda: el piso es finito y sin esto terminaría saliéndose
    // del encuadre después de unos metros.
    core.offset.x %= FLOOR_CELL
    core.offset.y %= FLOOR_CELL
  }
  core.floorInner.position.set(-core.offset.x, -core.offset.y, 0)

  const visuals = core.visuals
  if (!visuals) return

  const maxSpeed = settings.maxSpeed > 0 ? settings.maxSpeed : 1
  // Largo del vector a fondo de escala, en metros de la escena.
  const fullVector = Math.max(settings.frameLength, settings.frameWidth) * 0.85
  // El azimut de la rueda lo marca el set medido; si solo hay comandados, el
  // primero que haya.
  const primary = data.moduleSets.find(s => s.role !== "setpoint") ?? data.moduleSets[0]

  visuals.modules.forEach((visual, index) => {
    const primaryState: ModuleState | undefined = primary?.values[index]
    if (primaryState) visual.azimuth.rotation.z = primaryState.angle

    const overSpeed = data.moduleSets.some(set => {
      const state = set.values[index]
      return state !== undefined && Math.abs(state.speed) > maxSpeed
    })
    ;(visual.ring.material as MeshBasicMaterial).color.set(overSpeed ? 0xc21c1c : 0x6a6a72)

    visual.arrows.forEach(entry => {
      const set = data.moduleSets.find(s => s.id === entry.setId)
      const state = set?.values[index]
      if (!state) {
        entry.arrow.visible = false
        return
      }

      // Cada set tiene su propio ángulo: por eso la flecha cuelga de un pivote
      // propio y no directamente del azimut medido.
      const delta = primaryState ? state.angle - primaryState.angle : 0
      entry.pivot.rotation.z = state.speed < 0 ? delta + Math.PI : delta

      // Se deja pasar del 100% para que la saturación se vea a simple vista.
      const ratio = Math.abs(state.speed) / maxSpeed
      setArrowLength(entry.arrow, view.wheelRadius + Math.min(ratio, 1.35) * fullVector)
      const material = arrowMaterial(entry.arrow)
      if (view.gradient && !entry.ghost) material.color.copy(ratioColor(ratio))
      else material.color.set(entry.baseColor)
    })
  })

  visuals.chassis.forEach(entry => {
    const set = data.chassisSets.find(s => s.id === entry.setId)
    if (!set) {
      entry.arrow.visible = false
      return
    }
    entry.pivot.rotation.z = Math.atan2(set.value.vy, set.value.vx)
    setArrowLength(entry.arrow, Math.min(Math.hypot(set.value.vx, set.value.vy) / maxSpeed, 1.35) * fullVector)
  })

  if (visuals.omega) {
    const omega = data.velocity?.omega ?? 0
    const magnitude = Math.min(Math.abs(omega), Math.PI * 2)
    const count = Math.round((magnitude / (Math.PI * 2)) * OMEGA_SEGMENTS)
    visuals.omega.segments.forEach((segment, i) => { segment.visible = i < count })
    visuals.omega.head.visible = count > 0
    visuals.omega.head.rotation.z = (count / OMEGA_SEGMENTS) * Math.PI * 2
    // Con ω negativo se espeja el arco entero, que es lo mismo que dibujarlo
    // en sentido horario.
    visuals.omega.group.scale.y = omega < 0 ? -1 : 1
  }
}
