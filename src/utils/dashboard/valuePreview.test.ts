import { describe, it, expect } from "vitest"
import { formatNumber, formatTopicValue, arrayLengthOf, formatArrayElement } from "./valuePreview"

function f64(...values: number[]): number[] {
  const buf = new ArrayBuffer(8 * values.length)
  const view = new DataView(buf)
  values.forEach((v, i) => view.setFloat64(i * 8, v, true))
  return [...new Uint8Array(buf)]
}

describe("formatNumber", () => {
  it("colapsa el ruido de punto flotante a cero", () => {
    expect(formatNumber(1e-12)).toBe("0")
    expect(formatNumber(-1e-12)).toBe("0")
  })

  it("usa notación científica en los extremos", () => {
    expect(formatNumber(123456)).toBe("1.2e5")
    expect(formatNumber(0.0001)).toBe("1.0e-4")
  })

  it("deja los enteros sin decimales", () => {
    expect(formatNumber(42)).toBe("42")
    expect(formatNumber(-7)).toBe("-7")
  })

  it("recorta los decimales a 3", () => {
    expect(formatNumber(3.14159265)).toBe("3.142")
  })
})

describe("formatTopicValue", () => {
  it("devuelve null cuando el topic todavía no tiene valor", () => {
    expect(formatTopicValue("double", undefined)).toBeNull()
    expect(formatTopicValue("double", null)).toBeNull()
  })

  it("formatea escalares", () => {
    expect(formatTopicValue("double", { Number: 12.5 })).toBe("12.500")
    expect(formatTopicValue("boolean", { Boolean: true })).toBe("true")
    expect(formatTopicValue("boolean", { Boolean: false })).toBe("false")
    expect(formatTopicValue("string", { String: "teleop" })).toBe("teleop")
  })

  it("resume arrays y corta los largos", () => {
    expect(formatTopicValue("double[]", { NumberArray: [1, 2, 3] })).toBe("[1, 2, 3]")
    expect(formatTopicValue("double[]", { NumberArray: [] })).toBe("empty")
    // Más de 6 elementos: se muestran los primeros y se marca el corte.
    const long = formatTopicValue("double[]", { NumberArray: [1, 2, 3, 4, 5, 6, 7, 8] })
    expect(long).toBe("[1, 2, 3, 4, 5, 6, …]")
  })

  it("aplana un struct suelto a campo: valor", () => {
    // Pose2d = X, Y, θ(radianes -> grados por isAngle)
    const text = formatTopicValue("struct:Pose2d", { Raw: f64(1.5, -2.25, Math.PI / 2) })
    expect(text).toBe("X: 1.50 m, Y: -2.25 m, θ: 90.00°")
  })

  it("resume un struct array por cantidad y tipo", () => {
    const text = formatTopicValue("struct:Pose2d[]", { Raw: f64(0, 0, 0, 1, 1, 0) })
    expect(text).toBe("2 × Pose2d")
  })

  it("informa el tamaño de un raw sin schema en vez de mostrar bytes", () => {
    expect(formatTopicValue("struct:TipoDesconocido", { Raw: [1, 2, 3, 4] })).toBe("4 bytes")
  })

  it("trunca los strings largos", () => {
    const long = "x".repeat(80)
    const text = formatTopicValue("string", { String: long })!
    expect(text.length).toBeLessThan(long.length)
    expect(text.endsWith("…")).toBe(true)
  })
})

describe("arrayLengthOf", () => {
  it("cuenta elementos de arrays planos", () => {
    expect(arrayLengthOf("double[]", { NumberArray: [1, 2, 3] })).toBe(3)
    expect(arrayLengthOf("string[]", { StringArray: ["a", "b"] })).toBe(2)
    expect(arrayLengthOf("boolean[]", { BooleanArray: [true] })).toBe(1)
  })

  it("divide por el tamaño de instancia en un struct array", () => {
    // 3 Pose2d de 24 bytes cada uno
    expect(arrayLengthOf("struct:Pose2d[]", { Raw: f64(0, 0, 0, 1, 1, 0, 2, 2, 0) })).toBe(3)
  })

  it("devuelve null para lo que no es un array", () => {
    expect(arrayLengthOf("double", { Number: 1 })).toBeNull()
    expect(arrayLengthOf("struct:Pose2d", { Raw: f64(0, 0, 0) })).toBeNull()
  })

  it("devuelve null si el struct array no tiene schema conocido", () => {
    expect(arrayLengthOf("struct:Desconocido[]", { Raw: [1, 2, 3] })).toBeNull()
  })
})

describe("formatArrayElement", () => {
  it("saca un escalar por índice", () => {
    expect(formatArrayElement("double[]", { NumberArray: [10, 20, 30] }, 1)).toBe("20")
    expect(formatArrayElement("boolean[]", { BooleanArray: [true, false] }, 1)).toBe("false")
  })

  it("decodifica UNA instancia de un struct array", () => {
    const value = { Raw: f64(0, 0, 0, 3.5, 4.5, 0) }
    expect(formatArrayElement("struct:Pose2d[]", value, 1)).toBe("X: 3.50 m, Y: 4.50 m, θ: 0.00°")
  })

  it("devuelve null si el índice se pasa del array", () => {
    expect(formatArrayElement("double[]", { NumberArray: [1] }, 5)).toBeNull()
    expect(formatArrayElement("struct:Pose2d[]", { Raw: f64(0, 0, 0) }, 3)).toBeNull()
  })
})
