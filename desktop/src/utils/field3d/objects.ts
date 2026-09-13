// Opciones por objeto del Field 3D: defaults, saneo y heurísticas de arrastre.
//
// Misma idea que `utils/field/fieldObjects.ts` para el visualizador 2D: cada
// campo más allá de los seis obligatorios es OPCIONAL, y en vez de repartir
// `?? default` por todo el renderer todo pasa una sola vez por
// `resolveField3dOptions`, que devuelve la versión completa.

import {
  Field3dObjectConfig, Field3dObjectType, Field3dSettings, Field3dArrayFormat,
  Field3dTrajectoryStyle, Field3dCameraMode, Field3dQuality, Field3dOrigin,
  defaultField3dSettings, EVERGREEN_FIELD_KEY,
} from "../../store/appStore"
import { Field3dCoordinateSystem, COORDINATE_SYSTEMS } from "./frames"
import { isPose3dTopic } from "./pose3d"

export interface ResolvedField3dOptions {
  hidden: boolean
  opacity: number
  showLabel: boolean
  trailSeconds: number
  arrayFormat: Field3dArrayFormat
  robotAssetKey: string | null
  useModel: boolean
  anchorId: string | null
  trajectoryStyle: Field3dTrajectoryStyle
  trajectoryWidth: number
  showWaypoints: boolean
  trajectoryHeight: number
  visionCameraIndex: number
  gamePieceIndex: number
  markerSize: number
}

export const FIELD3D_OBJECT_TYPES: Field3dObjectType[] = [
  "robot", "ghost", "component", "trajectory", "vision", "gamePiece", "cone", "axes",
]

export const FIELD3D_OBJECT_LABELS: Record<Field3dObjectType, string> = {
  robot: "Robot",
  ghost: "Ghost",
  component: "Components",
  trajectory: "Trajectory",
  vision: "Vision target",
  gamePiece: "Game piece",
  cone: "Marker",
  axes: "Axes",
}

export const FIELD3D_OBJECT_HELP: Record<Field3dObjectType, string> = {
  robot: "The robot itself: your imported CAD model, or a box with alliance-coloured bumpers if there is no model.",
  ghost: "The same robot drawn translucent — a setpoint, a second pose estimate, or yesterday's run on top of today's.",
  component: "Articulated parts (arm, elevator, intake) driven by a Pose3d[] of robot-relative poses. Attach it to a robot object.",
  trajectory: "Joins every pose of the array into a path floating just above the carpet.",
  vision: "Marks each target and draws the line back to the camera it was seen from.",
  gamePiece: "Places one of the field's game piece models wherever the topic says — a note in flight, what the robot is holding.",
  cone: "A plain cone marker for any point of interest that is not a game piece.",
  axes: "X/Y/Z triad at the pose. The fastest way to find out why an orientation looks wrong.",
}

// Los SVG de public/icons se eligen por SIGNIFICADO. Varios ya existen para el
// visualizador 2D y el Mechanism 3D; para los que todavía no hay archivo se
// pide el nombre definitivo y SidebarIcon cae solo al hermano y después al
// glifo tabler, así que la fila nunca queda con un cuadrito roto.
export interface Field3dIcon {
  svg: string
  svgFallback?: string
  fallback: string
}

export const FIELD3D_OBJECT_ICONS: Record<Field3dObjectType, Field3dIcon> = {
  robot: { svg: "robot.svg", fallback: "ti-robot" },
  ghost: { svg: "ghost.svg", svgFallback: "part-shape.svg", fallback: "ti-ghost-2" },
  component: { svg: "part.svg", svgFallback: "joint.svg", fallback: "ti-hierarchy-2" },
  trajectory: { svg: "trajectory.svg", svgFallback: "sweep.svg", fallback: "ti-route" },
  vision: { svg: "vision.svg", svgFallback: "target.svg", fallback: "ti-eye" },
  gamePiece: { svg: "game-piece.svg", svgFallback: "part-mesh.svg", fallback: "ti-ball-basketball" },
  cone: { svg: "marker.svg", svgFallback: "placement.svg", fallback: "ti-map-pin" },
  axes: { svg: "axes.svg", svgFallback: "joint-pose.svg", fallback: "ti-axis-x" },
}

/** Estos se dibujan colgados de un objeto `robot`, no en su propia pose. */
export function needsAnchor(type: Field3dObjectType): boolean {
  return type === "component" || type === "vision"
}

