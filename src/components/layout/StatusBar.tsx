import { ConnectionState } from "../../store/appStore"

interface Props {
  connection: ConnectionState
  projectName: string | null
}

export default function StatusBar({ connection, projectName }: Props) {
  // 1. Lógica del bloque de conexión (Verde para SIM, Rojo para Real, Gris para desconectado)
  const connBg = connection === "sim" ? "var(--status-sim)" : connection === "real" ? "var(--status-real)" : "rgba(255, 255, 255, 0.08)"
  // Texto oscuro sobre fondos brillantes para contraste óptimo
  const connColor = connection !== "disconnected" ? "#111" : "var(--text-light)" 
  const connLabel = connection === "sim" ? "Sim running" : connection === "real" ? "Real robot" : "Not connected"

  // 2. Lógica del bloque de proyecto (Naranja si hay proyecto, gris si no)
  const projectBg = projectName ? "#d97706" : "rgba(255, 255, 255, 0.08)"
  const projectColor = projectName ? "#fff" : "var(--text-light)"

  return (
    <div style={{
      background: "var(--bg-dark)",
      height: 26, 
      display: "flex",
      alignItems: "center",
      padding: 0, // Quitamos el padding global para que los bloques toquen los bordes superior e inferior
      gap: 1, // Separador de 1px entre bloques
      flexShrink: 0,
      borderTop: "1px solid var(--border-main)"
    }}>
      
      {/* BLOQUE DE CONEXIÓN */}
      <StatusItem 
        clickable 
        onClick={() => console.log("Abrir modal de conexión")}
        bg={connBg}
        color={connColor}
        fontWeight={connection !== "disconnected" ? 600 : 400}
      >
        <div style={{ 
          width: 8, height: 8, borderRadius: "50%", 
          background: connection !== "disconnected" ? "#111" : "var(--text-secondary)"
        }} />
        {connLabel}
      </StatusItem>

      <StatusItem clickable onClick={() => console.log("Abrir detalles de red")}>
        <i className="ti ti-network" style={{ fontSize: 13, marginRight: 2 }} />
        NT4: {connection !== "disconnected" ? "localhost:5810" : "—"}
      </StatusItem>

      {/* BLOQUE DE PROYECTO */}
      <StatusItem 
        clickable 
        onClick={() => console.log("Ir a settings de proyecto")}
        bg={projectBg}
        color={projectColor}
        fontWeight={projectName ? 600 : 400}
      >
        <i className="ti ti-folder" style={{ fontSize: 13, marginRight: 2 }} />
        {projectName ?? "No project open"}
      </StatusItem>

      <div style={{ marginLeft: "auto" }}>
        <StatusItem>MARS v1.0.0-dev</StatusItem>
      </div>
    </div>
  )
}

// Componente helper modificado para comportarse como bloque sólido
interface StatusItemProps {
  children: React.ReactNode
  clickable?: boolean
  onClick?: () => void
  bg?: string
  color?: string
  fontWeight?: number
}

function StatusItem({ 
  children, 
  clickable, 
  onClick, 
  bg = "transparent", 
  color = "var(--text-light)", 
  fontWeight = 400 
}: StatusItemProps) {
  return (
    <div 
      onClick={onClick}
      style={{ 
        fontSize: 11, 
        fontWeight,
        color, 
        background: bg,
        display: "flex", 
        alignItems: "center", 
        gap: 6,
        padding: "0 12px", // Padding horizontal amplio
        height: "100%", // Se expande verticalmente
        cursor: clickable ? "pointer" : "default",
        transition: "all 0.15s ease",
      }}
      // Manejo de hover compatible con estilos en línea de React
      onMouseEnter={e => {
        if (clickable) {
          if (bg === "transparent") {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            e.currentTarget.style.color = "var(--text-primary)";
          } else {
            // Aclaramos el color de bloque existente un poco al hacer hover
            e.currentTarget.style.filter = "brightness(1.15)";
          }
        }
      }}
      onMouseLeave={e => {
        if (clickable) {
          e.currentTarget.style.background = bg;
          e.currentTarget.style.color = color;
          e.currentTarget.style.filter = "brightness(1)";
        }
      }}
    >
      {children}
    </div>
  )
}