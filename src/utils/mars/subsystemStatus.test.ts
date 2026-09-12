import { describe, it, expect } from "vitest"
import {
  hexToHsl, severityFromHex, severityOf, findStatusSubsystems, statusTopicNames,
  readSubsystemStatus, sortBySeverity, countBySeverity, hasCriticalAlerts,
  pushStatusChange, SubsystemStatus, StatusChange,
} from "./subsystemStatus"
import { TopicAnnounce } from "../../store/appStore"

const topic = (name: string, type = "string"): [string, TopicAnnounce] => [
  name, { id: 0, name, topic_type: type },
]

describe("hexToHsl", () => {
  it("convierte los colores base", () => {
    expect(hexToHsl("#ff0000")!.h).toBeCloseTo(0, 5)
    expect(hexToHsl("#00ff00")!.h).toBeCloseTo(120, 5)
    expect(hexToHsl("#0000ff")!.h).toBeCloseTo(240, 5)
  })

  it("acepta con y sin almohadilla, y la forma corta", () => {
    expect(hexToHsl("00ff00")!.h).toBeCloseTo(120, 5)
    expect(hexToHsl("#0f0")!.h).toBeCloseTo(120, 5)
  })

  it("marca los grises como sin saturación", () => {
    expect(hexToHsl("#808080")!.s).toBe(0)
  })

  it("devuelve null si no es un hex válido", () => {
    expect(hexToHsl("rojo")).toBeNull()
    expect(hexToHsl("#12345")).toBeNull()
    expect(hexToHsl("")).toBeNull()
  })
})

describe("severityFromHex", () => {
  it("clasifica los cuatro colores de GlobalColorCode", () => {
    // NOMINAL verde, WORKING amarillo, TIMEOUT naranja, HARDWARE_FAULT rojo.
    expect(severityFromHex("#00ff00")).toBe("ok")
    expect(severityFromHex("#ffff00")).toBe("warning")
    expect(severityFromHex("#ff8000")).toBe("error")
    expect(severityFromHex("#ff0000")).toBe("critical")
  })

  it("reconoce tonos oscuros del mismo color", () => {
    // Los equipos usan cosas como DarkGreen para IDLE.
    expect(severityFromHex("#006400")).toBe("ok")
    expect(severityFromHex("#8b0000")).toBe("critical")
  })

  it("no fuerza una severidad sobre colores que no la comunican", () => {
    // Pintar de rojo un estado que el equipo eligió celeste sería mentir.
    expect(severityFromHex("#0000ff")).toBe("unknown")
    expect(severityFromHex("#00ffff")).toBe("unknown")
    expect(severityFromHex("#800080")).toBe("unknown")
    expect(severityFromHex("#808080")).toBe("unknown")
    expect(severityFromHex("#000000")).toBe("unknown")
  })

  it("devuelve unknown sin color", () => {
    expect(severityFromHex(null)).toBe("unknown")
    expect(severityFromHex("no-soy-un-color")).toBe("unknown")
  })
})

describe("severityOf", () => {
  it("el nombre del código global gana sobre el color", () => {
    // Si el robot dice HARDWARE_FAULT, es crítico aunque haya mandado verde.
    expect(severityOf("HARDWARE_FAULT", "#00ff00")).toBe("critical")
    expect(severityOf("NOMINAL", "#ff0000")).toBe("ok")
    expect(severityOf("TIMEOUT", null)).toBe("error")
  })

  it("no distingue mayúsculas en el código", () => {
    expect(severityOf("nominal", null)).toBe("ok")
  })

  it("cae al color con códigos propios del equipo", () => {
    // ModuleColorCode.solid(...) define nombres arbitrarios.
    expect(severityOf("INTAKING", "#ffff00")).toBe("warning")
    expect(severityOf("ON_TARGET", "#00ff00")).toBe("ok")
  })
})

describe("findStatusSubsystems", () => {
  it("detecta los subsistemas por su topic Hex", () => {
    const topics = new Map([
      topic("/Arm/Status/Hex"),
      topic("/Arm/Status/Name"),
      topic("/Arm/Status/Message"),
      topic("/Drive/Status/Hex"),
      topic("/Drive/Status/Name"),
    ])
    expect(findStatusSubsystems(topics)).toEqual(["/Arm", "/Drive"])
  })

  it("ignora topics que no son strings", () => {
    // Un double llamado igual no es un estado de subsistema.
    const topics = new Map([topic("/Fake/Status/Hex", "double")])
    expect(findStatusSubsystems(topics)).toEqual([])
  })

  it("ordena con orden natural", () => {
    const topics = new Map([
      topic("/Module10/Status/Hex"),
      topic("/Module9/Status/Hex"),
    ])
    expect(findStatusSubsystems(topics)).toEqual(["/Module9", "/Module10"])
  })

  it("devuelve vacío si no hay ninguno", () => {
    expect(findStatusSubsystems(new Map([topic("/Otro/Cosa")]))).toEqual([])
  })
})

