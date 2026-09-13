// Decodificación de valores NT4 y de structs binarios WPILib (Little Endian).

// Desempaqueta el valor que llega desde Rust (NTValue enum) a un valor JS plano.
export function unpackLiveValue(liveValue: any): any {
  if (!liveValue) return null
  if (liveValue.Number !== undefined) return liveValue.Number
  if (liveValue.Boolean !== undefined) return liveValue.Boolean
  if (liveValue.String !== undefined) return liveValue.String
  if (liveValue.NumberArray !== undefined) return liveValue.NumberArray
  if (liveValue.BooleanArray !== undefined) return liveValue.BooleanArray
  if (liveValue.StringArray !== undefined) return liveValue.StringArray
  if (liveValue.Raw !== undefined) return liveValue.Raw
  return null
}

// IMPORTANTE: el struct schema de WPILib serializa en Little Endian.
export function readDoubleLE(bytes: number[], offset: number): number {
  if (bytes.length < offset + 8) return 0.0
  const buf = new Uint8Array(bytes.slice(offset, offset + 8)).buffer
  return new DataView(buf).getFloat64(0, true) // true = Little Endian
}

// Tipos primitivos que puede declarar un schema de WPILib. La tabla escrita a
// mano de abajo son todos "double", que es el default cuando `type` no está.
export type StructPrimitive =
  | "bool" | "char"
  | "int8" | "int16" | "int32" | "int64"
  | "uint8" | "uint16" | "uint32" | "uint64"
  | "float" | "float32" | "double" | "float64"

export interface StructField {
  label: string
  /** Offset en BYTES desde el inicio del struct. */
  offset: number
  /** Ausente = "double" (todos los campos de STRUCT_DEFS). */
  type?: StructPrimitive
  /** Solo bitfields: posición y ancho en BITS; si está, manda sobre `offset`. */
  bitOffset?: number
  bitWidth?: number
  /** Solo char[]: cantidad de caracteres a leer como una sola cadena. */
  charLength?: number
  /** Solo enums: número -> nombre declarado en el schema. */
  enumValues?: Record<number, string>
  suffix?: string
  isAngle?: boolean
}

export interface StructDef {
  /** Tamaño en bytes de UNA instancia (stride para trocear un struct:X[]). */
  length: number
  fields: StructField[]
  /** El struct tenía más campos de los que se aplanan (arrays muy grandes). */
  truncated?: boolean
}

