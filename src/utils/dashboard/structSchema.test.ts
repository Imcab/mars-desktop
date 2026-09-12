import { describe, it, expect } from "vitest"
import { compileAll } from "./structSchema"
import { STRUCT_DEFS, decodeStructBytes, StructDef } from "./valueDecoding"

// Descriptores tal como los publica allwpilib en "/.schema/struct:<Tipo>".
const WPILIB_SCHEMAS: Record<string, string> = {
  Translation2d: "double x;double y",
  Rotation2d: "double value",
  Pose2d: "Translation2d translation;Rotation2d rotation",
  Transform2d: "Translation2d translation;Rotation2d rotation",
  Twist2d: "double dx;double dy;double dtheta",
  Translation3d: "double x;double y;double z",
  Quaternion: "double w;double x;double y;double z",
  Rotation3d: "Quaternion q",
  Pose3d: "Translation3d translation;Rotation3d rotation",
  Transform3d: "Translation3d translation;Rotation3d rotation",
  Twist3d: "double dx;double dy;double dz;double rx;double ry;double rz",
  ChassisSpeeds: "double vx;double vy;double omega",
  SwerveModuleState: "double speed;Rotation2d angle",
  SwerveModulePosition: "double distance;Rotation2d angle",
  DifferentialDriveWheelSpeeds: "double left;double right",
  DifferentialDriveWheelPositions: "double left;double right",
  DifferentialDriveWheelVoltages: "double left;double right",
  MecanumDriveWheelSpeeds: "double front_left;double front_right;double rear_left;double rear_right",
  MecanumDriveWheelPositions: "double front_left;double front_right;double rear_left;double rear_right",
  Ellipse2d: "Pose2d center;double xSemiAxis;double ySemiAxis",
  Rectangle2d: "Pose2d center;double xWidth;double yWidth",
}

// --- Helpers para armar buffers binarios ------------------------------------

function f64(value: number): number[] {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setFloat64(0, value, true)
  return [...new Uint8Array(buf)]
}

function i32(value: number): number[] {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setInt32(0, value, true)
  return [...new Uint8Array(buf)]
}

const labels = (def: StructDef) => def.fields.map(f => f.label)
const offsets = (def: StructDef) => def.fields.map(f => f.offset)

// ---------------------------------------------------------------------------

describe("compilación contra los tipos de WPILib", () => {
  const compiled = compileAll(WPILIB_SCHEMAS)

  // STRUCT_DEFS es la tabla que ya estaba escrita a mano y que sabemos correcta,
  // así que sirve de referencia: si el compilador saca los mismos offsets y
  // tamaños para los 21 tipos, la aritmética de bits es la de la spec.
  const shared = Object.keys(STRUCT_DEFS).filter(name => name in WPILIB_SCHEMAS)

  it("cubre todos los tipos compartidos con la tabla escrita a mano", () => {
    expect(shared.length).toBe(21)
  })

  it.each(shared)("%s coincide con STRUCT_DEFS", name => {
    const actual = compiled[name]
    const expected = STRUCT_DEFS[name]
    expect(actual, `${name} no compiló`).toBeDefined()
    expect(actual.length).toBe(expected.length)
    expect(offsets(actual)).toEqual(offsets(expected))
  })
})

describe("structs propios del equipo", () => {
  const defs = compileAll({
    ...WPILIB_SCHEMAS,
    ArmState: "double angle;bool homed;int32 faultCount;Rotation2d target",
  })
  const arm = defs.ArmState

  it("suma los tamaños de tipos mixtos sin alinear", () => {
    // 8 (double) + 1 (bool) + 4 (int32) + 8 (Rotation2d) = 21
    expect(arm.length).toBe(21)
    expect(offsets(arm)).toEqual([0, 8, 9, 13])
    expect(arm.fields.map(f => f.type)).toEqual(["double", "bool", "int32", "double"])
  })

  it("aplana el struct anidado con la ruta como etiqueta", () => {
    expect(labels(arm)).toEqual(["angle", "homed", "faultCount", "target/value"])
  })

  it("decodifica cada campo con su tipo", () => {
    const bytes = [...f64(1.25), 1, ...i32(-7), ...f64(0.5)]
    const fields = decodeStructBytes(bytes, arm)

    expect(fields[0].value).toBe(1.25)
    expect(fields[1].text).toBe("true")
    expect(fields[2].value).toBe(-7)
    // Los enteros se muestran sin decimales; antes todo pasaba por toFixed(2).
    expect(fields[2].text).toBe("-7")
    expect(fields[3].value).toBe(0.5)
  })
})

describe("enums", () => {
  const defs = compileAll({ Mode: "enum {kOff=0, kAuto=1, kManual=2} int8 mode;double setpoint" })
  const mode = defs.Mode

  it("no altera el layout", () => {
    expect(mode.length).toBe(9)
    expect(offsets(mode)).toEqual([0, 1])
  })

  it("muestra el nombre declarado en vez del número", () => {
    const fields = decodeStructBytes([2, ...f64(3.5)], mode)
    expect(fields[0].value).toBe(2)
    expect(fields[0].text).toBe("kManual")
  })

  it("cae al número si el valor no está en el enum", () => {
    const fields = decodeStructBytes([9, ...f64(0)], mode)
    expect(fields[0].text).toBe("9")
  })
})

