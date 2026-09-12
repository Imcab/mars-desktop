import { create } from "zustand"
import { MechanismType, SysIdTestType } from "../utils/sysid/feedforward"

/** Rango de tiempo de una corrida, en microsegundos (escala del servidor NT). */
export interface TestRange {
  startUs: number | null
  endUs: number | null
}

export interface SysIdConfig {
  mechanism: MechanismType
  /** Topic del voltaje aplicado al motor. */
  voltageTopic: string | null
  /** Solo lo necesita el modelo de brazo (para cos θ). */
  positionTopic: string | null
  velocityTopic: string | null
  ranges: Record<SysIdTestType, TestRange>
}

export const emptyRanges = (): Record<SysIdTestType, TestRange> => ({
  "quasistatic-forward": { startUs: null, endUs: null },
  "quasistatic-backward": { startUs: null, endUs: null },
  "dynamic-forward": { startUs: null, endUs: null },
  "dynamic-backward": { startUs: null, endUs: null },
})

export const defaultSysIdConfig: SysIdConfig = {
  mechanism: "simple",
  voltageTopic: null,
  positionTopic: null,
  velocityTopic: null,
  ranges: emptyRanges(),
}

interface SysIdState {
  config: SysIdConfig
  update: (updates: Partial<SysIdConfig>) => void
  setRange: (test: SysIdTestType, range: Partial<TestRange>) => void
  clearRange: (test: SysIdTestType) => void
  reset: () => void
  /** Reemplaza todo (al restaurar un layout guardado). */
  setConfig: (config: SysIdConfig) => void
}

// La configuración vive en un store y no en el estado local de la página
// porque SysId es una Page singleton: navegar a otra pantalla y volver
// perdería los cuatro rangos que costó marcar a mano.
export const useSysIdStore = create<SysIdState>((set) => ({
  config: defaultSysIdConfig,

  update: (updates) => set(state => ({ config: { ...state.config, ...updates } })),

  setRange: (test, range) => set(state => ({
    config: {
      ...state.config,
      ranges: { ...state.config.ranges, [test]: { ...state.config.ranges[test], ...range } },
    },
  })),

  clearRange: (test) => set(state => ({
    config: {
      ...state.config,
      ranges: { ...state.config.ranges, [test]: { startUs: null, endUs: null } },
    },
  })),

  reset: () => set({ config: { ...defaultSysIdConfig, ranges: emptyRanges() } }),

  setConfig: (config) => set({ config }),
}))

/** Un rango sirve solo si tiene los dos extremos y el final va después del inicio. */
export function isRangeUsable(range: TestRange): boolean {
  return range.startUs !== null && range.endUs !== null && range.endUs > range.startUs
}

/** Rellena lo que falte de un config guardado por una versión anterior. */
export function normalizeSysIdConfig(raw: any): SysIdConfig {
  const mechanisms: MechanismType[] = ["simple", "elevator", "arm"]
  const ranges = emptyRanges()

  if (raw && typeof raw.ranges === "object" && raw.ranges !== null) {
    for (const key of Object.keys(ranges) as SysIdTestType[]) {
      const r = raw.ranges[key]
      if (!r) continue
      // Un rango con un tiempo no finito dibujaría en NaN y rompería el ajuste.
      const startUs = typeof r.startUs === "number" && isFinite(r.startUs) ? r.startUs : null
      const endUs = typeof r.endUs === "number" && isFinite(r.endUs) ? r.endUs : null
      ranges[key] = { startUs, endUs }
    }
  }

  const asTopic = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null)

  return {
    mechanism: mechanisms.includes(raw?.mechanism) ? raw.mechanism : "simple",
    voltageTopic: asTopic(raw?.voltageTopic),
    positionTopic: asTopic(raw?.positionTopic),
    velocityTopic: asTopic(raw?.velocityTopic),
    ranges,
  }
}
