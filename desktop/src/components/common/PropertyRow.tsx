import { ReactNode } from "react"

interface Props {
  label: string
  children: ReactNode // el control/valor: input, select, texto, badge...
  indent?: number
}

// Fila de árbol de propiedades estilo RViz (panel "Displays"/"Views"): dos
// columnas fijas — nombre a la izquierda, valor/control a la derecha —
// separadas por un hairline vertical, filas densas de 24px con hairline
// horizontal entre cada una. Esto reemplaza el patrón "label arriba, input
// abajo" que se usaba en los sidebars — RViz nunca apila así, todo es
// label:valor en una sola fila.
export default function PropertyRow({ label, children, indent = 0 }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", minHeight: 24, borderBottom: "1px solid var(--border-light)" }}>
      <div style={{
        width: "42%", flexShrink: 0, display: "flex", alignItems: "center",
        paddingLeft: 8 + indent * 14, paddingRight: 6,
        fontSize: 11, color: "var(--text-primary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        borderRight: "1px solid var(--border-light)",
      }}>
        {label}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0, padding: "2px 6px" }}>
        {children}
      </div>
    </div>
  )
}
