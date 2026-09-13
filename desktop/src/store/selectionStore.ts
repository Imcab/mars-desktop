import { create } from "zustand"

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const

interface SelectionState {
  /** true = siguiendo el "ahora" en tiempo real. false = congelado/scrubbing. */
  isLive: boolean
  /** Timestamp en MICROSEGUNDOS (mismo formato que client.rs), solo válido cuando isLive=false. */
  selectedTime: number | null
  /** Timestamp bajo el cursor del mouse en la timeline, para el crosshair. */
  hoveredTime: number | null

  /** Reproduciendo hacia adelante desde selectedTime (NO es lo mismo que estar en vivo). */
  isPlaying: boolean
  playbackSpeed: number

  goLive: () => void
  pauseAt: (timestampUs: number) => void
  scrubTo: (timestampUs: number) => void
  setHovered: (timestampUs: number | null) => void

  /** Arranca desde donde está el cursor; si estaba en vivo, primero lo fija. */
  play: (fallbackTimeUs: number) => void
  stop: () => void
  setPlaybackSpeed: (speed: number) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  isLive: true,
  selectedTime: null,
  hoveredTime: null,
  isPlaying: false,
  playbackSpeed: 1,

  // Volver a vivo cancela la reproducción: son dos formas distintas de avanzar
  // en el tiempo y dejarlas activas a la vez hace que peleen por selectedTime.
  goLive: () => set({ isLive: true, selectedTime: null, isPlaying: false }),

  // Math.round acá es a propósito: selectedTime viaja tal cual a invoke()
  // -> get_values_at/get_values_range en Rust, que declaran timestamp/start/end
  // como u64. Un decimal (viene de scaleValue()/performance.now(), que son
  // aritmética float) hace que serde rechace la llamada y el catch{} silencioso
  // de los hooks se coma el error sin avisar. Redondeando ACÁ, en el único
  // punto de entrada al store, no hace falta acordarse de hacerlo en cada
  // lugar que llama pauseAt/scrubTo.
  pauseAt: (timestampUs) => set({ isLive: false, selectedTime: Math.round(timestampUs), isPlaying: false }),

  scrubTo: (timestampUs) => set((state) => {
    const t = Math.round(timestampUs)
    // Si por algún motivo llaman scrubTo estando en vivo, lo tratamos como
    // un pause implícito en ese punto, para no dejar el store en un estado raro.
    if (state.isLive) return { isLive: false, selectedTime: t }
    return { selectedTime: t }
  }),

  setHovered: (timestampUs) => set({ hoveredTime: timestampUs }),

  // El play NO salta al último dato: sigue desde donde quedó la línea. Ir al
  // presente es lo que hace el botón de "ir al final" (goLive).
  play: (fallbackTimeUs) => set((state) => ({
    isPlaying: true,
    isLive: false,
    selectedTime: state.selectedTime ?? Math.round(fallbackTimeUs),
  })),

  stop: () => set({ isPlaying: false }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
}))
