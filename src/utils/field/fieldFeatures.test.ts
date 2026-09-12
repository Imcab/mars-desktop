import { describe, it, expect } from "vitest"
import { toInternal, fromInternal, flipInternal, CoordinateSystem } from "./fieldImages"
import { PoseHistory, HistoryStore } from "./poseHistory"
import { Heatmap, signatureOf } from "./heatmap"
import {
  defaultObjectTypeFor, normalizeFieldObjects, normalizeFieldSettings,
  resolveObjectOptions, isFieldDroppable, needsRobotAnchor,
  nextObjectLabel, FIELD_OBJECT_ICONS, FIELD_OBJECT_TYPES,
} from "./fieldObjects"
import { defaultFieldSettings, FieldObjectConfig } from "../../store/appStore"

const SIZE: [number, number] = [16.535, 8.069]

describe("fromInternal", () => {
  const SYSTEMS: CoordinateSystem[] = ["wall_blue", "center", "center_rotated"]

  it("deshace toInternal en los tres sistemas", () => {
    // Es la cuenta que hace la lectura del cursor: el punto que uno señala en
    // pantalla tiene que salir en los mismos números que publica el robot.
    for (const system of SYSTEMS) {
      const internal = toInternal(system, 3.2, 1.7, 0.9, SIZE)
      const back = fromInternal(system, internal.x, internal.y, internal.theta, SIZE)
      expect(back.x).toBeCloseTo(3.2, 9)
      expect(back.y).toBeCloseTo(1.7, 9)
      expect(back.theta).toBeCloseTo(0.9, 9)
    }
  })
})

describe("flipInternal", () => {
  it("es una media vuelta, así que aplicarla dos veces no cambia nada", () => {
    const once = flipInternal({ x: 2, y: -1, theta: 0.5 })
    expect(once.x).toBe(-2)
    expect(once.y).toBe(1)

    const twice = flipInternal(once)
    expect(twice.x).toBeCloseTo(2, 9)
    expect(twice.y).toBeCloseTo(-1, 9)
    expect(Math.cos(twice.theta)).toBeCloseTo(Math.cos(0.5), 9)
  })
})

describe("PoseHistory", () => {
  it("descarta el valor repetido que devuelve el poll entre publicaciones", () => {
    // El poll corre a 30 Hz y el robot puede publicar a 10: sin este filtro,
    // el mapa de calor contaría el mismo instante tres veces.
    const history = new PoseHistory()
    history.push([{ x: 1, y: 2, theta: 0 }], 1000)
    history.push([{ x: 1, y: 2, theta: 0 }], 1100)
    history.push([{ x: 1.5, y: 2, theta: 0 }], 1200)

    expect(history.length).toBe(2)
  })

  it("ignora las muestras que llegan más rápido que el período mínimo", () => {
    const history = new PoseHistory()
    history.push([{ x: 0, y: 0, theta: 0 }], 1000)
    history.push([{ x: 5, y: 5, theta: 0 }], 1010)

    expect(history.length).toBe(1)
  })

  it("no guarda estela de un array largo: eso es una trayectoria", () => {
    const history = new PoseHistory()
    const path = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, theta: 0 }))
    history.push(path, 1000)

    expect(history.length).toBe(0)
  })

  it("since() devuelve solo la ventana pedida", () => {
    const history = new PoseHistory()
    for (let i = 0; i < 10; i++) {
      history.push([{ x: i, y: 0, theta: 0 }], 1000 + i * 100)
    }

    // Las muestras van de t=1000 a t=1900. Los últimos 0.5 s son de t=1400.
    const recent = history.since(0.5, 1900)
    expect(recent.length).toBe(6)
    expect(recent[0].x).toBe(4)
  })

  it("descarta un valor no finito sin cortar la serie", () => {
    const history = new PoseHistory()
    history.push([{ x: NaN, y: 0, theta: 0 }], 1000)
    history.push([{ x: 1, y: 0, theta: 0 }], 1100)

    expect(history.length).toBe(1)
  })
})

describe("HistoryStore", () => {
  it("olvida los objetos que se quitaron del panel", () => {
    const store = new HistoryStore()
    store.get("a").push([{ x: 0, y: 0, theta: 0 }], 1000)
    store.get("b").push([{ x: 1, y: 1, theta: 0 }], 1000)

    store.prune(["a"])

    expect(store.get("a").length).toBe(1)
    // Pedirlo de nuevo crea uno vacío: el de "b" ya no existe.
    expect(store.get("b").length).toBe(0)
  })
})