describe("statusTopicNames", () => {
  it("pide los tres topics de cada subsistema", () => {
    expect(statusTopicNames(["/Arm"])).toEqual([
      "/Arm/Status/Name", "/Arm/Status/Hex", "/Arm/Status/Message",
    ])
  })
})

describe("readSubsystemStatus", () => {
  it("arma el estado desde los valores de NT", () => {
    const values = {
      "/Arm/Status/Name": { String: "ON_TARGET" },
      "/Arm/Status/Hex": { String: "#00ff00" },
      "/Arm/Status/Message": { String: "Holding at 45.00 deg" },
    }
    const status = readSubsystemStatus(values, "/Arm")
    expect(status.name).toBe("Arm")
    expect(status.code).toBe("ON_TARGET")
    expect(status.message).toBe("Holding at 45.00 deg")
    expect(status.severity).toBe("ok")
  })

  it("usa el último segmento como nombre visible", () => {
    const status = readSubsystemStatus({}, "/Robot/Subsystems/Intake")
    expect(status.name).toBe("Intake")
  })

  it("sobrevive a un subsistema sin valores todavía", () => {
    const status = readSubsystemStatus({}, "/Arm")
    expect(status.code).toBeNull()
    expect(status.hex).toBeNull()
    expect(status.severity).toBe("unknown")
  })

  it("trata el string vacío como ausente", () => {
    const status = readSubsystemStatus({ "/Arm/Status/Hex": { String: "" } }, "/Arm")
    expect(status.hex).toBeNull()
  })
})

// ---------------------------------------------------------------------------

const make = (name: string, severity: SubsystemStatus["severity"]): SubsystemStatus => ({
  prefix: `/${name}`, name, code: null, hex: null, message: null, severity,
})

describe("orden y conteos", () => {
  it("pone los más graves primero", () => {
    const sorted = sortBySeverity([
      make("A", "ok"), make("B", "critical"), make("C", "warning"),
      make("D", "unknown"), make("E", "error"),
    ])
    expect(sorted.map(s => s.severity)).toEqual(["critical", "error", "warning", "ok", "unknown"])
  })

  it("desempata alfabéticamente dentro de la misma severidad", () => {
    const sorted = sortBySeverity([make("Zeta", "ok"), make("Alfa", "ok")])
    expect(sorted.map(s => s.name)).toEqual(["Alfa", "Zeta"])
  })

  it("cuenta por severidad", () => {
    const counts = countBySeverity([make("A", "ok"), make("B", "ok"), make("C", "critical")])
    expect(counts.ok).toBe(2)
    expect(counts.critical).toBe(1)
    expect(counts.error).toBe(0)
  })

  it("hasCriticalAlerts es el gate antes de habilitar", () => {
    expect(hasCriticalAlerts([make("A", "ok"), make("B", "error")])).toBe(false)
    expect(hasCriticalAlerts([make("A", "ok"), make("B", "critical")])).toBe(true)
  })
})

describe("pushStatusChange", () => {
  const status = (code: string, hex: string, message: string): SubsystemStatus => ({
    prefix: "/Arm", name: "Arm", code, hex, message, severity: "ok",
  })

  it("no agrega nada si el estado no cambió", () => {
    // A 4Hz de poll, sin esto el historial se llena de entradas idénticas y
    // tapa los cambios que importan.
    const first = pushStatusChange([], status("A", "#0f0", "m"), 1000)
    const second = pushStatusChange(first, status("A", "#0f0", "m"), 2000)
    expect(second).toHaveLength(1)
    expect(second).toBe(first) // misma referencia: no re-renderiza
  })

  it("agrega cuando cambia el código, el color o el mensaje", () => {
    let h: StatusChange[] = []
    h = pushStatusChange(h, status("A", "#0f0", "m"), 1000)
    h = pushStatusChange(h, status("B", "#0f0", "m"), 2000)
    h = pushStatusChange(h, status("B", "#f00", "m"), 3000)
    h = pushStatusChange(h, status("B", "#f00", "otro"), 4000)
    expect(h).toHaveLength(4)
  })

  it("recorta el historial al límite", () => {
    let h: StatusChange[] = []
    for (let i = 0; i < 20; i++) h = pushStatusChange(h, status(`C${i}`, "#0f0", "m"), i)
    expect(h).toHaveLength(12)
    // Se conservan los MÁS RECIENTES.
    expect(h[h.length - 1].code).toBe("C19")
  })
})
