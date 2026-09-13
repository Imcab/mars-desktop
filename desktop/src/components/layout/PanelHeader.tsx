import React from "react"

interface Props {
  /** Acepta un nodo para que una página pueda hacerlo editable en el lugar. */
  title: React.ReactNode
  meta?: React.ReactNode
  action?: React.ReactNode
}

// Barra de 48px sobre el panel principal de cada página (título + contador/
// estado + acción opcional a la derecha). Mismo patrón que PageHeader pero
// para el área de contenido en vez del sidebar.
export default function PanelHeader({ title, meta, action }: Props) {
  return (
    <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-header-title)" }}>{title}</span>
      {meta && <span style={{ fontSize: 11, color: "var(--text-header-eyebrow)" }}>{meta}</span>}
      {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
    </div>
  )
}
