import { describe, it, expect } from "vitest"
import { FIELDS, getField, toInternal, SCHEMATIC_FIELD_KEY } from "./fieldImages"
import { extractField2dObjects, field2dTopicNames, findField2dTables, isField2dTable } from "./field2d"
import { TopicAnnounce } from "../../store/appStore"

// El tamaño real de la cancha 2026, para que las cuentas se lean como en la
// vida real y no como números inventados.
const SIZE: [number, number] = [16.535, 8.069]
const HALF_X = SIZE[0] / 2
const HALF_Y = SIZE[1] / 2

describe("registro de canchas", () => {
  it("carga las canchas que hay en public/fields", () => {
    expect(FIELDS.length).toBeGreaterThan(0)
  })

  it("parsea el JSON de Elastic con claves de guion bajo", () => {
    const field = FIELDS.find(f => f.game === "Rebuilt")
    expect(field).toBeDefined()
    expect(field!.sizeMeters).toEqual(SIZE)
    expect(field!.topLeft).toEqual([524, 94])
    expect(field!.bottomRight).toEqual([3378, 1490])
    expect(field!.coordinateSystem).toBe("wall_blue")
  })

  it("resuelve la imagen a una URL servible y no a la ruta interna de Elastic", () => {
    // El JSON dice "assets/fields/frc/2026-field.png", que es la ruta DENTRO
    // de Elastic; en esta app el archivo se sirve desde public/.
    const field = FIELDS.find(f => f.game === "Rebuilt")!
    expect(field.imageUrl).toBe("/fields/2026-field.png")
  })

  it("devuelve null para una clave desconocida", () => {
    expect(getField(SCHEMATIC_FIELD_KEY)).toBeNull()
    expect(getField("no-existe")).toBeNull()
  })
})

describe("toInternal", () => {
  // El marco interno tiene el origen en el centro del área de juego, +X hacia
  // la derecha de la imagen y +Y hacia arriba.

  describe("wall_blue (WPILib ≤2026)", () => {
    // En la imagen 2026 el AZUL está a la derecha, así que el origen de
    // coordenadas del robot (esquina azul) tiene que caer en +X interno.
    it("manda la esquina azul (0,0) al lado derecho", () => {
      const p = toInternal("wall_blue", 0, 0, 0, SIZE)
      expect(p.x).toBeCloseTo(HALF_X)
      expect(p.y).toBeCloseTo(HALF_Y)
    })

    it("manda la esquina roja opuesta al lado izquierdo", () => {
      const p = toInternal("wall_blue", SIZE[0], SIZE[1], 0, SIZE)
      expect(p.x).toBeCloseTo(-HALF_X)
      expect(p.y).toBeCloseTo(-HALF_Y)
    })

    it("deja el centro de la cancha en el origen", () => {
      const p = toInternal("wall_blue", HALF_X, HALF_Y, 0, SIZE)
      expect(p.x).toBeCloseTo(0)
      expect(p.y).toBeCloseTo(0)
    })

    it("gira media vuelta el ángulo", () => {
      // El robot apuntando a +X (hacia el rojo) tiene que dibujarse apuntando
      // a la izquierda de la pantalla.
      expect(toInternal("wall_blue", 0, 0, 0, SIZE).theta).toBeCloseTo(Math.PI)
    })
  })

  describe("center (WPILib 2027+)", () => {
    it("es la identidad: ya está en el marco interno", () => {
      const p = toInternal("center", 3, -2, 1.25, SIZE)
      expect(p.x).toBe(3)
      expect(p.y).toBe(-2)
      expect(p.theta).toBe(1.25)
    })
  })

  describe("center_rotated (FTC)", () => {
    it("intercambia los ejes y gira un cuarto de vuelta", () => {
      const p = toInternal("center_rotated", 1, 2, 0, SIZE)
      expect(p.x).toBe(2)
      expect(p.y).toBe(-1)
      expect(p.theta).toBeCloseTo(-Math.PI / 2)
    })
  })
})

