import { describe, it, expect, beforeEach } from "vitest"
import { useMarkerStore, findAdjacentMarker, TimelineMarker } from "./markerStore"

const marker = (timeUs: number, label = "m"): TimelineMarker => ({
  id: `id-${timeUs}`, timeUs, label, color: "#000",
})

describe("useMarkerStore", () => {
  beforeEach(() => useMarkerStore.getState().clearMarkers())

  it("mantiene las marcas ordenadas por tiempo, no por orden de creación", () => {
    const { addMarker } = useMarkerStore.getState()
    addMarker(500, "tarde")
    addMarker(100, "temprano")
    addMarker(300, "medio")

    expect(useMarkerStore.getState().markers.map(m => m.label)).toEqual(["temprano", "medio", "tarde"])
  })

  it("redondea el timestamp", () => {
    // selectedTime viaja a Rust como u64: un decimal hace que serde rechace
    // la llamada.
    useMarkerStore.getState().addMarker(123.7, "x")
    expect(useMarkerStore.getState().markers[0].timeUs).toBe(124)
  })

  it("cae a un label por defecto si viene vacío", () => {
    useMarkerStore.getState().addMarker(10, "   ")
    expect(useMarkerStore.getState().markers[0].label).toBe("Marker")
  })

  it("reparte colores distintos entre marcas consecutivas", () => {
    const { addMarker } = useMarkerStore.getState()
    addMarker(1, "a")
    addMarker(2, "b")
    const [a, b] = useMarkerStore.getState().markers
    expect(a.color).not.toBe(b.color)
  })

  it("genera ids únicos aunque se creen en el mismo milisegundo", () => {
    const { addMarker } = useMarkerStore.getState()
    addMarker(1, "a")
    addMarker(2, "b")
    addMarker(3, "c")
    const ids = useMarkerStore.getState().markers.map(m => m.id)
    expect(new Set(ids).size).toBe(3)
  })

  it("borra por id y limpia todo", () => {
    const { addMarker } = useMarkerStore.getState()
    addMarker(1, "a")
    addMarker(2, "b")
    const first = useMarkerStore.getState().markers[0]
    useMarkerStore.getState().removeMarker(first.id)
    expect(useMarkerStore.getState().markers).toHaveLength(1)
    useMarkerStore.getState().clearMarkers()
    expect(useMarkerStore.getState().markers).toHaveLength(0)
  })

  it("setMarkers ordena lo que le pasen", () => {
    useMarkerStore.getState().setMarkers([marker(300), marker(100), marker(200)])
    expect(useMarkerStore.getState().markers.map(m => m.timeUs)).toEqual([100, 200, 300])
  })
})

describe("findAdjacentMarker", () => {
  const markers = [marker(100, "a"), marker(200, "b"), marker(300, "c")]

  it("encuentra la siguiente", () => {
    expect(findAdjacentMarker(markers, 150, "next")!.label).toBe("b")
    expect(findAdjacentMarker(markers, 0, "next")!.label).toBe("a")
  })

  it("encuentra la anterior", () => {
    expect(findAdjacentMarker(markers, 250, "prev")!.label).toBe("b")
    expect(findAdjacentMarker(markers, 999, "prev")!.label).toBe("c")
  })

  it("no se queda pegado en la marca donde ya está parado", () => {
    // Estando exactamente sobre "b", "siguiente" tiene que ir a "c" y no
    // devolver "b" otra vez (si no, el botón no haría nada).
    expect(findAdjacentMarker(markers, 200, "next")!.label).toBe("c")
    expect(findAdjacentMarker(markers, 200, "prev")!.label).toBe("a")
  })

  it("devuelve null en los extremos", () => {
    expect(findAdjacentMarker(markers, 300, "next")).toBeNull()
    expect(findAdjacentMarker(markers, 100, "prev")).toBeNull()
    expect(findAdjacentMarker([], 50, "next")).toBeNull()
  })
})
