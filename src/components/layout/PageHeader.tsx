import React from "react"

interface Props {
  eyebrow: string
  title: string
  subtitle?: React.ReactNode
}

// Bloque de cabecera repetido, literal, al inicio del sidebar de cada página
// (WatchDog, Telemetry, Manifest, etc.): eyebrow en mayúsculas + título +
// subtítulo opcional. Antes cada página lo reimplementaba con sus propios
// colores sueltos (rgba(255,255,255,0.55), #fff...); acá vive una sola vez.
export default function PageHeader({ eyebrow, title, subtitle }: Props) {
  return (
    <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
      <div style={{ fontSize: 10, color: "var(--text-header-eyebrow)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-header-title)" }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: "var(--text-header-subtitle)", marginTop: 4, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
