import { describe, it, expect } from "vitest"
import {
  fullTopicName, suggestJavaName, publishPayload, javaNumber, javaValueLiteral,
  javaDeclaration, javaGetter, javaSnippet, javaBlock, makeEntry, changeKind,
  normalizeEntries, kindSpec, isListKind,
  structBytes, eulerToQuaternion, schemaPublications, schemasForEntries,
  keyFromTopicName, NT_SESSION_ROOT,
} from "./ntSession"
import { NTSessionEntry, NTSessionKind } from "../../store/appStore"

const entry = (kind: NTSessionKind, over: Partial<NTSessionEntry> = {}): NTSessionEntry => ({
  ...makeEntry("e1", "Arm/kP", kind),
  ...over,
})

describe("nombres", () => {
  it("arma la ruta completa con una sola barra", () => {
    expect(fullTopicName("MarsDesktop", "Arm/kP")).toBe("/MarsDesktop/Arm/kP")
    expect(fullTopicName("/MarsDesktop/", "/Arm/kP/")).toBe("/MarsDesktop/Arm/kP")
  })

  it("tolera una raíz vacía", () => {
    expect(fullTopicName("", "kP")).toBe("/kP")
  })

  it("keyFromTopicName recorta la raíz y descarta lo que no cuelga de ella", () => {
    expect(keyFromTopicName("/MarsDesktop/Arm/kP")).toBe("Arm/kP")
    expect(keyFromTopicName("/SmartDashboard/x")).toBeNull()
    // La raíz sola tampoco es una clave.
    expect(keyFromTopicName(`/${NT_SESSION_ROOT}`)).toBeNull()
  })

  it("lo que publica fullTopicName lo sabe deshacer keyFromTopicName", () => {
    const key = "Auto/start pose"
    expect(keyFromTopicName(fullTopicName(NT_SESSION_ROOT, key))).toBe(key)
  })

  it("sugiere un nombre de variable camelCase desde la clave", () => {
    expect(suggestJavaName("Arm/kP")).toBe("kP")
    expect(suggestJavaName("drive speed")).toBe("driveSpeed")
    expect(suggestJavaName("Auto/start-pose")).toBe("startPose")
  })

  it("no deja un nombre que empiece con dígito", () => {
    expect(suggestJavaName("2ndStage")).toBe("v2ndStage")
  })
})

describe("publishPayload", () => {
  it("publica escalares con su tipo nativo", () => {
    expect(publishPayload(entry("double", { numbers: [0.3] })))
      .toEqual({ topicType: "double", value: 0.3 })
    expect(publishPayload(entry("boolean", { booleans: [true] })))
      .toEqual({ topicType: "boolean", value: true })
    expect(publishPayload(entry("string", { strings: ["auto"] })))
      .toEqual({ topicType: "string", value: "auto" })
  })

  it("redondea el entero en vez de mandar un decimal", () => {
    expect(publishPayload(entry("int", { numbers: [2.7] })))
      .toEqual({ topicType: "int", value: 3 })
  })

  it("publica los arreglos completos", () => {
    expect(publishPayload(entry("double[]", { numbers: [1, 2, 3] })))
      .toEqual({ topicType: "double[]", value: [1, 2, 3] })
    expect(publishPayload(entry("string[]", { strings: ["a", "b"] })))
      .toEqual({ topicType: "string[]", value: ["a", "b"] })
  })

  it("manda la geometría como struct binario, no como arreglo", () => {
    const payload = publishPayload(entry("Pose2d", { numbers: [1.5, 2, 90] }))
    expect(payload.topicType).toBe("struct:Pose2d")
    // Los bytes de un Pose2d: tres doubles.
    expect(payload.value).toHaveLength(24)
  })

  it("rellena con cero los componentes que falten", () => {
    // Un Pose3d son 56 bytes aunque solo se haya escrito la X.
    expect(publishPayload(entry("Pose3d", { numbers: [1] })).value).toHaveLength(56)
  })
})