// Agregar un struct nuevo (ej. ChassisSpeeds) es solo añadir una entrada aquí;
// StructWidget / StructArrayWidget lo recogen automáticamente. El "length" es
// el tamaño en bytes de UNA instancia del struct (clave también para poder
// trocear un array de structs en instancias individuales).
//
// Todos los offsets están calculados aplanando structs anidados: si un campo
// es a su vez un struct (ej. Pose2d.translation es un Translation2d), sus
// campos internos se insertan en el offset donde ese sub-struct arranca, en
// el mismo orden en que WPILib los declara en su Struct<T> nativo.
export const STRUCT_DEFS: Record<string, StructDef> = {
  // --- geometry: 2D ---
  Translation2d: {
    length: 16,
    fields: [
      { label: "X", offset: 0, suffix: " m" },
      { label: "Y", offset: 8, suffix: " m" },
    ],
  },
  Rotation2d: {
    length: 8,
    fields: [{ label: "θ", offset: 0, suffix: "°", isAngle: true }],
  },
  Pose2d: {
    length: 24,
    fields: [
      { label: "X", offset: 0, suffix: " m" },
      { label: "Y", offset: 8, suffix: " m" },
      { label: "θ", offset: 16, suffix: "°", isAngle: true },
    ],
  },
  // Transform2d tiene EXACTAMENTE el mismo layout binario que Pose2d
  // (translation + rotation relativos en vez de absolutos).
  Transform2d: {
    length: 24,
    fields: [
      { label: "dX", offset: 0, suffix: " m" },
      { label: "dY", offset: 8, suffix: " m" },
      { label: "dθ", offset: 16, suffix: "°", isAngle: true },
    ],
  },
  Twist2d: {
    length: 24,
    fields: [
      { label: "dx", offset: 0, suffix: " m" },
      { label: "dy", offset: 8, suffix: " m" },
      { label: "dθ", offset: 16, suffix: "°/loop", isAngle: true },
    ],
  },

  // --- geometry: 3D ---
  Translation3d: {
    length: 24,
    fields: [
      { label: "X", offset: 0, suffix: " m" },
      { label: "Y", offset: 8, suffix: " m" },
      { label: "Z", offset: 16, suffix: " m" },
    ],
  },
  // Rotation3d serializa como un Quaternion (w,x,y,z) — no como roll/pitch/yaw.
  // Se dejan los 4 componentes crudos: convertirlos a Euler necesita trig de
  // verdad (atan2 con clamps de gimbal lock), no un simple factor rad->deg,
  // así que no encaja en el decodificador genérico isAngle de este archivo.
  Rotation3d: {
    length: 32,
    fields: [
      { label: "W", offset: 0 },
      { label: "X", offset: 8 },
      { label: "Y", offset: 16 },
      { label: "Z", offset: 24 },
    ],
  },
  Quaternion: {
    length: 32,
    fields: [
      { label: "W", offset: 0 },
      { label: "X", offset: 8 },
      { label: "Y", offset: 16 },
      { label: "Z", offset: 24 },
    ],
  },
  // Pose3d = Translation3d (24B) + Rotation3d/Quaternion (32B) = 56B
  Pose3d: {
    length: 56,
    fields: [
      { label: "X", offset: 0, suffix: " m" },
      { label: "Y", offset: 8, suffix: " m" },
      { label: "Z", offset: 16, suffix: " m" },
      { label: "QW", offset: 24 },
      { label: "QX", offset: 32 },
      { label: "QY", offset: 40 },
      { label: "QZ", offset: 48 },
    ],
  },
  // Transform3d: mismo layout binario que Pose3d (deltas en vez de absolutos)
  Transform3d: {
    length: 56,
    fields: [
      { label: "dX", offset: 0, suffix: " m" },
      { label: "dY", offset: 8, suffix: " m" },
      { label: "dZ", offset: 16, suffix: " m" },
      { label: "QW", offset: 24 },
      { label: "QX", offset: 32 },
      { label: "QY", offset: 40 },
      { label: "QZ", offset: 48 },
    ],
  },
  Twist3d: {
    length: 48,
    fields: [
      { label: "dx", offset: 0, suffix: " m" },
      { label: "dy", offset: 8, suffix: " m" },
      { label: "dz", offset: 16, suffix: " m" },
      { label: "rx", offset: 24, suffix: "°/loop", isAngle: true },
      { label: "ry", offset: 32, suffix: "°/loop", isAngle: true },
      { label: "rz", offset: 40, suffix: "°/loop", isAngle: true },
    ],
  },

  // --- geometry: formas 2D (WPILib 2024+) ---
  // Ellipse2d / Rectangle2d = Pose2d (24B, el "center") + 2 doubles extra.
  Ellipse2d: {
    length: 40,
    fields: [
      { label: "Center X", offset: 0, suffix: " m" },
      { label: "Center Y", offset: 8, suffix: " m" },
      { label: "Center θ", offset: 16, suffix: "°", isAngle: true },
      { label: "X Semi-axis", offset: 24, suffix: " m" },
      { label: "Y Semi-axis", offset: 32, suffix: " m" },
    ],
  },
  Rectangle2d: {
    length: 40,
    fields: [
      { label: "Center X", offset: 0, suffix: " m" },
      { label: "Center Y", offset: 8, suffix: " m" },
      { label: "Center θ", offset: 16, suffix: "°", isAngle: true },
      { label: "X Width", offset: 24, suffix: " m" },
      { label: "Y Width", offset: 32, suffix: " m" },
    ],
  },

  // --- kinematics: chassis ---
  ChassisSpeeds: {
    length: 24,
    fields: [
      { label: "Vx", offset: 0, suffix: " m/s" },
      { label: "Vy", offset: 8, suffix: " m/s" },
      { label: "ω", offset: 16, suffix: "°/s", isAngle: true },
    ],
  },

  // --- kinematics: swerve ---
  SwerveModuleState: {
    length: 16,
    fields: [
      { label: "Speed", offset: 0, suffix: " m/s" },
      { label: "Angle", offset: 8, suffix: "°", isAngle: true },
    ],
  },
  SwerveModulePosition: {
    length: 16,
    fields: [
      { label: "Distance", offset: 0, suffix: " m" },
      { label: "Angle", offset: 8, suffix: "°", isAngle: true },
    ],
  },

  // --- kinematics: diferencial ---
  DifferentialDriveWheelSpeeds: {
    length: 16,
    fields: [
      { label: "Left", offset: 0, suffix: " m/s" },
      { label: "Right", offset: 8, suffix: " m/s" },
    ],
  },
  DifferentialDriveWheelPositions: {
    length: 16,
    fields: [
      { label: "Left", offset: 0, suffix: " m" },
      { label: "Right", offset: 8, suffix: " m" },
    ],
  },
  DifferentialDriveWheelVoltages: {
    length: 16,
    fields: [
      { label: "Left", offset: 0, suffix: " V" },
      { label: "Right", offset: 8, suffix: " V" },
    ],
  },

  // --- kinematics: mecanum ---
  MecanumDriveWheelSpeeds: {
    length: 32,
    fields: [
      { label: "Front Left", offset: 0, suffix: " m/s" },
      { label: "Front Right", offset: 8, suffix: " m/s" },
      { label: "Rear Left", offset: 16, suffix: " m/s" },
      { label: "Rear Right", offset: 24, suffix: " m/s" },
    ],
  },
  MecanumDriveWheelPositions: {
    length: 32,
    fields: [
      { label: "Front Left", offset: 0, suffix: " m" },
      { label: "Front Right", offset: 8, suffix: " m" },
      { label: "Rear Left", offset: 16, suffix: " m" },
      { label: "Rear Right", offset: 24, suffix: " m" },
    ],
  },

  // --- trajectory / control ---
  // El type string que WPILib publica para esto es "TrapezoidProfile.State".
  "TrapezoidProfile.State": {
    length: 16,
    fields: [
      { label: "Position", offset: 0 },
      { label: "Velocity", offset: 8 },
    ],
  },
}