export function resolveField3dOptions(
  obj: Field3dObjectConfig,
  settings: Field3dSettings,
): ResolvedField3dOptions {
  const isGhost = obj.type === "ghost"
  return {
    hidden: obj.hidden === true,
    // El fantasma nace translúcido: es lo que lo distingue del robot de
    // verdad, y tener que bajarle la opacidad a mano cada vez sería absurdo.
    opacity: clamp(obj.opacity ?? (isGhost ? 0.45 : 1), 0.05, 1),
    showLabel: obj.showLabel ?? false,
    // El interruptor general apaga las estelas de todos; con él prendido cada
    // objeto puede fijar la suya o heredar la de la pestaña.
    trailSeconds: settings.showTrails ? (obj.trailSeconds ?? settings.trailSeconds) : 0,
    arrayFormat: obj.arrayFormat ?? "auto",
    robotAssetKey: obj.robotAssetKey ?? settings.robotAssetKey,
    useModel: obj.useModel ?? true,
    anchorId: obj.anchorId ?? null,
    trajectoryStyle: obj.trajectoryStyle ?? "tube",
    trajectoryWidth: positive(obj.trajectoryWidth, 0.05),
    showWaypoints: obj.showWaypoints ?? false,
    trajectoryHeight: positive(obj.trajectoryHeight, 0.02),
    // -1 = desde el centro del robot, que es lo correcto mientras el asset no
    // declare ninguna cámara.
    visionCameraIndex: Number.isInteger(obj.visionCameraIndex) ? obj.visionCameraIndex! : -1,
    gamePieceIndex: Math.max(0, Math.trunc(obj.gamePieceIndex ?? 0)),
    markerSize: positive(obj.markerSize, 0.25),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!isFinite(value)) return max
  return Math.min(max, Math.max(min, value))
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && isFinite(value) && value > 0 ? value : fallback
}

// --- Arrastre ---------------------------------------------------------------

/** Todo lo que la página sabe recibir. */
export function isField3dDroppable(topicType: string): boolean {
  return isPose3dTopic(topicType)
}

/**
 * Qué tipo de objeto conviene crear al soltar un topic.
 *
 * El nombre manda por encima de la forma: un `Targets` que trae tres poses no
 * es una trayectoria, y un `Components` que trae cuatro tampoco.
 */
export function defaultField3dTypeFor(topicName: string, topicType: string): Field3dObjectType {
  const leaf = topicName.split("/").filter(Boolean).pop()?.toLowerCase() ?? ""

  if (leaf.includes("component") || leaf.includes("mechanism") || leaf.includes("arm")) return "component"
  if (leaf.includes("vision") || leaf.includes("tag") || leaf.includes("target")) return "vision"
  if (leaf.includes("note") || leaf.includes("piece") || leaf.includes("ball") || leaf.includes("coral")) return "gamePiece"
  if (leaf.includes("trajectory") || leaf.includes("path")) return "trajectory"
  if (leaf.includes("setpoint") || leaf.includes("desired") || leaf.includes("goal") || leaf.includes("ghost")) return "ghost"
  return topicType.endsWith("[]") ? "trajectory" : "robot"
}

/**
 * Nombre para un objeto nuevo, numerando las repeticiones del mismo topic.
 *
 * El mismo topic se puede soltar TANTAS VECES como haga falta: verlo a la vez
 * como robot y como estela, o como pieza de juego y como marcador, no debería
 * obligar a publicarlo dos veces desde el robot. Misma regla que en el 2D.
 */
export function nextField3dLabel(
  objects: { topicName: string }[],
  topicName: string,
  base?: string,
): string {
  const leaf = base ?? topicName.split("/").filter(Boolean).pop() ?? topicName
  const dupes = objects.filter(o => o.topicName === topicName).length
  return dupes === 0 ? leaf : `${leaf} (${dupes + 1})`
}

// --- Persistencia -----------------------------------------------------------

// Un layout guardado por una versión anterior no trae los campos nuevos, y uno
// editado a mano puede traer basura. El renderer usa estos números como
// geometría: un NaN en el grosor de una trayectoria la deja invisible sin
// ningún error a la vista, así que todo entra por acá.