describe("javaNumber", () => {
  it("siempre deja el punto en los double, para que Java no infiera int", () => {
    expect(javaNumber(1)).toBe("1.0")
    expect(javaNumber(0)).toBe("0.0")
    expect(javaNumber(-3)).toBe("-3.0")
  })

  it("limpia el ruido binario", () => {
    expect(javaNumber(0.1 + 0.2)).toBe("0.3")
  })

  it("los enteros van sin punto", () => {
    expect(javaNumber(2.7, true)).toBe("3")
  })

  it("no explota con valores no finitos", () => {
    expect(javaNumber(NaN)).toBe("0.0")
    expect(javaNumber(Infinity, true)).toBe("0")
  })
})

describe("declaraciones Java", () => {
  it("double", () => {
    expect(javaDeclaration(entry("double", { javaName: "kA", numbers: [0.3] })))
      .toBe("double kA = 0.3;")
  })

  it("boolean y String", () => {
    expect(javaDeclaration(entry("boolean", { javaName: "useVision", booleans: [true] })))
      .toBe("boolean useVision = true;")
    expect(javaDeclaration(entry("string", { javaName: "mode", strings: ["auto"] })))
      .toBe('String mode = "auto";')
  })

  it("escapa comillas y barras en un String", () => {
    expect(javaDeclaration(entry("string", { javaName: "s", strings: ['a "b" \\c'] })))
      .toBe('String s = "a \\"b\\" \\\\c";')
  })

  it("arreglos", () => {
    expect(javaDeclaration(entry("double[]", { javaName: "offsets", numbers: [0.1, 0.2] })))
      .toBe("double[] offsets = { 0.1, 0.2 };")
    expect(javaDeclaration(entry("string[]", { javaName: "names", strings: ["a", "b"] })))
      .toBe('String[] names = { "a", "b" };')
  })

  it("Rotation2d usa fromDegrees, que es lo que se ve en pantalla", () => {
    expect(javaDeclaration(entry("Rotation2d", { javaName: "heading", numbers: [45] })))
      .toBe("Rotation2d heading = Rotation2d.fromDegrees(45.0);")
  })

  it("Pose2d", () => {
    expect(javaDeclaration(entry("Pose2d", { javaName: "start", numbers: [1.5, 2, 45] })))
      .toBe("Pose2d start = new Pose2d(1.5, 2.0, Rotation2d.fromDegrees(45.0));")
  })

  it("Pose3d convierte los tres ángulos a radianes", () => {
    expect(javaDeclaration(entry("Pose3d", { javaName: "p", numbers: [1, 2, 0.5, 0, 0, 90] })))
      .toBe("Pose3d p = new Pose3d(1.0, 2.0, 0.5, new Rotation3d("
        + "Math.toRadians(0.0), Math.toRadians(0.0), Math.toRadians(90.0)));")
  })

  it("ChassisSpeeds", () => {
    expect(javaDeclaration(entry("ChassisSpeeds", { javaName: "speeds", numbers: [1, 0, 30] })))
      .toBe("ChassisSpeeds speeds = new ChassisSpeeds(1.0, 0.0, Math.toRadians(30.0));")
  })
})

describe("modo valor", () => {
  it("copia solo la expresión, sin tipo ni punto y coma", () => {
    expect(javaValueLiteral(entry("Pose2d", { numbers: [1, 2, 90] })))
      .toBe("new Pose2d(1.0, 2.0, Rotation2d.fromDegrees(90.0))")
    expect(javaValueLiteral(entry("double", { numbers: [0.3] }))).toBe("0.3")
  })

  it("la nota no se copia en modo valor, porque rompería la expresión", () => {
    const e = entry("double", { numbers: [1], note: "ganancia" })
    expect(javaSnippet(e, "value", "MarsDesktop")).toBe("1.0")
    expect(javaSnippet(e, "declaration", "MarsDesktop")).toContain("// ganancia\n")
  })
})

describe("modo getter", () => {
  it("lee del topic con el valor actual como default", () => {
    const e = entry("double", { key: "Arm/kP", javaName: "kP", numbers: [0.3] })
    expect(javaGetter(e, "MarsDesktop"))
      .toBe('double kP = NetworkTableInstance.getDefault().getTable("MarsDesktop").getEntry("Arm/kP").getDouble(0.3);')
  })

  it("la geometría se lee con un subscriber tipado del struct", () => {
    const e = entry("Pose2d", { key: "Auto/start", javaName: "start", numbers: [1, 2, 90] })
    const out = javaGetter(e, "MarsDesktop")
    expect(out).toContain("StructSubscriber<Pose2d> startSub =")
    expect(out).toContain("Pose2d start = startSub.get();")
  })
})

