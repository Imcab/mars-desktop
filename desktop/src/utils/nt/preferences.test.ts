import { describe, it, expect } from "vitest"
import {
  preferenceKeyOf, preferenceKind, collectPreferences, preferenceTopicName,
  parsePreferenceValue, formatPreferenceValue, defaultValueFor,
  javaInit, javaGet, javaRemove, javaVariableName, javaInitBlock, javaGetBlock,
} from "./preferences"
import { TopicAnnounce } from "../../store/appStore"

function topicMap(entries: [string, string][]): Map<string, TopicAnnounce> {
  const map = new Map<string, TopicAnnounce>()
  entries.forEach(([name, type], i) => map.set(name, { id: i, name, topic_type: type }))
  return map
}

describe("claves", () => {
  it("recorta el prefijo de la tabla", () => {
    expect(preferenceKeyOf("/Preferences/kP")).toBe("kP")
    expect(preferenceKeyOf("/Preferences/Arm/offset")).toBe("Arm/offset")
  })

  it("ignora lo que no cuelga de /Preferences", () => {
    expect(preferenceKeyOf("/SmartDashboard/kP")).toBeNull()
    expect(preferenceKeyOf("/Preferences")).toBeNull()
  })

  it("descarta el .type con el que WPILib marca la tabla", () => {
    expect(preferenceKeyOf("/Preferences/.type")).toBeNull()
  })

  it("preferenceTopicName es la vuelta", () => {
    expect(preferenceTopicName("Arm/kP")).toBe("/Preferences/Arm/kP")
    expect(preferenceKeyOf(preferenceTopicName("kP"))).toBe("kP")
  })
})

describe("tipos", () => {
  it("mapea los tipos que Preferences sabe guardar", () => {
    expect(preferenceKind("double")).toBe("double")
    expect(preferenceKind("int")).toBe("int")
    expect(preferenceKind("float")).toBe("float")
    expect(preferenceKind("boolean")).toBe("boolean")
    expect(preferenceKind("string")).toBe("string")
  })

  it("rechaza lo que Preferences no puede guardar", () => {
    expect(preferenceKind("double[]")).toBeNull()
    expect(preferenceKind("struct:Pose2d")).toBeNull()
  })
})

describe("collectPreferences", () => {
  it("junta solo las preferencias y las ordena por clave", () => {
    const rows = collectPreferences(topicMap([
      ["/Preferences/zLast", "double"],
      ["/Preferences/aFirst", "boolean"],
      ["/Preferences/.type", "string"],
      ["/SmartDashboard/other", "double"],
      ["/Preferences/weird", "double[]"],
    ]))

    expect(rows.map(r => r.key)).toEqual(["aFirst", "zLast"])
    expect(rows[0].kind).toBe("boolean")
  })

  it("una tabla vacía no rompe nada", () => {
    expect(collectPreferences(new Map())).toEqual([])
  })
})

describe("valores", () => {
  it("parsea números y respeta el entero", () => {
    expect(parsePreferenceValue("double", "0.3")).toBe(0.3)
    expect(parsePreferenceValue("int", "2.7")).toBe(3)
  })

  it("un número a medio escribir devuelve null en vez de NaN", () => {
    expect(parsePreferenceValue("double", "")).toBeNull()
    expect(parsePreferenceValue("double", "abc")).toBeNull()
  })

  it("acepta las dos escrituras de un booleano", () => {
    expect(parsePreferenceValue("boolean", "true")).toBe(true)
    expect(parsePreferenceValue("boolean", "1")).toBe(true)
    expect(parsePreferenceValue("boolean", "FALSE")).toBe(false)
    expect(parsePreferenceValue("boolean", "quizás")).toBeNull()
  })

  it("un string vacío es un string válido", () => {
    expect(parsePreferenceValue("string", "")).toBe("")
  })

  it("formatea para la caja de edición", () => {
    expect(formatPreferenceValue(true)).toBe("true")
    expect(formatPreferenceValue(0.3)).toBe("0.3")
    expect(formatPreferenceValue(undefined)).toBe("")
  })

  it("cada tipo tiene un valor inicial sensato", () => {
    expect(defaultValueFor("boolean")).toBe(false)
    expect(defaultValueFor("string")).toBe("")
    expect(defaultValueFor("double")).toBe(0)
  })
})

describe("Java", () => {
  it("declara con el init del tipo", () => {
    expect(javaInit("kP", "double", 0.3)).toBe('Preferences.initDouble("kP", 0.3);')
    expect(javaInit("useVision", "boolean", true)).toBe('Preferences.initBoolean("useVision", true);')
    expect(javaInit("mode", "string", "auto")).toBe('Preferences.initString("mode", "auto");')
    expect(javaInit("slot", "int", 2)).toBe('Preferences.initInt("slot", 2);')
  })

  it("un float lleva su sufijo y un double su punto", () => {
    expect(javaInit("k", "float", 1)).toBe('Preferences.initFloat("k", 1.0f);')
    expect(javaInit("k", "double", 1)).toBe('Preferences.initDouble("k", 1.0);')
  })

  it("escapa comillas en la clave y en el valor", () => {
    expect(javaInit('we"ird', "string", 'a"b')).toBe('Preferences.initString("we\\"ird", "a\\"b");')
  })

  it("la lectura usa el valor actual como respaldo", () => {
    expect(javaGet("kP", "double", 0.3)).toBe('double kP = Preferences.getDouble("kP", 0.3);')
  })

  it("una clave con barras da un nombre de variable usable", () => {
    expect(javaVariableName("Arm/kP")).toBe("armKP")
    expect(javaVariableName("2ndStage")).toBe("v2ndStage")
    expect(javaGet("Arm/offset", "double", 1)).toContain("double armOffset =")
  })

  it("permite forzar el nombre de la variable", () => {
    expect(javaGet("kP", "double", 0.3, "armKp")).toContain("double armKp =")
  })

  it("remove es la línea que de verdad borra", () => {
    expect(javaRemove("kP")).toBe('Preferences.remove("kP");')
  })

  it("los bloques traen el import una sola vez", () => {
    const rows = [
      { key: "kP", kind: "double" as const, value: 0.3 },
      { key: "useVision", kind: "boolean" as const, value: true },
    ]
    const init = javaInitBlock(rows)
    expect(init.match(/import /g)).toHaveLength(1)
    expect(init).toContain("import edu.wpi.first.wpilibj.Preferences;")
    expect(init).toContain("initDouble")
    expect(init).toContain("initBoolean")

    expect(javaGetBlock(rows)).toContain("getDouble")
    expect(javaInitBlock([])).toBe("")
  })
})
