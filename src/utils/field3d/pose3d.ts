// Extracción de poses 3D desde valores NT4.
//
// Reutiliza el decodificador de structs binarios de WPILib que ya usa la
// Dashboard (valueDecoding.ts) y lo levanta a la terna traslación +
// cuaternión que necesita la escena. Una Pose2d se levanta a 3D con z = 0 y
// un giro puro sobre +Z, que es exactamente lo que hace `Pose3d(Pose2d)` en
// WPILib.
//
// El decodificador genérico devuelve los campos marcados `isAngle` ya pasados
// a GRADOS (los widgets de la Dashboard los muestran así), por eso acá hay
// conversiones de vuelta a radianes: los ángulos internos de la escena son
// siempre radianes.

import { decodeStructBytes, decodeStructArrayBytes } from "../dashboard/valueDecoding"
import { getStructDef } from "../../store/structSchemaStore"
import { classifyTopic } from "../dashboard/topicClassification"
import { Pose3D, quatFromYaw, normalizeQuat } from "./frames"

const DEG_TO_RAD = Math.PI / 180

/**
 * Cómo interpretar un `double[]`.
 *
 * El formato heredado de `Field2d` empaqueta tripletas [x, y, θ°] y el de
 * AdvantageScope empaqueta septetos [x, y, z, qw, qx, qy, qz]. Un array de 21
 * números encaja en los dos, así que cuando la heurística no alcanza el objeto
 * puede fijarlo a mano.
 */
export type ArrayFormat = "auto" | "pose2d" | "pose3d"

/** Structs de los que se puede sacar una pose. */
const POSE_STRUCTS = new Set([
  "Pose3d", "Transform3d", "Translation3d",
  "Pose2d", "Transform2d", "Translation2d",
])

function isNumericArrayTopic(topicType: string): boolean {
  const c = classifyTopic(topicType)
  return c.isArrayType && !c.isStructType && ["double", "float", "int"].includes(c.baseType)
}

/** Un topic sirve para la cancha 3D si trae geometría, suelta o en array. */
export function isPose3dTopic(topicType: string): boolean {
  const c = classifyTopic(topicType)
  if (c.isStructType && c.structName) return POSE_STRUCTS.has(c.structName)
  return isNumericArrayTopic(topicType)
}

/** Cuántas poses trae un topic como máximo: 1 si es un struct suelto. */
export function isSinglePoseTopic(topicType: string): boolean {
  const c = classifyTopic(topicType)
  return !c.isArrayType
}

function structToPose(structName: string, fields: { value: number }[]): Pose3D | null {
  const v = (i: number) => fields[i]?.value ?? 0

  switch (structName) {
    // X, Y, Z, QW, QX, QY, QZ — el cuaternión sale crudo del struct.
    case "Pose3d":
    case "Transform3d": {
      const q = normalizeQuat([v(3), v(4), v(5), v(6)])
      return { x: v(0), y: v(1), z: v(2), qw: q[0], qx: q[1], qy: q[2], qz: q[3] }
    }
    case "Translation3d":
      return { x: v(0), y: v(1), z: v(2), qw: 1, qx: 0, qy: 0, qz: 0 }
    case "Pose2d":
    case "Transform2d": {
      const q = quatFromYaw(v(2) * DEG_TO_RAD)
      return { x: v(0), y: v(1), z: 0, qw: q[0], qx: q[1], qy: q[2], qz: q[3] }
    }
    case "Translation2d":
      return { x: v(0), y: v(1), z: 0, qw: 1, qx: 0, qy: 0, qz: 0 }
    default:
      return null
  }
}

/**
 * Decide si un `double[]` viene en tripletas o en septetos.
 *
 * Los múltiplos de 7 que NO son múltiplos de 3 solo pueden ser Pose3d y
 * viceversa. En el empate (0, 21, 42...) gana Pose2d, que es el formato viejo
 * y el único que publica el `Field2d` de WPILib sin que el equipo haga nada
 * especial: quien publica septetos suele estar usando structs igual.
 */
function guessArrayFormat(length: number): "pose2d" | "pose3d" {
  if (length % 7 === 0 && length % 3 !== 0) return "pose3d"
  return "pose2d"
}

function decodeNumberArray(arr: number[], format: ArrayFormat): Pose3D[] {
  const resolved = format === "auto" ? guessArrayFormat(arr.length) : format
  const out: Pose3D[] = []

  if (resolved === "pose3d") {
    for (let i = 0; i + 6 < arr.length; i += 7) {
      const q = normalizeQuat([arr[i + 3], arr[i + 4], arr[i + 5], arr[i + 6]])
      out.push({
        x: arr[i], y: arr[i + 1], z: arr[i + 2],
        qw: q[0], qx: q[1], qy: q[2], qz: q[3],
      })
    }
    return out
  }

  // Field2d publica [x, y, θ] por objeto, con θ en GRADOS.
  for (let i = 0; i + 2 < arr.length; i += 3) {
    const q = quatFromYaw(arr[i + 2] * DEG_TO_RAD)
    out.push({ x: arr[i], y: arr[i + 1], z: 0, qw: q[0], qx: q[1], qy: q[2], qz: q[3] })
  }
  return out
}

/**
 * TODAS las poses que contiene el valor: una para un struct suelto, N para un
 * `struct:X[]` o para un `double[]`.
 */
export function extractPoses3d(
  liveValue: any,
  topicType: string,
  format: ArrayFormat = "auto",
): Pose3D[] {
  if (!liveValue) return []
  const c = classifyTopic(topicType)

  if (c.isStructType && c.structName) {
    const def = getStructDef(c.structName)
    if (!def) return []
    const bytes: number[] | undefined = liveValue.Raw
    if (!bytes || bytes.length === 0) return []

    const instances = c.isArrayType
      ? decodeStructArrayBytes(bytes, def)
      : [decodeStructBytes(bytes, def)]

    return instances
      .map(fields => structToPose(c.structName!, fields))
      .filter((p): p is Pose3D => p !== null && isFinite(p.x) && isFinite(p.y) && isFinite(p.z))
  }

  if (isNumericArrayTopic(topicType)) {
    const arr: number[] | undefined = liveValue.NumberArray
    if (!arr) return []
    return decodeNumberArray(arr, format).filter(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z))
  }

  return []
}

/** La primera pose del valor, o null. Es lo que consume el objeto "robot". */
export function extractPose3d(
  liveValue: any,
  topicType: string,
  format: ArrayFormat = "auto",
): Pose3D | null {
  return extractPoses3d(liveValue, topicType, format)[0] ?? null
}
