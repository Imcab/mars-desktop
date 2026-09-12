import { describe, it, expect } from "vitest"
import { normalizeLayout } from "./workspacePersistence"
import { defaultMechanismSettings, defaultSwerveSettings, defaultFieldSettings } from "./appStore"

// Estas pruebas cubren la migración de layouts guardados por versiones
// anteriores. Es el punto donde agregar una herramienta nueva podría invalidar
// silenciosamente los layouts que la gente ya tenía en disco.

const tab = (overrides: Record<string, unknown> = {}) => ({
  id: "1",
  kind: "display",
  title: "Display",
  ...overrides,
})

describe("normalizeLayout", () => {
  it("rechaza cualquier cosa que no sea un objeto", () => {
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout("nope")).toBeNull()
    expect(normalizeLayout(42)).toBeNull()
  })

  it("acepta un layout sin pestañas", () => {
    const layout = normalizeLayout({ openTabs: [], activeTabId: null })
    expect(layout).not.toBeNull()
    expect(layout!.openTabs).toEqual([])
    expect(layout!.activeTabId).toBeNull()
  })

  it("rellena con defaults los campos que una versión vieja no guardó", () => {
    // Un layout escrito antes de que existiera la pestaña Mechanism no tiene
    // mechanismSources ni mechanismSettings.
    const layout = normalizeLayout({ openTabs: [tab({ kind: "swerve" })], activeTabId: "1" })
    const restored = layout!.openTabs[0]

    expect(restored.mechanismSources).toEqual([])
    expect(restored.mechanismSettings).toEqual(defaultMechanismSettings)
    expect(restored.swerveSettings).toEqual(defaultSwerveSettings)
    expect(restored.fieldSettings).toEqual(defaultFieldSettings)
    expect(restored.widgets).toEqual([])
    expect(restored.equations).toEqual([])
  })

  it("conserva los settings guardados y completa solo lo que falta", () => {
    const layout = normalizeLayout({
      openTabs: [tab({ kind: "mechanism", mechanismSettings: { showGrid: false } })],
      activeTabId: "1",
    })
    const settings = layout!.openTabs[0].mechanismSettings

    expect(settings.showGrid).toBe(false)
    // El resto sigue viniendo del default, no se pierde.
    expect(settings.weightScale).toBe(defaultMechanismSettings.weightScale)
    expect(settings.showOrigin).toBe(defaultMechanismSettings.showOrigin)
  })

  it("descarta pestañas de un tipo que ya no existe", () => {
    const layout = normalizeLayout({
      openTabs: [tab(), tab({ id: "2", kind: "herramienta-borrada" })],
      activeTabId: "1",
    })
    expect(layout!.openTabs.map(t => t.id)).toEqual(["1"])
  })

  it("descarta pestañas sin id utilizable", () => {
    const layout = normalizeLayout({
      openTabs: [tab({ id: "" }), tab({ id: 7 }), null, tab({ id: "ok" })],
      activeTabId: null,
    })
    expect(layout!.openTabs.map(t => t.id)).toEqual(["ok"])
  })

  it("olvida el activeTabId si su pestaña ya no está", () => {
    // Si no, la app arranca mostrando una pantalla vacía sin forma de volver.
    const layout = normalizeLayout({
      openTabs: [tab()],
      activeTabId: "borrada",
    })
    expect(layout!.activeTabId).toBeNull()
  })

  it("respeta el activeTabId cuando sí existe", () => {
    const layout = normalizeLayout({
      openTabs: [tab(), tab({ id: "2" })],
      activeTabId: "2",
    })
    expect(layout!.activeTabId).toBe("2")
  })

  it("tolera openTabs corrupto", () => {
    const layout = normalizeLayout({ openTabs: "no es un array", activeTabId: null })
    expect(layout!.openTabs).toEqual([])
  })

  it("guarda el estado colapsado del sidebar", () => {
    expect(normalizeLayout({ openTabs: [], activeTabId: null, sidebarCollapsed: true })!.sidebarCollapsed).toBe(true)
  })

  it("asume el sidebar expandido si el layout es de antes de que existiera", () => {
    expect(normalizeLayout({ openTabs: [], activeTabId: null })!.sidebarCollapsed).toBe(false)
    // Cualquier cosa que no sea true cuenta como expandido, no como truthy.
    expect(normalizeLayout({ openTabs: [], activeTabId: null, sidebarCollapsed: "si" })!.sidebarCollapsed).toBe(false)
  })

  it("descarta marcas con un tiempo inválido", () => {
    // Una marca en NaN dibujaría la bandera en un píxel imposible y rompería
    // el salto entre marcas.
    const layout = normalizeLayout({
      openTabs: [], activeTabId: null,
      markers: [
        { id: "ok", timeUs: 100, label: "buena", color: "#f00" },
        { id: "nan", timeUs: NaN, label: "rota", color: "#f00" },
        { id: "sin-tiempo", label: "rota", color: "#f00" },
        { timeUs: 50, label: "sin id" },
        null,
      ],
    })
    expect(layout!.markers.map(m => m.id)).toEqual(["ok"])
  })

  it("ordena y completa las marcas al restaurarlas", () => {
    const layout = normalizeLayout({
      openTabs: [], activeTabId: null,
      markers: [
        { id: "b", timeUs: 200.6 },
        { id: "a", timeUs: 100, label: "" },
      ],
    })
    expect(layout!.markers.map(m => m.id)).toEqual(["a", "b"])
    expect(layout!.markers[0].label).toBe("Marker")
    expect(layout!.markers[1].timeUs).toBe(201)
  })

  it("rellena la config de SysId de un layout viejo", () => {
    const sysid = normalizeLayout({ openTabs: [], activeTabId: null })!.sysid
    expect(sysid.mechanism).toBe("simple")
    expect(sysid.voltageTopic).toBeNull()
    // Los cuatro rangos tienen que existir aunque estén vacíos: la página los
    // recorre por nombre y un undefined reventaría al leer .startUs.
    expect(Object.keys(sysid.ranges)).toHaveLength(4)
  })

  it("descarta rangos de SysId con tiempos inválidos", () => {
    const sysid = normalizeLayout({
      openTabs: [], activeTabId: null,
      sysid: {
        mechanism: "arm",
        voltageTopic: "/Volts",
        ranges: {
          "dynamic-forward": { startUs: 100, endUs: NaN },
          "quasistatic-forward": { startUs: 5, endUs: 10 },
        },
      },
    })!.sysid

    expect(sysid.mechanism).toBe("arm")
    expect(sysid.voltageTopic).toBe("/Volts")
    expect(sysid.ranges["dynamic-forward"].endUs).toBeNull()
    expect(sysid.ranges["quasistatic-forward"]).toEqual({ startUs: 5, endUs: 10 })
  })

  it("cae a 'simple' si el mecanismo guardado no existe", () => {
    const sysid = normalizeLayout({ openTabs: [], activeTabId: null, sysid: { mechanism: "cohete" } })!.sysid
    expect(sysid.mechanism).toBe("simple")
  })

  it("acepta un layout sin marcas", () => {
    expect(normalizeLayout({ openTabs: [], activeTabId: null })!.markers).toEqual([])
  })

  it("usa el kind como título si el guardado no era texto", () => {
    const layout = normalizeLayout({ openTabs: [tab({ title: 123 })], activeTabId: null })
    expect(layout!.openTabs[0].title).toBe("display")
  })
})
