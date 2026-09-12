import { describe, it, expect } from "vitest"
import {
  Pose3D, composePose, frameTransform, fromFieldFrame, normalizeQuat,
  quatFromYaw, quatMultiply, rotateVector, toFieldFrame, yawOf,
} from "./frames"

// Medidas reales de la cancha 2026, para que las cuentas se lean como en la
// vida real y no como números inventados.
const SIZE = { length: 16.541, width: 8.069 }
const HALF_X = SIZE.length / 2
const HALF_Y = SIZE.width / 2

function pose(x: number, y: number, z = 0, yaw = 0): Pose3D {
  const q = quatFromYaw(yaw)
  return { x, y, z, qw: q[0], qx: q[1], qy: q[2], qz: q[3] }
}

function expectClose(actual: number, expected: number, precision = 9) {
  expect(actual).toBeCloseTo(expected, precision)
}

describe("cuaterniones", () => {
  it("saca el yaw que se le puso", () => {
    for (const yaw of [0, 0.5, Math.PI / 2, -1.2, 3]) {
      expectClose(yawOf(quatFromYaw(yaw)), yaw)
    }
  })

  it("compone giros en el orden en que se aplican", () => {
    const combined = quatMultiply(quatFromYaw(0.4), quatFromYaw(0.3))
    expectClose(yawOf(combined), 0.7)
  })

  it("gira un vector alrededor de Z", () => {
    const [x, y, z] = rotateVector(quatFromYaw(Math.PI / 2), [1, 0, 0])
    expectClose(x, 0)
    expectClose(y, 1)
    expectClose(z, 0)
  })

  it("cae a la identidad cuando el cuaternión llega en cero", () => {
    // Un struct a medio llenar deja (0,0,0,0), que como matriz es degenerada:
    // sin este saneo la pieza desaparece sin ningún error visible.
    expect(normalizeQuat([0, 0, 0, 0])).toEqual([1, 0, 0, 0])
  })
})

describe("marco wall-blue (WPILib <= 2026)", () => {
  const transform = frameTransform("wall-blue", SIZE, "blue")

  it("manda la esquina azul al borde -X del modelo", () => {
    const result = toFieldFrame(pose(0, 0), transform)
    expectClose(result.x, -HALF_X)
    expectClose(result.y, -HALF_Y)
  })

  it("manda la esquina roja al borde +X", () => {
    const result = toFieldFrame(pose(SIZE.length, SIZE.width), transform)
    expectClose(result.x, HALF_X)
    expectClose(result.y, HALF_Y)
  })

  it("no toca la orientación: los ejes ya apuntan igual", () => {
    const result = toFieldFrame(pose(3, 2, 0, 1.1), transform)
    expectClose(yawOf([result.qw, result.qx, result.qy, result.qz]), 1.1)
  })

  it("no depende de la alianza", () => {
    const red = frameTransform("wall-blue", SIZE, "red")
    expect(red.offset).toEqual(transform.offset)
  })
})

describe("marco wall-alliance", () => {
  it("con la alianza azul es idéntico a wall-blue", () => {
    const alliance = frameTransform("wall-alliance", SIZE, "blue")
    const blue = frameTransform("wall-blue", SIZE, "blue")
    expect(alliance.offset).toEqual(blue.offset)
    expect(alliance.rotation).toEqual(blue.rotation)
  })

  it("con la alianza roja el origen salta a la pared roja", () => {
    const transform = frameTransform("wall-alliance", SIZE, "red")
    const result = toFieldFrame(pose(0, 0), transform)
    expectClose(result.x, HALF_X)
    expectClose(result.y, HALF_Y)
  })

  it("con la alianza roja la orientación gira media vuelta", () => {
    const transform = frameTransform("wall-alliance", SIZE, "red")
    const result = toFieldFrame(pose(1, 1, 0, 0), transform)
    expectClose(Math.abs(yawOf([result.qw, result.qx, result.qy, result.qz])), Math.PI)
  })
})

describe("marco center-red (WPILib 2027+)", () => {
  it("ya es el marco del modelo", () => {
    const transform = frameTransform("center-red", SIZE, "blue")
    const result = toFieldFrame(pose(2.5, -1.5, 0.8, 0.6), transform)
    expectClose(result.x, 2.5)
    expectClose(result.y, -1.5)
    expectClose(result.z, 0.8)
    expectClose(yawOf([result.qw, result.qx, result.qy, result.qz]), 0.6)
  })
})

describe("marco center-rotated (FTC)", () => {
  it("gira un cuarto de vuelta", () => {
    const transform = frameTransform("center-rotated", SIZE, "blue")
    const result = toFieldFrame(pose(1, 0), transform)
    expectClose(result.x, 0)
    expectClose(result.y, -1)
  })
})

describe("ida y vuelta", () => {
  // La lectura de coordenadas bajo el puntero tiene que mostrar los MISMOS
  // números que vería uno en el código del robot, así que la inversa no puede
  // ser aproximada.
  const cases = ["wall-blue", "wall-alliance", "center-red", "center-rotated"] as const

  for (const system of cases) {
    for (const alliance of ["blue", "red"] as const) {
      it(`${system} / ${alliance} vuelve al punto de partida`, () => {
        const transform = frameTransform(system, SIZE, alliance)
        const original = pose(3.4, -1.2, 0.75, 0.9)
        const back = fromFieldFrame(toFieldFrame(original, transform), transform)

        expectClose(back.x, original.x, 8)
        expectClose(back.y, original.y, 8)
        expectClose(back.z, original.z, 8)
        expectClose(yawOf([back.qw, back.qx, back.qy, back.qz]), 0.9, 8)
      })
    }
  }
})

describe("composePose", () => {
  it("suma traslaciones cuando el padre no gira", () => {
    const result = composePose(pose(1, 2, 3), pose(0.5, 0, 0.25))
    expectClose(result.x, 1.5)
    expectClose(result.y, 2)
    expectClose(result.z, 3.25)
  })

  it("gira el hijo con el padre", () => {
    // Un componente a 1 m adelante del robot, con el robot mirando a +Y,
    // termina 1 m a la izquierda en la cancha.
    const result = composePose(pose(0, 0, 0, Math.PI / 2), pose(1, 0, 0))
    expectClose(result.x, 0)
    expectClose(result.y, 1)
  })

  it("acumula las orientaciones", () => {
    const result = composePose(pose(0, 0, 0, 0.4), pose(0, 0, 0, 0.3))
    expectClose(yawOf([result.qw, result.qx, result.qy, result.qz]), 0.7)
  })
})