describe("javaBlock", () => {
  it("junta los imports que hagan falta, ordenados y sin repetir", () => {
    const block = javaBlock([
      entry("Pose2d", { javaName: "a", numbers: [0, 0, 0] }),
      { ...entry("Rotation2d"), id: "e2", javaName: "b", numbers: [0] },
      { ...entry("double"), id: "e3", javaName: "c", numbers: [1] },
    ], "declaration", "MarsDesktop")

    expect(block).toContain("import edu.wpi.first.math.geometry.Pose2d;")
    expect(block).toContain("import edu.wpi.first.math.geometry.Rotation2d;")
    // Rotation2d aparece una sola vez aunque lo pidan dos entries.
    expect(block.match(/geometry\.Rotation2d/g)).toHaveLength(1)
    expect(block).not.toContain("import double")
  })

  it("agrega el import de NetworkTableInstance solo en modo getter", () => {
    const entries = [entry("double", { javaName: "a", numbers: [1] })]
    expect(javaBlock(entries, "getter", "T")).toContain("import edu.wpi.first.networktables.NetworkTableInstance;")
    expect(javaBlock(entries, "declaration", "T")).not.toContain("networktables")
  })

  it("una lista vacía no produce nada", () => {
    expect(javaBlock([], "declaration", "T")).toBe("")
  })
})

describe("tipos", () => {
  it("los arreglos son de largo libre y la geometría no", () => {
    expect(isListKind("double[]")).toBe(true)
    expect(isListKind("Pose2d")).toBe(false)
    expect(kindSpec("Pose2d").components).toHaveLength(3)
  })

  it("makeEntry crea la cantidad de componentes del tipo", () => {
    expect(makeEntry("a", "k", "Pose3d").numbers).toHaveLength(6)
    expect(makeEntry("a", "k", "boolean").booleans).toEqual([false])
  })

  it("cambiar de tipo conserva los componentes que coinciden", () => {
    const before = entry("Translation2d", { numbers: [1.5, 2.5] })
    const after = changeKind(before, "Pose2d")
    expect(after.numbers).toEqual([1.5, 2.5, 0])
  })

  it("cambiar a un tipo de otra familia no arrastra basura", () => {
    const after = changeKind(entry("Pose2d", { numbers: [1, 2, 3] }), "string")
    expect(after.strings).toEqual([""])
    expect(after.numbers).toEqual([])
  })
})