describe("bitfields", () => {
  it("empaqueta bools consecutivos en una sola palabra", () => {
    const flags = compileAll({ Flags: "bool a:1;bool b:1;bool c:1;bool d:1;double value" }).Flags

    // Los cuatro bools comparten un byte; el double arranca en el siguiente.
    expect(flags.length).toBe(9)
    expect(flags.fields.slice(0, 4).map(f => f.bitOffset)).toEqual([0, 1, 2, 3])
    expect(flags.fields[4].offset).toBe(1)

    // a=1, b=0, c=1, d=0 -> 0b0101
    const fields = decodeStructBytes([0b0101, ...f64(2)], flags)
    expect(fields.map(f => f.text)).toEqual(["true", "false", "true", "false", "2.00"])
  })

  it("abre una palabra nueva cuando el valor ya no entra", () => {
    // 6 + 4 bits no caben en un solo uint8: el segundo abre otra palabra.
    const packed = compileAll({ P: "uint8 a:6;uint8 b:4" }).P
    expect(packed.length).toBe(2)
    expect(packed.fields.map(f => f.bitOffset)).toEqual([0, 8])
  })

  it("extiende el signo de los enteros con signo", () => {
    const signed = compileAll({ S: "int8 v:4" }).S
    expect(signed.length).toBe(1)
    // 0b1101 son 13 sin signo, pero -3 leído como 4 bits con signo.
    expect(decodeStructBytes([0b1101], signed)[0].value).toBe(-3)
  })

  it("descarta bitfields inválidos según la spec", () => {
    // Un double no admite bitfield y un bool solo admite ancho 1.
    const invalid = compileAll({ Bad: "double d:4;bool b:3;double ok" }).Bad
    expect(labels(invalid)).toEqual(["ok"])
  })
})

describe("arrays", () => {
  const defs = compileAll({ ...WPILIB_SCHEMAS, Path: "double xs[3];Translation2d pts[2]" })
  const path = defs.Path

  it("aplana arrays de primitivos y de structs", () => {
    // 3*8 + 2*16 = 56
    expect(path.length).toBe(56)
    expect(labels(path)).toEqual([
      "xs[0]", "xs[1]", "xs[2]",
      "pts[0]/x", "pts[0]/y", "pts[1]/x", "pts[1]/y",
    ])
    expect(offsets(path)).toEqual([0, 8, 16, 24, 32, 40, 48])
  })

  it("trata char[] como una sola cadena", () => {
    const named = compileAll({ Named: "char name[4];double v" }).Named
    expect(named.length).toBe(12)
    expect(named.fields.length).toBe(2)

    const fields = decodeStructBytes([65, 66, 67, 0, ...f64(9)], named)
    expect(fields[0].text).toBe("ABC")
    expect(fields[1].value).toBe(9)
  })

  it("corta el aplanado de arrays enormes y lo marca", () => {
    // Un Pose3d poses[200] generaría 1400 filas que ninguna tarjeta muestra.
    const huge = compileAll({ ...WPILIB_SCHEMAS, Huge: "Pose3d poses[200]" }).Huge
    expect(huge.truncated).toBe(true)
    expect(huge.fields.length).toBeLessThanOrEqual(64)
    // El tamaño de la instancia sigue siendo el real, que es lo que usa
    // decodeStructArrayBytes como stride.
    expect(huge.length).toBe(200 * 56)
  })
})

describe("resolución de dependencias", () => {
  it("compila aunque el hijo llegue después que el padre", () => {
    // El orden de llegada por NetworkTables no está garantizado.
    const defs = compileAll({
      Parent: "Child c;double after",
      Child: "double a;double b",
    })
    expect(defs.Parent.length).toBe(24)
    expect(labels(defs.Parent)).toEqual(["c/a", "c/b", "after"])
  })

  it("no compila un struct cuya dependencia nunca llegó", () => {
    const defs = compileAll({ Orphan: "Unknown u;double x" })
    expect(defs.Orphan).toBeUndefined()
  })

  it("compila el resto aunque uno quede sin resolver", () => {
    const defs = compileAll({
      Orphan: "Unknown u",
      Fine: "double x;double y",
    })
    expect(defs.Orphan).toBeUndefined()
    expect(defs.Fine.length).toBe(16)
  })
})

describe("entradas degeneradas", () => {
  it("ignora declaraciones vacías o sin nombre", () => {
    const defs = compileAll({ Broken: ";;garbage;;double ok;" })
    expect(labels(defs.Broken)).toEqual(["ok"])
  })

  it("acepta un schema vacío", () => {
    const defs = compileAll({ Empty: "" })
    expect(defs.Empty.length).toBe(0)
    expect(defs.Empty.fields).toEqual([])
  })

  it("no rompe si el buffer es más corto que el schema", () => {
    // Pasa de verdad: el topic se anuncia antes de tener un valor completo.
    const def = compileAll({ Big: "double a;double b;double c" }).Big
    const fields = decodeStructBytes(f64(1.5), def)
    expect(fields[0].value).toBe(1.5)
    expect(fields[1].value).toBe(0)
    expect(fields[2].value).toBe(0)
  })
})