const OBJECT_TYPES = new Set<string>(FIELD3D_OBJECT_TYPES)
const ARRAY_FORMATS = new Set<string>(["auto", "pose2d", "pose3d"])
const TRAJECTORY_STYLES = new Set<string>(["tube", "line", "points"])
const CAMERA_MODES = new Set<string>(["orbit", "orbitRobot", "driverStation", "robotCamera"])
const QUALITIES = new Set<string>(["cinematic", "standard", "lowPower"])
const ORIGINS = new Set<string>(["auto", "blue", "red"])
const SYSTEMS = new Set<string>(COORDINATE_SYSTEMS)

export function normalizeField3dObjects(raw: unknown): Field3dObjectConfig[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(o => o && typeof o.id === "string" && typeof o.topicName === "string")
    .map((o: any): Field3dObjectConfig => ({
      id: o.id,
      topicName: o.topicName,
      topicType: typeof o.topicType === "string" ? o.topicType : "",
      label: typeof o.label === "string" && o.label.length > 0 ? o.label : o.topicName,
      // Un tipo desconocido (de una versión más nueva, o inventado a mano) cae
      // al robot en vez de dejar el objeto sin dibujar.
      type: OBJECT_TYPES.has(o.type) ? o.type : "robot",
      color: typeof o.color === "string" ? o.color : "#2f6fdb",

      hidden: o.hidden === true ? true : undefined,
      opacity: finite(o.opacity),
      showLabel: bool(o.showLabel),
      trailSeconds: finite(o.trailSeconds),
      arrayFormat: ARRAY_FORMATS.has(o.arrayFormat) ? o.arrayFormat : undefined,
      robotAssetKey: typeof o.robotAssetKey === "string" ? o.robotAssetKey : undefined,
      useModel: bool(o.useModel),
      anchorId: typeof o.anchorId === "string" ? o.anchorId : undefined,
      trajectoryStyle: TRAJECTORY_STYLES.has(o.trajectoryStyle) ? o.trajectoryStyle : undefined,
      trajectoryWidth: finite(o.trajectoryWidth),
      showWaypoints: bool(o.showWaypoints),
      trajectoryHeight: finite(o.trajectoryHeight),
      visionCameraIndex: finite(o.visionCameraIndex),
      gamePieceIndex: finite(o.gamePieceIndex),
      markerSize: finite(o.markerSize),
    }))
}

export function normalizeField3dSettings(raw: unknown): Field3dSettings {
  const merged = { ...defaultField3dSettings, ...(raw as Partial<Field3dSettings> | undefined) }
  const source = (raw ?? {}) as Record<string, unknown>

  return {
    ...merged,
    fieldKey: typeof merged.fieldKey === "string" && merged.fieldKey.length > 0
      ? merged.fieldKey : EVERGREEN_FIELD_KEY,
    robotAssetKey: typeof merged.robotAssetKey === "string" ? merged.robotAssetKey : null,
    coordinateSystem: SYSTEMS.has(merged.coordinateSystem as string)
      ? merged.coordinateSystem as Field3dCoordinateSystem : null,
    origin: (ORIGINS.has(merged.origin) ? merged.origin : "auto") as Field3dOrigin,
    alliance: merged.alliance === "red" ? "red" : "blue",
    allianceFromFMS: merged.allianceFromFMS !== false,

    cameraMode: (CAMERA_MODES.has(merged.cameraMode) ? merged.cameraMode : "orbit") as Field3dCameraMode,
    // Seis driver stations en FRC; el índice se acota para que un layout de
    // FTC (cuatro) no deje la cámara mirando a la nada.
    driverStationIndex: index(source.driverStationIndex, 1, 5),
    robotCameraIndex: index(source.robotCameraIndex, 0, 15),
    fov: number(source.fov, defaultField3dSettings.fov, 20, 110),

    quality: (QUALITIES.has(merged.quality) ? merged.quality : "standard") as Field3dQuality,
    gridCell: number(source.gridCell, defaultField3dSettings.gridCell, 0.1, 5),
    trailSeconds: number(source.trailSeconds, defaultField3dSettings.trailSeconds, 0, 120),

    robotLength: number(source.robotLength, defaultField3dSettings.robotLength, 0.1, 3),
    robotWidth: number(source.robotWidth, defaultField3dSettings.robotWidth, 0.1, 3),
    robotHeight: number(source.robotHeight, defaultField3dSettings.robotHeight, 0.05, 3),
  }
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && isFinite(value) ? value : undefined
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function index(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.trunc(value)))
}