// --- Lectura de primitivos --------------------------------------------------

const SIGNED_INTS = new Set<StructPrimitive>(["int8", "int16", "int32", "int64"])

// Los bitfields empaquetan desde el bit MENOS significativo de cada byte, así
// que no se pueden leer con DataView: hay que juntar bit por bit.
function readBitsLE(bytes: number[], bitOffset: number, bitWidth: number): bigint {
  let out = 0n
  for (let i = 0; i < bitWidth; i++) {
    const bit = bitOffset + i
    const byte = bytes[bit >> 3] ?? 0
    if ((byte >> (bit & 7)) & 1) out |= 1n << BigInt(i)
  }
  return out
}

function signExtend(value: bigint, bits: number): bigint {
  const signBit = 1n << BigInt(bits - 1)
  return (value & signBit) !== 0n ? value - (1n << BigInt(bits)) : value
}

function readPrimitive(view: DataView, offset: number, type: StructPrimitive): number {
  try {
    switch (type) {
      case "bool": return view.getUint8(offset) !== 0 ? 1 : 0
      case "char": return view.getUint8(offset)
      case "int8": return view.getInt8(offset)
      case "int16": return view.getInt16(offset, true)
      case "int32": return view.getInt32(offset, true)
      // JS no tiene enteros de 64 bits: por encima de 2^53 se pierde
      // precisión, pero es lo mismo que hace cualquier dashboard del ecosistema.
      case "int64": return Number(view.getBigInt64(offset, true))
      case "uint8": return view.getUint8(offset)
      case "uint16": return view.getUint16(offset, true)
      case "uint32": return view.getUint32(offset, true)
      case "uint64": return Number(view.getBigUint64(offset, true))
      case "float":
      case "float32": return view.getFloat32(offset, true)
      case "double":
      case "float64": return view.getFloat64(offset, true)
    }
  } catch {
    // Buffer más corto de lo que declara el schema (topic recién anunciado,
    // valor truncado): se muestra 0 en vez de romper el widget entero.
  }
  return 0
}

const INTEGER_TYPES = new Set<StructPrimitive>([
  "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64",
])

export interface DecodedStructField {
  label: string
  /** Vista numérica: bool -> 0/1, char[] -> NaN. Es la que usan los extractores. */
  value: number
  /** Vista mostrable, ya formateada según el tipo (true/false, nombre del enum...). */
  text: string
  suffix?: string
  isAngle?: boolean
}

export function decodeStructBytes(bytes: number[], def: StructDef): DecodedStructField[] {
  const view = new DataView(new Uint8Array(bytes).buffer)

  return def.fields.map(f => {
    const type = f.type ?? "double"

    // char[]: los bytes son una cadena, no números sueltos.
    if (type === "char" && f.charLength !== undefined) {
      let text = ""
      for (let i = 0; i < f.charLength; i++) {
        const code = bytes[f.offset + i]
        if (code === undefined || code === 0) break
        text += String.fromCharCode(code)
      }
      return { label: f.label, value: NaN, text, suffix: f.suffix }
    }

    let value: number
    if (f.bitOffset !== undefined && f.bitWidth !== undefined) {
      const raw = readBitsLE(bytes, f.bitOffset, f.bitWidth)
      value = Number(SIGNED_INTS.has(type) ? signExtend(raw, f.bitWidth) : raw)
    } else {
      value = readPrimitive(view, f.offset, type)
    }

    if (f.isAngle) value = value * (180 / Math.PI)

    let text: string
    if (f.enumValues !== undefined && f.enumValues[value] !== undefined) {
      text = f.enumValues[value]
    } else if (type === "bool") {
      text = value !== 0 ? "true" : "false"
    } else if (INTEGER_TYPES.has(type)) {
      text = value.toFixed(0)
    } else {
      text = value.toFixed(2)
    }

    return { label: f.label, value, text, suffix: f.suffix, isAngle: f.isAngle }
  })
}

// Trocea un buffer de N structs consecutivos (ej. un topic "SwerveModuleState[]")
// en instancias individuales ya decodificadas, usando def.length como stride.
export function decodeStructArrayBytes(bytes: number[], def: StructDef) {
  const count = Math.floor(bytes.length / def.length)
  const out: DecodedStructField[][] = []
  for (let i = 0; i < count; i++) {
    out.push(decodeStructBytes(bytes.slice(i * def.length, (i + 1) * def.length), def))
  }
  return out
}