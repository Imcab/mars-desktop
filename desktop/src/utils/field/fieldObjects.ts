// Opciones por objeto del 2D Visualizer: defaults, saneo y heurísticas de
// arrastre.
//
// Cada campo de FieldObjectConfig más allá de los cinco originales es
// OPCIONAL: un layout guardado antes de que existiera no lo trae. En vez de
// repartir `?? default` por todo el renderer, todo pasa una sola vez por
// `resolveObjectOptions`, que devuelve la versión completa.

import {
  FieldObjectConfig, FieldObjectType, FieldSettings, FieldOrientation,
  ArrowAnchor, TrajectoryStyle, defaultFieldSettings,
} from "../../store/appStore"
import { isPoseTopic } from "./poseExtraction"
import { isModulesTopic } from "./swerveExtraction"

export interface ResolvedObjectOptions {
  hidden: boolean
  opacity: number
  showLabel: boolean
  trailSeconds: number
  /** null = usar el color del objeto. */
  trailColor: string | null
  useModel: boolean
  arrowAnchor: ArrowAnchor
  arrowLength: number
  trajectoryStyle: TrajectoryStyle
  trajectoryWidth: number
  showWaypoints: boolean
  showHeading: boolean
  heatmapRadius: number
  heatmapCell: number
  targetLines: boolean
  targetLabels: boolean
  swerveArrangement: string
  swerveMaxSpeed: number
}

export const FIELD_OBJECT_TYPES: FieldObjectType[] = [
  "robot", "ghost", "trajectory", "arrow", "heatmap", "target", "swerve",
]

export const FIELD_OBJECT_LABELS: Record<FieldObjectType, string> = {
  robot: "Robot",
  ghost: "Ghost",
  trajectory: "Trajectory",
  arrow: "Arrow",
  heatmap: "Heatmap",
  target: "Vision target",
  swerve: "Swerve modules",
}

export const FIELD_OBJECT_HELP: Record<FieldObjectType, string> = {
  robot: "Chassis with coloured bumpers and a heading arrow, or your CAD model seen from above.",
  ghost: "The same chassis drawn translucent — for a setpoint or a second pose estimate on top of the real one.",
  trajectory: "Joins every pose of the array into a path.",
  arrow: "Only the heading arrow, no chassis. Useful for a velocity vector or an aiming direction.",
  heatmap: "Accumulates every pose the object visits and shades the field by how long it spent there.",
  target: "Marks each pose and draws the line that joins it to the robot — vision targets, game pieces, aiming points.",
  swerve: "Draws the four module vectors on the robot. Takes a SwerveModuleState[] topic, not a pose.",
}

/**
 * Un objeto de este tipo se dibuja anclado al robot y no en su propia pose,
 * así que necesita que exista un objeto `robot` visible en la lista.
 */
export function needsRobotAnchor(type: FieldObjectType): boolean {
  return type === "swerve" || type === "target"
}