describe("Heatmap", () => {
  const frame = { sizeMeters: SIZE, cell: 0.2, radius: 0.6 }

  it("arranca vacío y se llena con una muestra dentro de la cancha", () => {
    const heatmap = new Heatmap(frame)
    expect(heatmap.isEmpty).toBe(true)

    heatmap.add([{ x: 0, y: 0 }])
    expect(heatmap.isEmpty).toBe(false)
  })

  it("ignora una pose que cae fuera del área de juego", () => {
    // Pasa de verdad: con el sistema de coordenadas mal elegido las poses se
    // van contra la pared, y recortarlas contra el borde dejaría una banda
    // caliente que no significa nada.
    const heatmap = new Heatmap(frame)
    heatmap.add([{ x: 500, y: 500 }])
    expect(heatmap.isEmpty).toBe(true)
  })

  it("la firma cambia si cambia la cancha o algún parámetro", () => {
    expect(signatureOf(frame)).toBe(signatureOf({ ...frame }))
    expect(signatureOf(frame)).not.toBe(signatureOf({ ...frame, cell: 0.3 }))
    expect(signatureOf(frame)).not.toBe(signatureOf({ ...frame, sizeMeters: [16, 8] }))
  })
})

describe("defaultObjectTypeFor", () => {
  it("manda el nombre por encima de la forma del topic", () => {
    expect(defaultObjectTypeFor("/Vision/Targets", "struct:Pose2d[]")).toBe("target")
    expect(defaultObjectTypeFor("/Auto/Trajectory", "struct:Pose2d[]")).toBe("trajectory")
    expect(defaultObjectTypeFor("/Drive/Setpoint", "struct:Pose2d")).toBe("ghost")
  })

  it("un array sin pistas en el nombre es una trayectoria y una pose suelta el robot", () => {
    expect(defaultObjectTypeFor("/Odometry/Samples", "struct:Pose2d[]")).toBe("trajectory")
    expect(defaultObjectTypeFor("/Odometry/Pose", "struct:Pose2d")).toBe("robot")
  })

  it("un SwerveModuleState[] entra como módulos y no como trayectoria", () => {
    expect(defaultObjectTypeFor("/Drive/States", "struct:SwerveModuleState[]")).toBe("swerve")
    expect(isFieldDroppable("struct:SwerveModuleState[]")).toBe(true)
  })
})

describe("needsRobotAnchor", () => {
  it("marca los tipos que no tienen pose propia", () => {
    expect(needsRobotAnchor("swerve")).toBe(true)
    expect(needsRobotAnchor("target")).toBe(true)
    expect(needsRobotAnchor("robot")).toBe(false)
  })
})

describe("resolveObjectOptions", () => {
  const base: FieldObjectConfig = {
    id: "1", topicName: "/Pose", topicType: "struct:Pose2d",
    label: "Pose", type: "robot", color: "#2f6fdb",
  }

  it("un objeto sin opciones toma los defaults del panel", () => {
    const opts = resolveObjectOptions(base, defaultFieldSettings)
    expect(opts.trailSeconds).toBe(defaultFieldSettings.trailSeconds)
    expect(opts.opacity).toBe(1)
    expect(opts.useModel).toBe(false)
  })

  it("el interruptor general apaga la estela aunque el objeto fije la suya", () => {
    const settings = { ...defaultFieldSettings, showTrails: false }
    const opts = resolveObjectOptions({ ...base, trailSeconds: 8 }, settings)
    expect(opts.trailSeconds).toBe(0)
  })

  it("el modo de dibujo del panel es el default y el objeto lo puede pisar", () => {
    const settings = { ...defaultFieldSettings, robotRender: "model" as const }
    expect(resolveObjectOptions(base, settings).useModel).toBe(true)
    expect(resolveObjectOptions({ ...base, useModel: false }, settings).useModel).toBe(false)
  })
})

describe("normalizeFieldObjects", () => {
  it("descarta entradas sin id o sin topic", () => {
    const out = normalizeFieldObjects([
      { id: "1", topicName: "/A", type: "robot", color: "#fff" },
      { topicName: "/B" },
      null,
    ])
    expect(out.length).toBe(1)
  })

  it("un tipo desconocido cae al robot en vez de dejar el objeto sin dibujar", () => {
    const out = normalizeFieldObjects([{ id: "1", topicName: "/A", type: "teleporter" }])
    expect(out[0].type).toBe("robot")
  })

  it("no deja pasar un NaN a las opciones numéricas", () => {
    const out = normalizeFieldObjects([
      { id: "1", topicName: "/A", type: "robot", trailSeconds: NaN, heatmapCell: 0.25 },
    ])
    expect(out[0].trailSeconds).toBeUndefined()
    expect(out[0].heatmapCell).toBe(0.25)
  })
})

