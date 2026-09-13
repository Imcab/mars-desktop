// Marcos de coordenadas del Field 3D.
//
// Hay DOS marcos en juego y confundirlos es la fuente número uno de robots que
// aparecen fuera de la cancha o girados media vuelta:
//
//  1. El marco en que PUBLICA el robot. Lo elige WPILib y cambió con las
//     temporadas: hasta 2026 el origen está en la esquina de la alianza azul
//     ("wall-blue"), y desde 2027 pasa al centro de la cancha ("center-red").
//
//  2. El marco del MODELO de la cancha, que es el único que entiende la
//     escena: origen en el CENTRO del área de juego, +X hacia la alianza roja,
//     +Y hacia la izquierda vista desde el azul, +Z arriba.
//
// El marco 2 es el mismo que usa AdvantageScope y el mismo en el que vienen
// las posiciones de los AprilTags y de las driver stations dentro del
// config.json de cada cancha, así que respetarlo permite usar sus assets tal
// cual salen del .zip, sin recalcular nada.

/** Los cuatro sistemas que declara el config.json de una cancha 3D. */
export type Field3dCoordinateSystem =
  | "wall-blue"       // origen en la esquina azul, +X hacia el rojo (WPILib <= 2026)
  | "wall-alliance"   // igual, pero el origen salta a la pared de TU alianza
  | "center-red"      // origen al centro, +X hacia el rojo (WPILib 2027+)
  | "center-rotated"  // FTC: origen al centro, girado 90 grados

export const COORDINATE_SYSTEM_LABELS: Record<Field3dCoordinateSystem, string> = {
  "wall-blue": "Wall / blue corner (WPILib ≤2026)",
  "wall-alliance": "Wall / own alliance",
  "center-red": "Center, +X to red (WPILib 2027+)",
  "center-rotated": "Center rotated (FTC)",
}

export const COORDINATE_SYSTEMS: Field3dCoordinateSystem[] = [
  "wall-blue", "wall-alliance", "center-red", "center-rotated",
]

export type Alliance = "blue" | "red"

/**
 * Pose completa en 3D: traslación en metros y rotación como CUATERNIÓN.
 *
 * Se guarda el cuaternión crudo y no ángulos de Euler porque es exactamente lo
 * que serializa `Pose3d` de WPILib: convertir a roll/pitch/yaw para volver a
 * componerlo introduce gimbal lock en poses perfectamente válidas (un brazo
 * apuntando recto hacia arriba, por ejemplo).
 */
export interface Pose3D {
  x: number
  y: number
  z: number
  qw: number
  qx: number
  qy: number
  qz: number
}

export const IDENTITY_POSE: Pose3D = { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 }

// --- Cuaterniones -------------------------------------------------------------

export type Quat = [number, number, number, number] // [w, x, y, z]

/** Giro puro alrededor de +Z, que es como se levanta una Pose2d a 3D. */
export function quatFromYaw(yaw: number): Quat {
  return [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]
}

/** `a` aplicada DESPUÉS de `b` (composición de rotaciones, no conmuta). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a
  const [bw, bx, by, bz] = b
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ]
}

/** Yaw (giro en el plano de la cancha) de un cuaternión. */
export function yawOf(q: Quat): number {
  const [w, x, y, z] = q
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

/**
 * Un cuaternión que llega con norma cero (campos vacíos, struct a medio
 * llenar) dejaría la matriz de la malla degenerada y la pieza invisible sin
 * ningún error a la vista, así que se cae a la identidad.
 */
export function normalizeQuat(q: Quat): Quat {
  const norm = Math.hypot(q[0], q[1], q[2], q[3])
  if (!isFinite(norm) || norm < 1e-9) return [1, 0, 0, 0]
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm]
}

// --- Conversión al marco del modelo -------------------------------------------

/** Largo (eje X, lado largo) y ancho (eje Y) del área de juego, en metros. */
export interface FieldSize {
  length: number
  width: number
}

/**
 * Rotación y traslación que lleva del marco publicado al marco del modelo.
 *
 * Se devuelve el par en vez de aplicarlo de una porque la escena convierte
 * CIENTOS de poses por frame (una trayectoria larga, un array de game pieces):
 * calcular el marco una sola vez y reusarlo evita rehacer la misma
 * trigonometría en cada punto.
 */
export interface FrameTransform {
  /** Rotación del marco publicado respecto del marco del modelo. */
  rotation: Quat
  /** Traslación, ya en el marco del modelo. */
  offset: [number, number, number]
}

