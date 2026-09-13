// Registro de canchas con imagen, en el formato JSON que usan Elastic y
// AdvantageScope.
//
// Un JSON de cancha describe DÓNDE está el área de juego dentro de la imagen:
//
//   {
//     "game": "Rebuilt",
//     "field_image": "assets/fields/frc/2026-field.png",
//     "coordinate_system": "wall_blue",
//     "field_corners": { "top_left": [524, 94], "bottom_right": [3378, 1490] },
//     "field_size": [16.535, 8.069]
//   }
//
// Las esquinas son PÍXELES de la imagen y field_size son METROS, así que de
// ahí sale la escala px/m. Sin eso no se puede dibujar una pose encima de la
// foto: la imagen trae paredes y estaciones de conductor fuera del área de
// juego, y su borde no coincide con el (0,0) de la cancha.

// Para agregar una cancha alcanza con dejar el .json y el .png en
// public/fields/ — el glob los recoge en el build sin tocar código.
const FIELD_JSON_MODULES = import.meta.glob("../../../public/fields/*.json", { eager: true }) as Record<
  string,
  { default: any }
>

// Los tres sistemas que define Elastic. El JSON de cada cancha dice cuál usa,
// pero se puede sobreescribir desde la UI: si el robot publica en otro marco
// la pose aparece espejada o girada, y es más rápido cambiar el selector que
// editar el JSON.
export type CoordinateSystem = "wall_blue" | "center" | "center_rotated"

export const COORDINATE_SYSTEM_LABELS: Record<CoordinateSystem, string> = {
  wall_blue: "Wall / Blue corner (WPILib ≤2026)",
  center: "Center (WPILib 2027+)",
  center_rotated: "Center rotated (FTC)",
}

export interface FieldConfig {
  /** Nombre del archivo sin extensión; es lo que se guarda en los settings. */
  key: string
  game: string
  program: string
  sourceUrl: string | null
  /** URL servible de la imagen (los archivos de public/ salen en la raíz). */
  imageUrl: string
  coordinateSystem: CoordinateSystem
  /** Esquinas del área de juego, en píxeles de la imagen. */
  topLeft: [number, number]
  bottomRight: [number, number]
  /** Largo y ancho del área de juego, en metros. */
  sizeMeters: [number, number]
}

// Elastic escribe las claves con guion bajo y AdvantageScope/WPILib con guion
// medio. Se aceptan las dos para que un JSON bajado de cualquiera de los dos
// funcione sin editarlo.
function pick(source: any, ...keys: string[]): any {
  for (const key of keys) {
    if (source && source[key] !== undefined) return source[key]
  }
  return undefined
}

function parseCoordinateSystem(value: unknown): CoordinateSystem {
  if (value === "wall_blue" || value === "wall-blue") return "wall_blue"
  if (value === "center_rotated" || value === "center-rotated") return "center_rotated"
  if (value === "center") return "center"
  // Sin dato explícito se asume el sistema clásico de WPILib, que es el que
  // publica todo el código de robot escrito antes de 2027.
  return "wall_blue"
}

function parseField(path: string, raw: any): FieldConfig | null {
  const key = path.split("/").pop()!.replace(/\.json$/, "")

  const corners = pick(raw, "field_corners", "field-corners")
  const topLeft = pick(corners, "top_left", "top-left")
  const bottomRight = pick(corners, "bottom_right", "bottom-right")
  const size = pick(raw, "field_size", "field-size")
  const image = pick(raw, "field_image", "field-image")

  if (!Array.isArray(topLeft) || !Array.isArray(bottomRight) || !Array.isArray(size) || typeof image !== "string") {
    return null
  }
  if (size[0] <= 0 || size[1] <= 0) return null

  // El JSON trae la ruta interna de Elastic ("assets/fields/frc/2026-field.png");
  // acá solo interesa el nombre del archivo, que vive junto al .json.
  const imageFile = image.split("/").pop()!

  return {
    key,
    game: pick(raw, "game") ?? key,
    program: pick(raw, "program") ?? "FRC",
    sourceUrl: pick(raw, "source_url", "source-url") ?? null,
    imageUrl: `/fields/${imageFile}`,
    coordinateSystem: parseCoordinateSystem(pick(raw, "coordinate_system", "coordinate-system")),
    topLeft: [topLeft[0], topLeft[1]],
    bottomRight: [bottomRight[0], bottomRight[1]],
    sizeMeters: [size[0], size[1]],
  }
}

export const FIELDS: FieldConfig[] = Object.entries(FIELD_JSON_MODULES)
  .map(([path, mod]) => parseField(path, mod.default))
  .filter((f): f is FieldConfig => f !== null)
  .sort((a, b) => a.game.localeCompare(b.game))

/** Clave reservada para el dibujo esquemático (sin imagen) que ya existía. */
export const SCHEMATIC_FIELD_KEY = "schematic"

export function getField(key: string): FieldConfig | null {
  return FIELDS.find(f => f.key === key) ?? null
}

// --- Conversión de coordenadas ---------------------------------------------

// Todo se lleva a un marco INTERNO común: origen en el centro del área de
// juego, +X hacia la derecha de la imagen y +Y hacia arriba. El renderer solo
// entiende ese marco; cada sistema de coordenadas es una entrada distinta.
export interface InternalPose {
  x: number
  y: number
  theta: number // radianes
}

export function toInternal(
  system: CoordinateSystem,
  x: number,
  y: number,
  theta: number,
  sizeMeters: [number, number],
): InternalPose {
  switch (system) {
    // Origen en la esquina de la alianza azul, +X hacia el rojo. En la imagen
    // el azul queda a la DERECHA, así que +X del robot va hacia la izquierda
    // de la pantalla: por eso la resta y el giro de media vuelta.
    case "wall_blue":
      return {
        x: sizeMeters[0] / 2 - x,
        y: sizeMeters[1] / 2 - y,
        theta: theta + Math.PI,
      }

    // FTC: origen al centro, +X hacia abajo de la imagen y +Y hacia la derecha.
    case "center_rotated":
      return { x: y, y: -x, theta: theta - Math.PI / 2 }

    // WPILib 2027+: ya es el marco interno.
    case "center":
      return { x, y, theta }
  }
}

/**
 * Inversa de `toInternal`: del marco interno de vuelta al que publica el
 * robot. La usa la lectura de coordenadas bajo el puntero, que tiene que
 * mostrar los mismos números que vería uno en el código del robot.
 */
export function fromInternal(
  system: CoordinateSystem,
  x: number,
  y: number,
  theta: number,
  sizeMeters: [number, number],
): InternalPose {
  switch (system) {
    case "wall_blue":
      return {
        x: sizeMeters[0] / 2 - x,
        y: sizeMeters[1] / 2 - y,
        theta: theta - Math.PI,
      }
    case "center_rotated":
      return { x: -y, y: x, theta: theta + Math.PI / 2 }
    case "center":
      return { x, y, theta }
  }
}

/**
 * Media vuelta alrededor del centro de la cancha.
 *
 * Es lo que hace el botón de alianza: el driver de la alianza roja ve la
 * cancha desde el otro extremo, y comparar su vista con la del piloto azul
 * girando la cabeza no es viable en medio de un match.
 */
export function flipInternal(pose: InternalPose): InternalPose {
  return { x: -pose.x, y: -pose.y, theta: pose.theta + Math.PI }
}
