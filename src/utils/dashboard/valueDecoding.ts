// Decodificación de valores NT4 y de structs binarios WPILib (Little Endian).

// Desempaqueta el valor que llega desde Rust (NTValue enum) a un valor JS plano.
export function unpackLiveValue(liveValue: any): any {
  if (!liveValue) return null
  if (liveValue.Number !== undefined) return liveValue.Number
  if (liveValue.Boolean !== undefined) return liveValue.Boolean
  if (liveValue.String !== undefined) return liveValue.String
  if (liveValue.NumberArray !== undefined) return liveValue.NumberArray
  if (liveValue.Raw !== undefined) return liveValue.Raw
  return null
}

// IMPORTANTE: el struct schema de WPILib serializa en Little Endian.
export function readDoubleLE(bytes: number[], offset: number): number {
  if (bytes.length < offset + 8) return 0.0
  const buf = new Uint8Array(bytes.slice(offset, offset + 8)).buffer
  return new DataView(buf).getFloat64(0, true) // true = Little Endian
}

export interface StructField {
  label: string
  offset: number
  suffix?: string
  isAngle?: boolean
}

export interface StructDef {
  length: number
  fields: StructField[]
}

// Agregar un struct nuevo (ej. ChassisSpeeds) es solo añadir una entrada aquí;
// StructWidget / StructArrayWidget lo recogen automáticamente.
export const STRUCT_DEFS: Record<string, StructDef> = {
  Pose2d: {
    length: 24,
    fields: [
      { label: "X", offset: 0, suffix: " m" },
      { label: "Y", offset: 8, suffix: " m" },
      { label: "θ", offset: 16, suffix: "°", isAngle: true },
    ],
  },
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
}

export function decodeStructBytes(bytes: number[], def: StructDef) {
  return def.fields.map(f => {
    let value = readDoubleLE(bytes, f.offset)
    if (f.isAngle) value = value * (180 / Math.PI)
    return { ...f, value }
  })
}