// ---------------------------------------------------------------------------

const topic = (name: string, type: string): [string, TopicAnnounce] => [
  name,
  { id: 0, name, topic_type: type },
]

const FIELD_TOPICS = new Map<string, TopicAnnounce>([
  topic("/SmartDashboard/Field/.type", "string"),
  topic("/SmartDashboard/Field/Robot", "double[]"),
  topic("/SmartDashboard/Field/Trajectory", "double[]"),
  topic("/SmartDashboard/Field/Note", "double[]"),
  topic("/SmartDashboard/Field/SomeLabel", "string"),
  topic("/Other/Thing", "double"),
])

const PREFIX = "/SmartDashboard/Field"

describe("Field2d", () => {
  it("reconoce la tabla por su .type y no por su forma", () => {
    const types = { [PREFIX]: "Field2d", "/SmartDashboard/Chooser": "String Chooser" }
    expect(isField2dTable(types, PREFIX)).toBe(true)
    expect(isField2dTable(types, "/SmartDashboard/Chooser")).toBe(false)
    expect(findField2dTables(types)).toEqual([PREFIX])
  })

  it("solo toma los subtopics que pueden ser una pose", () => {
    const names = field2dTopicNames(FIELD_TOPICS, PREFIX)
    // Quedan fuera: ".type" (metadata), el string suelto y lo que no cuelga
    // del prefijo.
    expect(names.sort()).toEqual([
      "/SmartDashboard/Field/Note",
      "/SmartDashboard/Field/Robot",
      "/SmartDashboard/Field/Trajectory",
    ])
  })

  it("distingue robot, trayectoria y objetos sueltos", () => {
    const manyPoses: number[] = []
    for (let i = 0; i < 12; i++) manyPoses.push(i, i, 0)

    const values = {
      "/SmartDashboard/Field/Robot": { NumberArray: [1, 2, 90] },
      "/SmartDashboard/Field/Trajectory": { NumberArray: manyPoses },
      "/SmartDashboard/Field/Note": { NumberArray: [5, 5, 0] },
    }

    const objects = extractField2dObjects(values, FIELD_TOPICS, PREFIX)
    const byName = Object.fromEntries(objects.map(o => [o.name, o]))

    expect(byName.Robot.isRobot).toBe(true)
    expect(byName.Robot.poses).toHaveLength(1)
    // Field2d publica el ángulo en GRADOS; extractPoses lo pasa a radianes.
    expect(byName.Robot.poses[0].theta).toBeCloseTo(Math.PI / 2)

    expect(byName.Trajectory.isTrajectory).toBe(true)
    expect(byName.Trajectory.poses).toHaveLength(12)

    // Tres números = una sola pose: es un objeto suelto, no una trayectoria.
    expect(byName.Note.isTrajectory).toBe(false)
    expect(byName.Note.isRobot).toBe(false)
  })

  it("clasifica como trayectoria por el nombre aunque traiga pocas poses", () => {
    const values = { "/SmartDashboard/Field/Trajectory": { NumberArray: [0, 0, 0, 1, 1, 0] } }
    const objects = extractField2dObjects(values, FIELD_TOPICS, PREFIX)
    expect(objects.find(o => o.name === "Trajectory")!.isTrajectory).toBe(true)
  })

  it("dibuja el robot al final para que quede encima del resto", () => {
    const values = {
      "/SmartDashboard/Field/Robot": { NumberArray: [1, 2, 0] },
      "/SmartDashboard/Field/Note": { NumberArray: [5, 5, 0] },
    }
    const objects = extractField2dObjects(values, FIELD_TOPICS, PREFIX)
    expect(objects[objects.length - 1].isRobot).toBe(true)
  })

  it("ignora los topics sin valor todavía", () => {
    const objects = extractField2dObjects({}, FIELD_TOPICS, PREFIX)
    expect(objects).toEqual([])
  })
})
