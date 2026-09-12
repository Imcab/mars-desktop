import { describe, it, expect } from "vitest"
import { extractPose3d, extractPoses3d, isPose3dTopic, isSinglePoseTopic } from "./pose3d"
import { yawOf } from "./frames"

// Los structs de WPILib se serializan como doubles LITTLE ENDIAN pegados uno
// detrás del otro, que es lo que llega en `liveValue.Raw`.
function structBytes(...values: number[]): { Raw: number[] } {
  const buffer = new ArrayBuffer(values.length * 8)
  const view = new DataView(buffer)
  values.forEach((value, i) => view.setFloat64(i * 8, value, true))
  return { Raw: Array.from(new Uint8Array(buffer)) }
}

function expectClose(actual: number, expected: number, precision = 9) {
  expect(actual).toBeCloseTo(expected, precision)
}

describe("qué topics acepta la cancha 3D", () => {
  it("acepta la geometría de WPILib, suelta y en array", () => {
    for (const type of [
      "struct:Pose3d", "struct:Pose3d[]", "struct:Pose2d", "struct:Translation3d[]",
      "struct:Transform3d", "struct:Translation2d",
    ]) {
      expect(isPose3dTopic(type)).toBe(true)
    }
  })

  it("acepta los arrays numéricos, que es el formato heredado de Field2d", () => {
    expect(isPose3dTopic("double[]")).toBe(true)
    expect(isPose3dTopic("float[]")).toBe(true)
  })

  it("rechaza lo que no es geometría", () => {
    for (const type of ["double", "boolean", "string[]", "struct:SwerveModuleState[]"]) {
      expect(isPose3dTopic(type)).toBe(false)
    }
  })

  it("distingue un struct suelto de un array", () => {
    expect(isSinglePoseTopic("struct:Pose3d")).toBe(true)
    expect(isSinglePoseTopic("struct:Pose3d[]")).toBe(false)
  })
})

describe("Pose3d", () => {
  it("lee traslación y cuaternión crudos", () => {
    // (x, y, z, qw, qx, qy, qz) — Pose3d serializa Rotation3d como cuaternión,
    // no como roll/pitch/yaw.
    const value = structBytes(1.5, -2.25, 0.75, Math.SQRT1_2, 0, 0, Math.SQRT1_2)
    const pose = extractPose3d(value, "struct:Pose3d")!

    expectClose(pose.x, 1.5)
    expectClose(pose.y, -2.25)
    expectClose(pose.z, 0.75)
    expectClose(yawOf([pose.qw, pose.qx, pose.qy, pose.qz]), Math.PI / 2)
  })

  it("trocea un array por el tamaño del struct", () => {
    const first = structBytes(1, 2, 3, 1, 0, 0, 0).Raw
    const second = structBytes(4, 5, 6, 1, 0, 0, 0).Raw
    const poses = extractPoses3d({ Raw: [...first, ...second] }, "struct:Pose3d[]")

    expect(poses).toHaveLength(2)
    expectClose(poses[1].x, 4)
    expectClose(poses[1].z, 6)
  })

  it("normaliza un cuaternión sin norma en vez de dejar la malla degenerada", () => {
    const pose = extractPose3d(structBytes(0, 0, 0, 0, 0, 0, 0), "struct:Pose3d")!
    expect(pose.qw).toBe(1)
  })
})

describe("Pose2d levantada a 3D", () => {
  it("deja z en cero y convierte θ a un giro sobre +Z", () => {
    // El struct guarda θ en RADIANES; el decodificador genérico lo pasa a
    // grados y este módulo lo devuelve a radianes.
    const pose = extractPose3d(structBytes(3, 4, Math.PI / 3), "struct:Pose2d")!

    expectClose(pose.x, 3)
    expectClose(pose.y, 4)
    expect(pose.z).toBe(0)
    expectClose(yawOf([pose.qw, pose.qx, pose.qy, pose.qz]), Math.PI / 3, 6)
  })

  it("una Translation2d no aporta orientación", () => {
    const pose = extractPose3d(structBytes(1, 2), "struct:Translation2d")!
    expect(pose.qw).toBe(1)
    expect(pose.z).toBe(0)
  })
})

describe("arrays numéricos", () => {
  it("lee tripletas [x, y, θ°] — el formato de Field2d", () => {
    const poses = extractPoses3d({ NumberArray: [1, 2, 90, 3, 4, -90] }, "double[]")

    expect(poses).toHaveLength(2)
    expectClose(poses[0].x, 1)
    expectClose(yawOf([poses[0].qw, poses[0].qx, poses[0].qy, poses[0].qz]), Math.PI / 2)
    expectClose(yawOf([poses[1].qw, poses[1].qx, poses[1].qy, poses[1].qz]), -Math.PI / 2)
  })

  it("lee septetos cuando el largo solo puede ser 3D", () => {
    // 7 números no encajan en tripletas, así que no hace falta pista alguna.
    const poses = extractPoses3d({ NumberArray: [1, 2, 3, 1, 0, 0, 0] }, "double[]")
    expect(poses).toHaveLength(1)
    expectClose(poses[0].z, 3)
  })

  it("en el empate prefiere tripletas, que es el formato viejo", () => {
    // 21 números encajan en los dos (7 tripletas o 3 septetos).
    const array = Array.from({ length: 21 }, (_, i) => i)
    expect(extractPoses3d({ NumberArray: array }, "double[]")).toHaveLength(7)
  })

  it("respeta el formato fijado a mano cuando la heurística no alcanza", () => {
    const array = Array.from({ length: 21 }, (_, i) => i)
    expect(extractPoses3d({ NumberArray: array }, "double[]", "pose3d")).toHaveLength(3)
  })

  it("descarta la cola incompleta en vez de inventar ceros", () => {
    expect(extractPoses3d({ NumberArray: [1, 2, 0, 4, 5] }, "double[]")).toHaveLength(1)
  })
})

describe("valores que no se pueden leer", () => {
  it("devuelve una lista vacía en vez de romper", () => {
    expect(extractPoses3d(null, "struct:Pose3d")).toEqual([])
    expect(extractPoses3d({ Raw: [] }, "struct:Pose3d")).toEqual([])
    expect(extractPoses3d({ NumberArray: [] }, "double[]")).toEqual([])
    expect(extractPoses3d({ Number: 5 }, "double")).toEqual([])
    // Un struct que la app no sabe leer no debe colarse como pose vacía.
    expect(extractPoses3d({ Raw: [1, 2, 3] }, "struct:Desconocido")).toEqual([])
  })

  it("filtra las poses con NaN, que dejarían la malla sin dibujar", () => {
    expect(extractPoses3d({ NumberArray: [NaN, 1, 0] }, "double[]")).toEqual([])
  })
})
