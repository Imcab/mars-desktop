// Lectura del `config.json` de un asset 3D, en el formato de AdvantageScope.
//
// Un asset es una carpeta con un `config.json` y uno o varios `model*.glb`.
// Hay dos clases y se distinguen por lo que declara el propio config, no por
// el nombre de la carpeta:
//
//   Cancha  ->  trae widthInches/heightInches (el área de juego)
//   Robot   ->  no las trae; trae components/cameras
//
// Se acepta el formato TAL CUAL lo publica AdvantageScope para que los .zip
// oficiales (github.com/Mechanical-Advantage/AdvantageScopeAssets) se
// instalen sin editar nada, y para que un equipo que ya arma sus assets no
// tenga que mantener dos versiones.
//
// Todo campo ausente cae a un default razonable en vez de invalidar el
// paquete: un config escrito a mano al que le falta `defaultOrigin` sigue
// siendo perfectamente usable.

import { Field3dCoordinateSystem, FieldSize, Quat, quatMultiply } from "./frames"

/** Giro alrededor de un eje del mundo, en grados. Se aplican EN ORDEN. */
export interface AxisRotation {
  axis: "x" | "y" | "z"
  degrees: number
}

export type OriginPreference = "auto" | "blue" | "red"

export interface GamePieceConfig {
  name: string
  rotations: AxisRotation[]
  position: [number, number, number]
  /**
   * Nombres de los nodos del modelo de la cancha que representan a ESTA pieza
   * ya colocada en su lugar de partida. Cuando el robot publica el topic de la
   * pieza se ocultan: si no, cada pieza aparecería dos veces, la de verdad y
   * la que trae pintada el modelo de la cancha.
   */
  stagedObjects: string[]
}

export interface AprilTagConfig {
  /** Familia y tamaño, p. ej. "36h11-6.5in". */
  variant: string
  id: number
  rotations: AxisRotation[]
  position: [number, number, number]
}

export interface FieldAssetConfig {
  kind: "field"
  name: string
  isFTC: boolean
  coordinateSystem: Field3dCoordinateSystem
  /** Giros que llevan el modelo del archivo al marco Z-arriba de la escena. */
  rotations: AxisRotation[]
  /** Área de juego en metros; sale de widthInches/heightInches. */
  size: FieldSize
  defaultOrigin: OriginPreference
  /** Posiciones de las driver stations en el marco del modelo (6 en FRC). */
  driverStations: [number, number][]
  gamePieces: GamePieceConfig[]
  aprilTags: AprilTagConfig[]
}

export interface RobotCameraConfig {
  name: string
  rotations: AxisRotation[]
  /** Posición relativa al centro del robot, en metros. */
  position: [number, number, number]
  resolution: [number, number]
  /** Campo de visión HORIZONTAL en grados. */
  fov: number
}

export interface RobotComponentConfig {
  /** Pose del componente cuando su Pose3d publicada es la identidad. */
  zeroedRotations: AxisRotation[]
  zeroedPosition: [number, number, number]
}

export interface RobotAssetConfig {
  kind: "robot"
  name: string
  isFTC: boolean
  rotations: AxisRotation[]
  position: [number, number, number]
  cameras: RobotCameraConfig[]
  components: RobotComponentConfig[]
}

export type AssetConfig = FieldAssetConfig | RobotAssetConfig

const INCH = 0.0254

// --- Lectores tolerantes -----------------------------------------------------

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? value : fallback
}

function vec3(value: unknown, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (!Array.isArray(value)) return fallback
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
}

function parseRotations(value: unknown): AxisRotation[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry: any): AxisRotation | null => {
      const axis = entry?.axis
      if (axis !== "x" && axis !== "y" && axis !== "z") return null
      return { axis, degrees: num(entry?.degrees, 0) }
    })
    .filter((r): r is AxisRotation => r !== null)
}

function parseCoordinateSystem(value: unknown): Field3dCoordinateSystem {
  switch (value) {
    case "wall-alliance": return "wall-alliance"
    case "center-red": return "center-red"
    case "center-rotated": return "center-rotated"
    // Sin dato explícito se asume el sistema clásico de WPILib, que es el que
    // publica todo el código de robot escrito antes de 2027.
    default: return "wall-blue"
  }
}

function parseOrigin(value: unknown): OriginPreference {
  return value === "blue" || value === "red" ? value : "auto"
}

// --- Parseo ------------------------------------------------------------------

