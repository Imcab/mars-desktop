import { describe, it, expect } from "vitest"
import {
  defaultField3dTypeFor, isField3dDroppable, nextField3dLabel,
  normalizeField3dObjects, normalizeField3dSettings, resolveField3dOptions,
} from "./objects"
import { Field3dObjectConfig, defaultField3dSettings, EVERGREEN_FIELD_KEY } from "../../store/appStore"

function object(overrides: Partial<Field3dObjectConfig> = {}): Field3dObjectConfig {
  return {
    id: "1", topicName: "/Robot/Pose", topicType: "struct:Pose3d",
    label: "Pose", type: "robot", color: "#2f6fdb", ...overrides,
  }
}

describe("opciones resueltas", () => {
  it("el fantasma nace translúcido", () => {
    // Es lo que lo distingue del robot de verdad; tener que bajarle la
    // opacidad a mano cada vez sería absurdo.
    const ghost = resolveField3dOptions(object({ type: "ghost" }), defaultField3dSettings)
    expect(ghost.opacity).toBeLessThan(1)
    const robot = resolveField3dOptions(object({ type: "robot" }), defaultField3dSettings)
    expect(robot.opacity).toBe(1)
  })

  it("el interruptor general apaga todas las estelas", () => {
    const settings = { ...defaultField3dSettings, showTrails: false }
    const opts = resolveField3dOptions(object({ trailSeconds: 10 }), settings)
    expect(opts.trailSeconds).toBe(0)
  })

  it("un objeto sin estela propia hereda la de la pestaña", () => {
    const settings = { ...defaultField3dSettings, showTrails: true, trailSeconds: 7 }
    expect(resolveField3dOptions(object(), settings).trailSeconds).toBe(7)
  })

  it("el asset de robot cae al default de la pestaña", () => {
    const settings = { ...defaultField3dSettings, robotAssetKey: "Robot_Kit" }
    expect(resolveField3dOptions(object(), settings).robotAssetKey).toBe("Robot_Kit")
    expect(resolveField3dOptions(object({ robotAssetKey: "Robot_Mio" }), settings).robotAssetKey)
      .toBe("Robot_Mio")
  })

  it("sin cámara elegida la visión sale del centro del robot", () => {
    expect(resolveField3dOptions(object({ type: "vision" }), defaultField3dSettings).visionCameraIndex)
      .toBe(-1)
  })

  it("un número corrupto cae a su default en vez de dejar la malla invisible", () => {
    const opts = resolveField3dOptions(
      object({ trajectoryWidth: NaN, markerSize: -3 }),
      defaultField3dSettings,
    )
    expect(opts.trajectoryWidth).toBeGreaterThan(0)
    expect(opts.markerSize).toBeGreaterThan(0)
  })
})

describe("qué se puede soltar", () => {
  it("acepta geometría y rechaza el resto", () => {
    expect(isField3dDroppable("struct:Pose3d[]")).toBe(true)
    expect(isField3dDroppable("double[]")).toBe(true)
    expect(isField3dDroppable("boolean")).toBe(false)
  })
})

describe("tipo por defecto al soltar", () => {
  it("una pose suelta es el robot y un array es una trayectoria", () => {
    expect(defaultField3dTypeFor("/Odometry/Pose", "struct:Pose3d")).toBe("robot")
    expect(defaultField3dTypeFor("/Auto/Poses", "struct:Pose3d[]")).toBe("trajectory")
  })

  it("el nombre manda sobre la forma", () => {
    // Un `Targets` con tres poses no es un camino.
    expect(defaultField3dTypeFor("/Vision/Targets", "struct:Pose3d[]")).toBe("vision")
    expect(defaultField3dTypeFor("/Robot/Components", "struct:Pose3d[]")).toBe("component")
    expect(defaultField3dTypeFor("/Drive/Setpoint", "struct:Pose2d")).toBe("ghost")
    expect(defaultField3dTypeFor("/Shooter/Notes", "struct:Translation3d[]")).toBe("gamePiece")
  })
})

describe("etiquetas", () => {
  it("numera las repeticiones del mismo topic", () => {
    const objects = [object()]
    expect(nextField3dLabel(objects, "/Robot/Pose")).toBe("Pose (2)")
    expect(nextField3dLabel([], "/Robot/Pose")).toBe("Pose")
  })
})

describe("saneo de layouts guardados", () => {
  it("descarta entradas sin id ni topic", () => {
    expect(normalizeField3dObjects([{ id: "a" }, { topicName: "/x" }, null, 5])).toEqual([])
    expect(normalizeField3dObjects("no es un array")).toEqual([])
  })

  it("un tipo inventado cae al robot en vez de dejar el objeto sin dibujar", () => {
    const [result] = normalizeField3dObjects([{ id: "a", topicName: "/x", type: "hologram" }])
    expect(result.type).toBe("robot")
  })

  it("deja fuera los números que no son finitos", () => {
    // Un NaN acá deja la geometría en una matriz inválida y la pieza
    // desaparece sin ningún error visible.
    const [result] = normalizeField3dObjects([{
      id: "a", topicName: "/x", opacity: NaN, trajectoryWidth: "ancho", markerSize: Infinity,
    }])
    expect(result.opacity).toBeUndefined()
    expect(result.trajectoryWidth).toBeUndefined()
    expect(result.markerSize).toBeUndefined()
  })

  it("conserva lo que sí es válido", () => {
    const [result] = normalizeField3dObjects([{
      id: "a", topicName: "/x", type: "trajectory", color: "#fff",
      trajectoryStyle: "line", trajectoryWidth: 0.08, arrayFormat: "pose3d",
    }])
    expect(result.trajectoryStyle).toBe("line")
    expect(result.trajectoryWidth).toBe(0.08)
    expect(result.arrayFormat).toBe("pose3d")
  })
})

describe("saneo de los ajustes", () => {
  it("un layout vacío da los defaults", () => {
    const settings = normalizeField3dSettings(undefined)
    expect(settings.fieldKey).toBe(EVERGREEN_FIELD_KEY)
    expect(settings.quality).toBe("standard")
    expect(settings.cameraMode).toBe("orbit")
  })

  it("acota los índices y los rangos", () => {
    const settings = normalizeField3dSettings({
      driverStationIndex: 99, fov: 500, gridCell: 0, robotLength: -1, trailSeconds: 1e6,
    })
    expect(settings.driverStationIndex).toBeLessThanOrEqual(5)
    expect(settings.fov).toBeLessThanOrEqual(110)
    expect(settings.gridCell).toBeGreaterThan(0)
    expect(settings.robotLength).toBeGreaterThan(0)
    expect(settings.trailSeconds).toBeLessThanOrEqual(120)
  })

  it("un enum inventado cae a su default", () => {
    const settings = normalizeField3dSettings({
      quality: "ultra", cameraMode: "dron", origin: "verde", coordinateSystem: "polar",
    })
    expect(settings.quality).toBe("standard")
    expect(settings.cameraMode).toBe("orbit")
    expect(settings.origin).toBe("auto")
    // null = "usar el que declare el config de la cancha".
    expect(settings.coordinateSystem).toBeNull()
  })

  it("respeta un sistema de coordenadas válido", () => {
    expect(normalizeField3dSettings({ coordinateSystem: "center-red" }).coordinateSystem)
      .toBe("center-red")
  })
})
