import { describe, it, expect } from "vitest"
import { composeRotations, formatBytes, parseAssetConfig } from "./assetConfig"
import { rotateVector } from "./frames"

// Recorte del config.json real de `Field3d_2026FRCFieldV1`, el paquete oficial
// de AdvantageScope. Se copia literal (incluida la lista de piezas ya
// colocadas) para que los tests fallen si el parseo deja de aceptar el formato
// tal como lo publican.
const FIELD_2026 = JSON.stringify({
  name: "2026 Field",
  isFTC: false,
  coordinateSystem: "wall-blue",
  rotations: [{ axis: "x", degrees: 90 }],
  widthInches: 651.22,
  heightInches: 317.677,
  driverStations: [
    [8.2775425, -3.07975], [8.2775425, 0], [8.2775425, 3.07975],
    [-8.2775425, 3.07975], [-8.2775425, 0], [-8.2775425, -3.07975],
  ],
  gamePieces: [
    {
      name: "Fuel",
      rotations: [],
      position: [0, 0, 0],
      stagedObjects: ["GE-26900_Fuel", "GE-26900_Fuel_1"],
    },
  ],
  aprilTags: [
    { variant: "36h11-6.5in", id: 1, rotations: [{ axis: "z", degrees: 0 }], position: [-3.607, -3.39, 0.889] },
  ],
})

const ROBOT = JSON.stringify({
  name: "2026 KitBot",
  rotations: [{ axis: "z", degrees: 180 }],
  position: [0, 0, 0.05],
  cameras: [
    { name: "Front", rotations: [{ axis: "y", degrees: -20 }], position: [0.3, 0, 0.5], resolution: [1280, 800], fov: 75 },
  ],
  components: [
    { zeroedRotations: [{ axis: "y", degrees: 0 }], zeroedPosition: [0.1, 0, 0.2] },
    { zeroedRotations: [], zeroedPosition: [0, 0, 0.4] },
  ],
})

describe("config de cancha", () => {
  const config = parseAssetConfig(FIELD_2026)!

  it("se reconoce como cancha por traer el área de juego", () => {
    expect(config.kind).toBe("field")
  })

  it("pasa las pulgadas del config a los metros de la escena", () => {
    if (config.kind !== "field") throw new Error("no es una cancha")
    // 651.22 in = 16.541 m; es la cancha FRC de siempre.
    expect(config.size.length).toBeCloseTo(16.541, 3)
    expect(config.size.width).toBeCloseTo(8.069, 3)
  })

  it("lee el sistema de coordenadas, las driver stations y los tags", () => {
    if (config.kind !== "field") throw new Error("no es una cancha")
    expect(config.coordinateSystem).toBe("wall-blue")
    expect(config.driverStations).toHaveLength(6)
    expect(config.aprilTags[0].id).toBe(1)
    expect(config.aprilTags[0].position).toEqual([-3.607, -3.39, 0.889])
  })

  it("conserva los nodos de las piezas ya colocadas", () => {
    if (config.kind !== "field") throw new Error("no es una cancha")
    // De esta lista sale qué apagar cuando el robot publica sus propias
    // piezas, para no ver cada una dos veces.
    expect(config.gamePieces[0].stagedObjects).toEqual(["GE-26900_Fuel", "GE-26900_Fuel_1"])
  })

  it("las driver stations caen sobre las paredes de extremo", () => {
    if (config.kind !== "field") throw new Error("no es una cancha")
    const halfLength = config.size.length / 2
    config.driverStations.forEach(([x]) => {
      expect(Math.abs(Math.abs(x) - halfLength)).toBeLessThan(0.05)
    })
  })
})

describe("config de robot", () => {
  const config = parseAssetConfig(ROBOT)!

  it("se reconoce como robot por NO traer el área de juego", () => {
    expect(config.kind).toBe("robot")
  })

  it("lee cámaras y componentes", () => {
    if (config.kind !== "robot") throw new Error("no es un robot")
    expect(config.cameras[0].fov).toBe(75)
    expect(config.cameras[0].resolution).toEqual([1280, 800])
    expect(config.components).toHaveLength(2)
    expect(config.components[1].zeroedPosition).toEqual([0, 0, 0.4])
  })
})

describe("tolerancia a configs incompletos", () => {
  it("rechaza lo que no es JSON o no tiene nombre", () => {
    expect(parseAssetConfig("{ roto")).toBeNull()
    expect(parseAssetConfig("{}")).toBeNull()
    expect(parseAssetConfig("[]")).toBeNull()
  })

  it("un config mínimo sigue siendo usable", () => {
    // Escrito a mano, sin nada opcional: tiene que cargar igual.
    const config = parseAssetConfig(JSON.stringify({
      name: "Mi cancha", widthInches: 600, heightInches: 300,
    }))!
    if (config.kind !== "field") throw new Error("no es una cancha")
    expect(config.coordinateSystem).toBe("wall-blue")
    expect(config.rotations).toEqual([])
    expect(config.gamePieces).toEqual([])
    expect(config.defaultOrigin).toBe("auto")
  })

  it("descarta ejes inventados en vez de girar por un eje indefinido", () => {
    const config = parseAssetConfig(JSON.stringify({
      name: "R", rotations: [{ axis: "w", degrees: 90 }, { axis: "x", degrees: 90 }],
    }))!
    expect(config.rotations).toEqual([{ axis: "x", degrees: 90 }])
  })
})

describe("composeRotations", () => {
  it("sin giros devuelve la identidad", () => {
    expect(composeRotations([])).toEqual([1, 0, 0, 0])
  })

  it("un giro de +90° en X lleva un glTF (Y arriba) al marco Z arriba", () => {
    // Es exactamente lo que declara el config de la cancha 2026, y la razón
    // por la que el modelo se carga crudo en vez de rotarlo a ciegas.
    const [x, y, z] = rotateVector(composeRotations([{ axis: "x", degrees: 90 }]), [0, 1, 0])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(1, 9)
  })

  it("aplica los giros en el orden en que vienen", () => {
    // Primero +90° en Z (X pasa a +Y) y después +90° en X (Y pasa a +Z).
    const q = composeRotations([{ axis: "z", degrees: 90 }, { axis: "x", degrees: 90 }])
    const [x, y, z] = rotateVector(q, [1, 0, 0])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(1, 9)
  })
})

describe("formatBytes", () => {
  it("elige la unidad según el tamaño", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(4096)).toBe("4 KB")
    expect(formatBytes(18_182_328)).toBe("17.3 MB")
  })
})