describe("normalizeEntries", () => {
  it("descarta lo que no tiene id y deduplica", () => {
    const entries = normalizeEntries([
      { id: "a", key: "x", kind: "double" },
      { id: "a", key: "duplicado" },
      { key: "sin id" },
      null,
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe("x")
  })

  it("cae al default con un tipo desconocido", () => {
    expect(normalizeEntries([{ id: "a", kind: "Vector7d" }])[0].kind).toBe("double")
  })

  it("limpia NaN y un step de cero", () => {
    const [e] = normalizeEntries([{ id: "a", numbers: [1, "x", null], step: 0, min: NaN }])
    expect(e.numbers).toEqual([1, 0, 0])
    expect(e.step).toBeGreaterThan(0)
    expect(isFinite(e.min)).toBe(true)
  })
})

describe("structs de WPILib", () => {
  /** Lee de vuelta los doubles little-endian que produjo structBytes. */
  function readDoubles(bytes: number[]): number[] {
    const view = new DataView(new Uint8Array(bytes).buffer)
    const out: number[] = []
    for (let i = 0; i < bytes.length / 8; i++) out.push(view.getFloat64(i * 8, true))
    return out
  }

  it("la geometría se publica como struct, no como arreglo", () => {
    expect(publishPayload(entry("Pose2d", { numbers: [1, 2, 90] })).topicType).toBe("struct:Pose2d")
    expect(publishPayload(entry("Rotation2d", { numbers: [0] })).topicType).toBe("struct:Rotation2d")
    // Los arreglos explícitos siguen siendo arreglos.
    expect(publishPayload(entry("double[]", { numbers: [1] })).topicType).toBe("double[]")
  })

  it("Rotation2d son 8 bytes con el ángulo en radianes", () => {
    const bytes = structBytes("Rotation2d", [90])
    expect(bytes).toHaveLength(8)
    expect(readDoubles(bytes)[0]).toBeCloseTo(Math.PI / 2)
  })

  it("Pose2d son 24 bytes: x, y, θ aplanados", () => {
    const bytes = structBytes("Pose2d", [1.5, -2, 180])
    expect(bytes).toHaveLength(24)
    const [x, y, theta] = readDoubles(bytes)
    expect(x).toBeCloseTo(1.5)
    expect(y).toBeCloseTo(-2)
    expect(theta).toBeCloseTo(Math.PI)
  })

  it("Translation3d y ChassisSpeeds tienen el largo que declara WPILib", () => {
    expect(structBytes("Translation3d", [1, 2, 3])).toHaveLength(24)
    expect(structBytes("ChassisSpeeds", [1, 0, 90])).toHaveLength(24)
    expect(readDoubles(structBytes("ChassisSpeeds", [1, 0, 90]))[2]).toBeCloseTo(Math.PI / 2)
  })

  it("Pose3d son 56 bytes y la rotación va como cuaternión", () => {
    const bytes = structBytes("Pose3d", [1, 2, 3, 0, 0, 90])
    expect(bytes).toHaveLength(56)
    const [x, y, z, w, qx, qy, qz] = readDoubles(bytes)
    expect([x, y, z]).toEqual([1, 2, 3])
    // Yaw de 90° puro: w = z = cos(45°).
    expect(w).toBeCloseTo(Math.SQRT1_2)
    expect(qz).toBeCloseTo(Math.SQRT1_2)
    expect(qx).toBeCloseTo(0)
    expect(qy).toBeCloseTo(0)
  })

  it("el cuaternión de tres ángulos nulos es la identidad", () => {
    expect(eulerToQuaternion(0, 0, 0)).toEqual([1, 0, 0, 0])
  })

  it("eulerToQuaternion sale normalizado", () => {
    const q = eulerToQuaternion(0.3, -0.8, 2.1)
    const norm = Math.hypot(q[0], q[1], q[2], q[3])
    expect(norm).toBeCloseTo(1)
  })

  it("un struct arrastra los schemas de los que depende, sin repetir", () => {
    const names = schemaPublications("Pose2d").map(s => s.topicName)
    expect(names).toContain("/.schema/struct:Pose2d")
    expect(names).toContain("/.schema/struct:Translation2d")
    expect(names).toContain("/.schema/struct:Rotation2d")
    expect(new Set(names).size).toBe(names.length)
  })

  it("Pose3d arrastra Rotation3d y Quaternion", () => {
    const names = schemaPublications("Pose3d").map(s => s.topicName)
    expect(names).toContain("/.schema/struct:Rotation3d")
    expect(names).toContain("/.schema/struct:Quaternion")
  })

  it("el schema viaja como bytes de texto y con el tipo que espera NT", () => {
    const [schema] = schemaPublications("Rotation2d")
    expect(schema.topicType).toBe("structschema")
    expect(new TextDecoder().decode(new Uint8Array(schema.value))).toBe("double value")
  })

  it("schemasForEntries junta lo de todos los valores una sola vez", () => {
    const names = schemasForEntries([
      entry("Pose2d", { numbers: [0, 0, 0] }),
      { ...entry("Rotation2d"), id: "e2" },
      { ...entry("double"), id: "e3" },
    ]).map(s => s.topicName)

    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain("/.schema/struct:Pose2d")
    // Un double no necesita schema alguno.
    expect(names.every(n => n.startsWith("/.schema/struct:"))).toBe(true)
  })

  it("el getter de un struct usa StructSubscriber y no un double[]", () => {
    const out = javaGetter(entry("Pose2d", { key: "Auto/start", javaName: "start", numbers: [1, 2, 45] }), "MarsDesktop")
    expect(out).toContain("StructSubscriber<Pose2d>")
    expect(out).toContain("getStructTopic(\"/MarsDesktop/Auto/start\", Pose2d.struct)")
    expect(out).not.toContain("getDoubleArray")
  })
})
