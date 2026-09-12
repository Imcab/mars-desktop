import { create } from "zustand"
import { STRUCT_DEFS, StructDef } from "../utils/dashboard/valueDecoding"
import { compileAll } from "../utils/dashboard/structSchema"

interface StructSchemaState {
  /** Texto crudo del schema, por nombre de struct (ej. "Pose2d"). */
  texts: Record<string, string>
  /** Resultado de compilar `texts`. Solo aparecen los que se pudieron resolver. */
  defs: Record<string, StructDef>
  registerSchemas: (entries: Record<string, string>) => void
  clear: () => void
}

export const useStructSchemaStore = create<StructSchemaState>((set, get) => ({
  texts: {},
  defs: {},

  registerSchemas: (entries) => {
    const merged = { ...get().texts }
    let changed = false
    for (const [name, text] of Object.entries(entries)) {
      if (merged[name] === text) continue
      merged[name] = text
      changed = true
    }
    if (!changed) return

    // Se recompila TODO y no solo lo nuevo: un schema recién llegado puede ser
    // la dependencia que le faltaba a otro que quedó sin compilar antes.
    set({ texts: merged, defs: compileAll(merged) })
  },

  clear: () => set({ texts: {}, defs: {} }),
}))

/**
 * La tabla escrita a mano gana sobre el schema publicado, a propósito: para los
 * tipos de WPILib trae etiquetas ("θ" en vez de "value"), sufijos de unidad y
 * la conversión de radianes a grados, cosas que el schema no puede expresar
 * (solo dice "double value"). El schema dinámico cubre el resto — que es todo
 * struct que el equipo haya definido por su cuenta.
 */
export function getStructDef(name: string | null | undefined): StructDef | undefined {
  if (!name) return undefined
  return STRUCT_DEFS[name] ?? useStructSchemaStore.getState().defs[name]
}

/** Versión para componentes: re-renderiza cuando llega un schema nuevo. */
export function useStructDef(name: string | null | undefined): StructDef | undefined {
  const defs = useStructSchemaStore(s => s.defs)
  if (!name) return undefined
  return STRUCT_DEFS[name] ?? defs[name]
}