/**
 * Convierte el texto de un `config.json` en un asset tipado.
 *
 * Devuelve `null` en vez de lanzar cuando el JSON no se puede leer o no
 * declara ni un nombre: el panel de assets lista carpetas que puede haber
 * dejado cualquiera, y una sola rota no debe tumbar la lista entera.
 */
export function parseAssetConfig(text: string): AssetConfig | null {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null

  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : null
  if (name === null) return null

  const isFTC = raw.isFTC === true
  const rotations = parseRotations(raw.rotations)

  // Es una cancha si declara el área de juego. Un asset de robot no la trae,
  // y es la única diferencia estructural entre los dos formatos.
  const hasSize = typeof raw.widthInches === "number" && typeof raw.heightInches === "number"

  if (hasSize) {
    return {
      kind: "field",
      name,
      isFTC,
      coordinateSystem: parseCoordinateSystem(raw.coordinateSystem),
      rotations,
      size: {
        length: num(raw.widthInches, 0) * INCH,
        width: num(raw.heightInches, 0) * INCH,
      },
      defaultOrigin: parseOrigin(raw.defaultOrigin),
      driverStations: Array.isArray(raw.driverStations)
        ? raw.driverStations
            .filter((d: any) => Array.isArray(d) && d.length >= 2)
            .map((d: any): [number, number] => [num(d[0], 0), num(d[1], 0)])
        : [],
      gamePieces: Array.isArray(raw.gamePieces)
        ? raw.gamePieces.map((piece: any, index: number): GamePieceConfig => ({
            name: typeof piece?.name === "string" ? piece.name : `Piece ${index + 1}`,
            rotations: parseRotations(piece?.rotations),
            position: vec3(piece?.position),
            stagedObjects: Array.isArray(piece?.stagedObjects)
              ? piece.stagedObjects.filter((s: any) => typeof s === "string")
              : [],
          }))
        : [],
      aprilTags: Array.isArray(raw.aprilTags)
        ? raw.aprilTags
            .filter((tag: any) => typeof tag?.id === "number")
            .map((tag: any): AprilTagConfig => ({
              variant: typeof tag.variant === "string" ? tag.variant : "36h11-6.5in",
              id: tag.id,
              rotations: parseRotations(tag.rotations),
              position: vec3(tag.position),
            }))
        : [],
    }
  }

  return {
    kind: "robot",
    name,
    isFTC,
    rotations,
    position: vec3(raw.position),
    cameras: Array.isArray(raw.cameras)
      ? raw.cameras.map((camera: any, index: number): RobotCameraConfig => ({
          name: typeof camera?.name === "string" ? camera.name : `Camera ${index + 1}`,
          rotations: parseRotations(camera?.rotations),
          position: vec3(camera?.position),
          resolution: [num(camera?.resolution?.[0], 960), num(camera?.resolution?.[1], 720)],
          fov: num(camera?.fov, 70),
        }))
      : [],
    components: Array.isArray(raw.components)
      ? raw.components.map((component: any): RobotComponentConfig => ({
          zeroedRotations: parseRotations(component?.zeroedRotations),
          zeroedPosition: vec3(component?.zeroedPosition),
        }))
      : [],
  }
}

// --- Rotaciones --------------------------------------------------------------

const DEG = Math.PI / 180

/**
 * Compone una lista de giros por eje en un solo cuaternión.
 *
 * Los giros son alrededor de los ejes del MUNDO y se aplican en el orden en
 * que vienen, que es lo que documenta AdvantageScope: por eso cada uno
 * premultiplica al acumulado en vez de posmultiplicar.
 *
 * El caso típico es `[{axis:"x", degrees:90}]`, que lleva un glTF (Y arriba
 * por convención del formato) al marco Z-arriba de WPILib que usa la escena.
 */
export function composeRotations(rotations: AxisRotation[]): Quat {
  let result: Quat = [1, 0, 0, 0]
  for (const rotation of rotations) {
    const half = (rotation.degrees * DEG) / 2
    const sin = Math.sin(half)
    const cos = Math.cos(half)
    const step: Quat =
      rotation.axis === "x" ? [cos, sin, 0, 0]
      : rotation.axis === "y" ? [cos, 0, sin, 0]
      : [cos, 0, 0, sin]
    result = quatMultiply(step, result)
  }
  return result
}

/** Tamaño legible de un paquete, para el panel de assets. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
