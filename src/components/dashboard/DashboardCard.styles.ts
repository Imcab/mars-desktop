import React from "react"

export const labelStyle: React.CSSProperties = { display: "block", fontSize: 9, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }
export const inputStyle: React.CSSProperties = { width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "4px 6px", borderRadius: 2, fontSize: 11, outline: "none", boxSizing: "border-box" }

// Sufijo libre para doubles: SOLO etiqueta visual, no convierte el valor
// (no sabemos en qué unidad llega el double crudo desde NT4).
export const NUMBER_UNIT_OPTIONS = [
  { value: "", label: "None" },
  { value: "V", label: "Volts (V)" },
  { value: "RPM", label: "RPM" },
  { value: "RPS", label: "RPS" },
  { value: "deg", label: "Degrees (°)" },
  { value: "rad", label: "Radians (rad)" },
  { value: "rot", label: "Rotations (rot)" },
  { value: "m", label: "Meters (m)" },
  { value: "%", label: "Percent (%)" },
]

// Rotation2d SÍ se convierte de verdad: el struct WPILib siempre llega en radianes.
export const ROTATION_UNIT_OPTIONS = [
  { value: "deg", label: "Degrees (°)" },
  { value: "rad", label: "Radians (rad)" },
]

export function unitSuffix(unit?: string) {
  if (!unit) return ""
  return unit === "%" ? "%" : ` ${unit}`
}
