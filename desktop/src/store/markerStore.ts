import { create } from "zustand"

// Marcas en la línea de tiempo: "acá falló el swerve", "acá arrancó el
// autónomo". Existen para poder volver a un instante concreto después, sin
// tener que acordarse del número de segundo.
export interface TimelineMarker {
  id: string
  /** Microsegundos, misma escala que selectedTime. */
  timeUs: number
  label: string
  color: string
}

// Paleta fija: los colores se reparten en orden de creación para que dos
// marcas seguidas nunca salgan iguales.
export const MARKER_COLORS = ["#d63b3b", "#d4a94a", "#1f9e4a", "#2f6fdb", "#8a4fd1", "#0e9aa7"]

interface MarkerState {
  markers: TimelineMarker[]
  addMarker: (timeUs: number, label: string) => void
  removeMarker: (id: string) => void
  renameMarker: (id: string, label: string) => void
  clearMarkers: () => void
  /** Reemplaza todo el set (al restaurar un layout guardado). */
  setMarkers: (markers: TimelineMarker[]) => void
}

let idCounter = 0

export const useMarkerStore = create<MarkerState>((set, get) => ({
  markers: [],

  addMarker: (timeUs, label) => {
    const color = MARKER_COLORS[get().markers.length % MARKER_COLORS.length]
    const marker: TimelineMarker = {
      id: `${Date.now()}-${idCounter++}`,
      timeUs: Math.round(timeUs),
      label: label.trim() || "Marker",
      color,
    }
    // Ordenadas por tiempo: así "saltar a la siguiente marca" es solo avanzar
    // un índice, y el dibujo no depende del orden de creación.
    set(state => ({ markers: [...state.markers, marker].sort((a, b) => a.timeUs - b.timeUs) }))
  },

  removeMarker: (id) => set(state => ({ markers: state.markers.filter(m => m.id !== id) })),

  renameMarker: (id, label) => set(state => ({
    markers: state.markers.map(m => m.id === id ? { ...m, label: label.trim() || m.label } : m),
  })),

  clearMarkers: () => set({ markers: [] }),

  setMarkers: (markers) => set({ markers: [...markers].sort((a, b) => a.timeUs - b.timeUs) }),
}))

/** Marca inmediatamente anterior/posterior a un instante, para saltar entre ellas. */
export function findAdjacentMarker(
  markers: TimelineMarker[],
  timeUs: number,
  direction: "prev" | "next",
): TimelineMarker | null {
  if (direction === "next") {
    return markers.find(m => m.timeUs > timeUs + 1) ?? null
  }
  for (let i = markers.length - 1; i >= 0; i--) {
    if (markers[i].timeUs < timeUs - 1) return markers[i]
  }
  return null
}
