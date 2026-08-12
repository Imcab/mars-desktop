import { create } from "zustand"

interface SelectionState {
  /** true = siguiendo el "ahora" en tiempo real. false = congelado/scrubbing. */
  isLive: boolean
  /** Timestamp en MICROSEGUNDOS (mismo formato que client.rs), solo válido cuando isLive=false. */
  selectedTime: number | null
  /** Timestamp bajo el cursor del mouse en la timeline, para el crosshair. */
  hoveredTime: number | null

  goLive: () => void
  pauseAt: (timestampUs: number) => void
  scrubTo: (timestampUs: number) => void
  setHovered: (timestampUs: number | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  isLive: true,
  selectedTime: null,
  hoveredTime: null,

  goLive: () => set({ isLive: true, selectedTime: null }),

  // Math.round acá es a propósito: selectedTime viaja tal cual a invoke()
  // -> get_values_at/get_values_range en Rust, que declaran timestamp/start/end
  // como u64. Un decimal (viene de scaleValue()/performance.now(), que son
  // aritmética float) hace que serde rechace la llamada y el catch{} silencioso
  // de los hooks se coma el error sin avisar. Redondeando ACÁ, en el único
  // punto de entrada al store, no hace falta acordarse de hacerlo en cada
  // lugar que llama pauseAt/scrubTo.
  pauseAt: (timestampUs) => set({ isLive: false, selectedTime: Math.round(timestampUs) }),

  scrubTo: (timestampUs) => set((state) => {
    const t = Math.round(timestampUs)
    // Si por algún motivo llaman scrubTo estando en vivo, lo tratamos como
    // un pause implícito en ese punto, para no dejar el store en un estado raro.
    if (state.isLive) return { isLive: false, selectedTime: t }
    return { selectedTime: t }
  }),

  setHovered: (timestampUs) => set({ hoveredTime: timestampUs }),
}))