describe("normalizeFieldSettings", () => {
  it("un layout viejo (chasis cuadrado) hereda el ancho del largo", () => {
    const settings = normalizeFieldSettings({ robotSizeMeters: 0.9 })
    expect(settings.robotSizeMeters).toBe(0.9)
    expect(settings.robotWidthMeters).toBe(0.9)
  })

  it("rellena los campos que la versión anterior no guardaba", () => {
    const settings = normalizeFieldSettings({ orientation: 90, showGrid: false })
    expect(settings.orientation).toBe(90)
    expect(settings.showGrid).toBe(false)
    expect(settings.robotRender).toBe("icon")
    expect(settings.gridSpacing).toBe(defaultFieldSettings.gridSpacing)
  })

  it("acota los números que se dibujan como geometría", () => {
    const settings = normalizeFieldSettings({
      robotSizeMeters: NaN,
      gridSpacing: 0,
      robotModelScale: -3,
      orientation: 45,
    })
    expect(settings.robotSizeMeters).toBe(defaultFieldSettings.robotSizeMeters)
    expect(settings.gridSpacing).toBe(0.1)
    expect(settings.robotModelScale).toBeGreaterThan(0)
    expect(settings.orientation).toBe(0)
  })

  it("un layout inexistente devuelve los defaults completos", () => {
    expect(normalizeFieldSettings(undefined)).toEqual(defaultFieldSettings)
  })
})

describe("nextObjectLabel", () => {
  it("numera las repeticiones del mismo topic", () => {
    // Es lo que permite tener /Odometry/Pose como chasis y otra vez como mapa
    // de calor, sin publicar la pose dos veces desde el robot.
    const objects = [{ topicName: "/Odometry/Pose" }]
    expect(nextObjectLabel([], "/Odometry/Pose")).toBe("Pose")
    expect(nextObjectLabel(objects, "/Odometry/Pose")).toBe("Pose (2)")
    expect(nextObjectLabel([...objects, { topicName: "/Odometry/Pose" }], "/Odometry/Pose"))
      .toBe("Pose (3)")
  })

  it("no numera un topic distinto", () => {
    expect(nextObjectLabel([{ topicName: "/A/Pose" }], "/B/Pose")).toBe("Pose")
  })

  it("acepta un nombre base propio (el del Field2d, que no es la hoja)", () => {
    expect(nextObjectLabel([], "/SmartDashboard/Field/Robot", "Field")).toBe("Field")
  })
})

describe("trailColor", () => {
  const base: FieldObjectConfig = {
    id: "1", topicName: "/Pose", topicType: "struct:Pose2d",
    label: "Pose", type: "robot", color: "#2f6fdb",
  }

  it("sin color propio la estela hereda el del objeto", () => {
    expect(resolveObjectOptions(base, defaultFieldSettings).trailColor).toBeNull()
  })

  it("con color propio lo devuelve tal cual", () => {
    const opts = resolveObjectOptions({ ...base, trailColor: "#d63b3b" }, defaultFieldSettings)
    expect(opts.trailColor).toBe("#d63b3b")
  })

  it("sobrevive al guardado y la carga del layout", () => {
    const out = normalizeFieldObjects([{ ...base, trailColor: "#d63b3b" }])
    expect(out[0].trailColor).toBe("#d63b3b")
    expect(normalizeFieldObjects([{ ...base, trailColor: 42 }])[0].trailColor).toBeUndefined()
  })
})

describe("HistoryStore.copy", () => {
  it("el objeto duplicado hereda lo que ya había juntado el original", () => {
    const store = new HistoryStore()
    store.get("robot").push([{ x: 1, y: 1, theta: 0 }], 1000)
    store.get("robot").push([{ x: 2, y: 2, theta: 0 }], 1100)

    store.copy("robot", "heatmap")
    expect(store.get("heatmap").length).toBe(2)

    // Y son copias: seguir alimentando al original no toca al duplicado.
    store.get("robot").push([{ x: 3, y: 3, theta: 0 }], 1200)
    expect(store.get("heatmap").length).toBe(2)
  })

  it("copiar desde un id que no existe no crea nada raro", () => {
    const store = new HistoryStore()
    store.copy("nope", "nuevo")
    expect(store.get("nuevo").length).toBe(0)
  })
})

describe("FIELD_OBJECT_ICONS", () => {
  it("cada tipo tiene icono, con respaldo tabler para el que no tenga SVG", () => {
    for (const type of FIELD_OBJECT_TYPES) {
      const icon = FIELD_OBJECT_ICONS[type]
      expect(icon.svg.endsWith(".svg")).toBe(true)
      expect(icon.fallback.startsWith("ti-")).toBe(true)
    }
  })
})
