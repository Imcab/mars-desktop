import { ReactNode } from "react"

interface Props {
  title: string
  children: ReactNode
  icon?: string // sufijo de ícono tabler, opcional
}

// Panel acoplable estilo RViz/Qt (QDockWidget): barra de título sólida +
// contenido debajo, todo dentro de un borde fino — el mismo lenguaje visual
// de los paneles "Displays"/"Views"/"Time" de RViz. Reemplaza el GroupBox
// anterior (título incrustado en el borde, estilo MATLAB uipanel): mismo
// rol de "agrupar campos con un título", look distinto.
export default function Panel({ title, children, icon }: Props) {
  return (
    <div style={{ border: "1px solid var(--border-main)", overflow: "hidden", background: "var(--bg-page)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        background: "var(--bg-panel-header)", borderBottom: "1px solid var(--border-main)",
      }}>
        {icon && <i className={`ti ${icon}`} style={{ fontSize: 12, color: "var(--text-muted)" }} aria-hidden />}
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}