export function resolveObjectOptions(
  obj: FieldObjectConfig,
  settings: FieldSettings,
): ResolvedObjectOptions {
  const defaultTrail = settings.showTrails ? settings.trailSeconds : 0
  return {
    hidden: obj.hidden === true,
    opacity: clamp(obj.opacity ?? 1, 0.05, 1),
    showLabel: obj.showLabel ?? false,
    // El interruptor general apaga las estelas de todos; con él prendido cada
    // objeto puede fijar la suya o heredar la del panel.
    trailSeconds: settings.showTrails ? (obj.trailSeconds ?? defaultTrail) : 0,
    // La estela con color propio deja comparar dos poses del MISMO topic (el
    // chasis y su historial) sin que se confundan entre sí.
    trailColor: typeof obj.trailColor === "string" ? obj.trailColor : null,
    useModel: obj.useModel ?? settings.robotRender === "model",
    arrowAnchor: obj.arrowAnchor ?? "center",
    arrowLength: positive(obj.arrowLength, settings.robotSizeMeters),
    trajectoryStyle: obj.trajectoryStyle ?? "solid",
    trajectoryWidth: positive(obj.trajectoryWidth, 2.5),
    showWaypoints: obj.showWaypoints ?? false,
    showHeading: obj.showHeading ?? false,
    heatmapRadius: positive(obj.heatmapRadius, 0.6),
    heatmapCell: positive(obj.heatmapCell, 0.15),
    targetLines: obj.targetLines ?? true,
    targetLabels: obj.targetLabels ?? false,
    swerveArrangement: obj.swerveArrangement ?? "0,1,2,3",
    swerveMaxSpeed: positive(obj.swerveMaxSpeed, 4.5),
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

/** Todo lo que la página sabe recibir: geometría o estados de módulo. */
export function isFieldDroppable(topicType: string): boolean {
  return isPoseTopic(topicType) || isModulesTopic(topicType)
}

/**
 * Qué tipo de objeto conviene crear al soltar un topic.
 *
 * Un array de poses casi siempre es una trayectoria y una pose suelta el
 * robot; el nombre manda por encima de eso, porque un `Targets` que trae tres
 * poses no es un camino.
 */
export function defaultObjectTypeFor(topicName: string, topicType: string): FieldObjectType {
  const leaf = topicName.split("/").filter(Boolean).pop()?.toLowerCase() ?? ""

  if (!isPoseTopic(topicType) && isModulesTopic(topicType)) return "swerve"
  if (leaf.includes("target") || leaf.includes("vision") || leaf.includes("tag")) return "target"
  if (leaf.includes("trajectory") || leaf.includes("path")) return "trajectory"
  if (leaf.includes("setpoint") || leaf.includes("desired") || leaf.includes("goal")) return "ghost"
  return topicType.endsWith("[]") ? "trajectory" : "robot"
}

// --- Persistencia -----------------------------------------------------------

// Un layout guardado por una versión anterior no trae los campos nuevos, y uno
// editado a mano puede traer basura. El renderer dibuja estos números directo
// como geometría: un NaN en el largo del chasis deja la cancha en blanco sin
// ningún error visible, así que todo entra por acá.

const OBJECT_TYPES = new Set<string>(FIELD_OBJECT_TYPES)

export function normalizeFieldObjects(raw: unknown): FieldObjectConfig[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter(o => o && typeof o.id === "string" && typeof o.topicName === "string")
    .map((o: any): FieldObjectConfig => ({
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
      trailColor: typeof o.trailColor === "string" ? o.trailColor : undefined,
      useModel: bool(o.useModel),
      arrowAnchor: o.arrowAnchor === "front" || o.arrowAnchor === "back" || o.arrowAnchor === "center"
        ? o.arrowAnchor : undefined,
      arrowLength: finite(o.arrowLength),
      trajectoryStyle: ["solid", "dashed", "points", "gradient"].includes(o.trajectoryStyle)
        ? o.trajectoryStyle : undefined,
      trajectoryWidth: finite(o.trajectoryWidth),
      showWaypoints: bool(o.showWaypoints),
      showHeading: bool(o.showHeading),
      heatmapRadius: finite(o.heatmapRadius),
      heatmapCell: finite(o.heatmapCell),
      targetLines: bool(o.targetLines),
      targetLabels: bool(o.targetLabels),
      swerveArrangement: typeof o.swerveArrangement === "string" ? o.swerveArrangement : undefined,
      swerveMaxSpeed: finite(o.swerveMaxSpeed),
    }))
}

export function normalizeFieldSettings(raw: unknown): FieldSettings {
  const merged = { ...defaultFieldSettings, ...(raw as Partial<FieldSettings> | undefined) }
  const source = (raw ?? {}) as Record<string, unknown>

  const length = number(source.robotSizeMeters, defaultFieldSettings.robotSizeMeters, 0.05, 3)

  return {
    ...merged,
    orientation: ([0, 90, 180, 270].includes(merged.orientation) ? merged.orientation : 0) as FieldOrientation,
    robotSizeMeters: length,
    // Los layouts anteriores solo tenían un lado: el chasis era cuadrado, así
    // que el ancho hereda el largo y nadie ve un cambio al actualizar.
    robotWidthMeters: number(source.robotWidthMeters, length, 0.05, 3),
    gridSpacing: number(source.gridSpacing, defaultFieldSettings.gridSpacing, 0.1, 5),
    trailSeconds: number(source.trailSeconds, defaultFieldSettings.trailSeconds, 0, 120),
    robotRender: merged.robotRender === "model" ? "model" : "icon",
    robotModelPath: typeof merged.robotModelPath === "string" ? merged.robotModelPath : null,
    robotModelName: typeof merged.robotModelName === "string" ? merged.robotModelName : null,
    robotModelScale: number(source.robotModelScale, defaultFieldSettings.robotModelScale, 1e-6, 1000),
    robotModelRotation: number(source.robotModelRotation, 0, -360, 360),
    robotModelColor: typeof merged.robotModelColor === "string" ? merged.robotModelColor : null,
    coordinateSystem: merged.coordinateSystem ?? null,
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

// --- Iconos -----------------------------------------------------------------

// Los SVG de public/icons son a color, así que se eligen por SIGNIFICADO y no
// por tinte. Varios ya existen para el Mechanism 3D y el Swerve, que tienen
// paneles de la misma forma que este; para los que todavía no hay archivo se
// pide el nombre definitivo y SidebarIcon cae solo al hermano y después al
// glifo tabler, así que la fila nunca queda con un cuadrito roto.
export interface FieldIcon {
  svg: string
  svgFallback?: string
  fallback: string
}

export const FIELD_OBJECT_ICONS: Record<FieldObjectType, FieldIcon> = {
  robot: { svg: "robot.svg", svgFallback: "part.svg", fallback: "ti-robot" },
  ghost: { svg: "ghost.svg", svgFallback: "part-shape.svg", fallback: "ti-ghost-2" },
  trajectory: { svg: "trajectory.svg", svgFallback: "sweep.svg", fallback: "ti-route" },
  arrow: { svg: "arrow.svg", svgFallback: "joint-prismatic.svg", fallback: "ti-arrow-narrow-right" },
  heatmap: { svg: "heatmap.svg", fallback: "ti-flame" },
  target: { svg: "target.svg", svgFallback: "joint-pose.svg", fallback: "ti-target" },
  // Este sí existe: es el mismo del visualizador de swerve.
  swerve: { svg: "swerve.svg", fallback: "ti-steering-wheel" },
}

// --- Etiquetas --------------------------------------------------------------

/**
 * Nombre para un objeto nuevo, numerando las repeticiones del mismo topic.
 *
 * El mismo topic se puede soltar TANTAS VECES como haga falta: publicar dos
 * veces la misma Pose2d desde el robot solo para verla como chasis y como
 * mapa de calor sería gastar ancho de banda en algo que se resuelve acá.
 * Es la misma regla que ya usa la página de Functions con sus series.
 */
export function nextObjectLabel(
  objects: { topicName: string }[],
  topicName: string,
  base?: string,
): string {
  const leaf = base ?? topicName.split("/").filter(Boolean).pop() ?? topicName
  const dupes = objects.filter(o => o.topicName === topicName).length
  return dupes === 0 ? leaf : `${leaf} (${dupes + 1})`
}