export function frameTransform(
  system: Field3dCoordinateSystem,
  size: FieldSize,
  alliance: Alliance,
): FrameTransform {
  const halfLength = size.length / 2
  const halfWidth = size.width / 2

  switch (system) {
    // El origen está en la esquina azul y los ejes ya apuntan como el modelo:
    // solo hay que correr el origen al centro.
    case "wall-blue":
      return { rotation: [1, 0, 0, 0], offset: [-halfLength, -halfWidth, 0] }

    // El origen salta a la pared de la alianza propia. Para el azul es
    // idéntico al caso anterior; para el rojo la cancha entera está vista
    // desde el otro extremo, que es media vuelta alrededor del centro.
    case "wall-alliance":
      return alliance === "red"
        ? { rotation: quatFromYaw(Math.PI), offset: [halfLength, halfWidth, 0] }
        : { rotation: [1, 0, 0, 0], offset: [-halfLength, -halfWidth, 0] }

    // Ya es el marco del modelo.
    case "center-red":
      return { rotation: [1, 0, 0, 0], offset: [0, 0, 0] }

    // FTC publica con +X hacia la audiencia y +Y hacia el rojo: un cuarto de
    // vuelta respecto del marco del modelo.
    case "center-rotated":
      return { rotation: quatFromYaw(-Math.PI / 2), offset: [0, 0, 0] }
  }
}

/**
 * Gira un vector por un cuaternión.
 *
 * Se hace a mano en vez de instanciar un `Vector3` y un `Quaternion` de three:
 * esto corre por cada punto de cada trayectoria en cada frame, y la basura que
 * generarían esos objetos se nota en el recolector.
 */
export function rotateVector(q: Quat, v: [number, number, number]): [number, number, number] {
  const [w, x, y, z] = q
  const [vx, vy, vz] = v

  // v' = v + 2w(u x v) + 2u x (u x v), con u = (x, y, z).
  const cx = y * vz - z * vy
  const cy = z * vx - x * vz
  const cz = x * vy - y * vx

  return [
    vx + 2 * (w * cx + y * cz - z * cy),
    vy + 2 * (w * cy + z * cx - x * cz),
    vz + 2 * (w * cz + x * cy - y * cx),
  ]
}

/** Aplica un `FrameTransform` a una pose publicada. */
export function toFieldFrame(pose: Pose3D, transform: FrameTransform): Pose3D {
  const [rx, ry, rz] = rotateVector(transform.rotation, [pose.x, pose.y, pose.z])
  const rotated = quatMultiply(transform.rotation, [pose.qw, pose.qx, pose.qy, pose.qz])

  return {
    x: rx + transform.offset[0],
    y: ry + transform.offset[1],
    z: rz + transform.offset[2],
    qw: rotated[0], qx: rotated[1], qy: rotated[2], qz: rotated[3],
  }
}

/**
 * Inversa de `toFieldFrame`: del marco del modelo de vuelta al que publica el
 * robot. La usa la lectura de coordenadas bajo el puntero, que tiene que
 * mostrar los mismos números que se verían en el código del robot.
 */
export function fromFieldFrame(pose: Pose3D, transform: FrameTransform): Pose3D {
  const [w, x, y, z] = transform.rotation
  const inverse: Quat = [w, -x, -y, -z]

  const [rx, ry, rz] = rotateVector(inverse, [
    pose.x - transform.offset[0],
    pose.y - transform.offset[1],
    pose.z - transform.offset[2],
  ])
  const rotated = quatMultiply(inverse, [pose.qw, pose.qx, pose.qy, pose.qz])

  return {
    x: rx, y: ry, z: rz,
    qw: rotated[0], qx: rotated[1], qy: rotated[2], qz: rotated[3],
  }
}

/**
 * Encadena dos poses: `child` expresada en el marco de `parent`, llevada al
 * marco en que está `parent`.
 *
 * Es la operación de `Pose3d.transformBy` de WPILib, y es lo que hace falta
 * para colocar un componente articulado (que el robot publica RELATIVO a sí
 * mismo) en la cancha, o para saber desde dónde mira una cámara montada en el
 * robot.
 */
export function composePose(parent: Pose3D, child: Pose3D): Pose3D {
  const parentQuat: Quat = [parent.qw, parent.qx, parent.qy, parent.qz]
  const [dx, dy, dz] = rotateVector(parentQuat, [child.x, child.y, child.z])
  const q = quatMultiply(parentQuat, [child.qw, child.qx, child.qy, child.qz])

  return {
    x: parent.x + dx,
    y: parent.y + dy,
    z: parent.z + dz,
    qw: q[0], qx: q[1], qy: q[2], qz: q[3],
  }
}
