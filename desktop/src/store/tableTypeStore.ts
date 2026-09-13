import { create } from "zustand"

// WPILib marca cada tabla "sendable" con un subtopic ".type" cuyo valor dice
// qué es: "Field2d", "Mechanism2d", "SendableChooser", "Subsystem"...
//
// Ese valor NO viene en el announce del topic, hay que leerlo. Este store
// guarda el resultado para que cualquier página pueda preguntar "¿qué es esta
// tabla?" sin volver a pedirlo al backend.

interface TableTypeState {
  /** Ruta de la tabla (sin "/.type") -> valor del ".type". */
  types: Record<string, string>
  registerTypes: (entries: Record<string, string>) => void
  clear: () => void
}

export const useTableTypeStore = create<TableTypeState>((set, get) => ({
  types: {},

  registerTypes: (entries) => {
    const merged = { ...get().types }
    let changed = false
    for (const [prefix, type] of Object.entries(entries)) {
      if (merged[prefix] === type) continue
      merged[prefix] = type
      changed = true
    }
    if (changed) set({ types: merged })
  },

  clear: () => set({ types: {} }),
}))

/** Versión sin hook, para funciones sueltas fuera de un componente. */
export function getTableTypes(): Record<string, string> {
  return useTableTypeStore.getState().types
}
