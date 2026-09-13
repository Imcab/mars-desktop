import { CSSProperties } from "react"

// Estilos de label/input compartidos por los formularios de sidebar de
// página (WatchDog, Telemetry, Manifest, etc.) — antes cada página redefinía
// su propio labelStyle/inputStyle local idéntico. Escala distinta a
// dashboard/DashboardCard.styles.ts, que es para los formularios (más
// chicos) de settings de widgets.
export const labelStyle: CSSProperties = {
  display: "block", fontSize: 10, color: "var(--text-header-eyebrow)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, fontWeight: 600,
}

export const inputStyle: CSSProperties = {
  width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "8px 12px", borderRadius: 3, fontSize: 12, outline: "none", boxSizing: "border-box",
}

// Valor/control dentro de una PropertyRow (árbol de propiedades estilo
// RViz): compacto, pensado para una fila de 24px, sin el padding generoso
// del inputStyle de arriba.
export const propertyInputStyle: CSSProperties = {
  width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", borderRadius: 2, padding: "1px 6px", fontSize: 11, outline: "none", boxSizing: "border-box", height: 20,
}
