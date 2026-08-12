import { Page, ConnectionState } from "../../store/appStore"

interface Props {
  navigate: (page: Page) => void
  currentPage: Page
  onOpenProject: () => void
  connection: ConnectionState
  onConnectSim: () => void
  onConnectReal: () => void
  onDisconnect: () => void
}

export default function ToolBar({ 
  navigate, 
  currentPage, 
  onOpenProject,
  connection,
  onConnectSim,
  onConnectReal,
  onDisconnect
}: Props) {
  return (
    <div style={{
      background: "var(--bg-toolbar)", borderBottom: "1px solid var(--border-dark)",
      height: 76, display: "flex", alignItems: "center",
      padding: "0 8px", gap: 2, flexShrink: 0, overflowX: "auto"
    }}>
      {/* NAVEGACIÓN BASE */}
      <TbBtn label="Home" icon="ti-home" active={currentPage === "welcome"} onClick={() => navigate("welcome")} />
      
      <TbSep />
      
      {/* MANEJO DE ARCHIVOS */}
      <TbBtn label="New Project" icon="ti-plus" active={currentPage === "creator"} onClick={() => navigate("creator")} />
      <TbBtn label="Open Project" icon="ti-folder-open" onClick={onOpenProject} />
      
      <TbSep />
      
      {/* CONEXIONES DE RED Y ROBOT */}
      <TbBtn 
        label="Connect Sim" 
        icon="ti-player-play" 
        variant="green" 
        active={connection === "sim"} 
        onClick={connection === "sim" ? onDisconnect : onConnectSim} 
      />
      <TbBtn 
        label="Connect Real" 
        icon="ti-player-play" 
        variant="red" 
        active={connection === "real"} 
        onClick={connection === "real" ? onDisconnect : onConnectReal} 
      />
      
      <TbSep />
      
      {/* HERRAMIENTAS PRINCIPALES */}
      <TbBtn label="2D Visualizer" icon="ti-vector" active={currentPage === "visualizer"} onClick={() => navigate("visualizer")} />
      <TbBtn label="Telemetry" icon="ti-chart-line" active={currentPage === "telemetry"} onClick={() => navigate("telemetry")} />
      <TbBtn label="Display" icon="ti-layout-dashboard" active={currentPage === "display"} onClick={() => navigate("display")} />
      <TbBtn label="Function" icon="ti-wave-sine" active={currentPage === "functions"} onClick={() => navigate("functions")} />
      
      <TbSep />
      
      {/* MÓDULOS Y EXTRAS */}
      <TbBtn label="Packages" icon="ti-package" active={currentPage === "packages"} onClick={() => navigate("packages")} />
      <TbBtn label="Wizard" icon="ti-file-plus" active={currentPage === "wizard"} onClick={() => navigate("wizard")} />
      <TbBtn label="Variables" icon="ti-variable" active={currentPage === "variables"} onClick={() => navigate("variables")} />
      <TbBtn label="Manifest" icon="ti-blocks" active={currentPage === "manifest"} onClick={() => navigate("manifest")} />
      <TbBtn label="Phone" icon="ti-device-mobile" active={currentPage === "phone"} onClick={() => navigate("phone")} />
  
      
      {/* Resorte para empujar Settings a la derecha */}
      <div style={{ flex: 1 }} />
      
      <TbSep />
      
      {/* CONFIGURACIÓN */}
      <TbBtn label="Settings" icon="ti-settings" active={currentPage === "settings"} onClick={() => navigate("settings")} />
    </div>
  )
}

function TbSep() {
  return <div style={{ width: 1, height: 48, background: "var(--border-dark)", margin: "0 6px" }} />
}

function TbBtn({ label, icon, variant, active, onClick }: {
  label: string; icon: string
  variant?: "green" | "red"
  active?: boolean; onClick?: () => void
}) {
  const defaultBg = variant === "green" ? "rgba(42, 90, 42, 0.04)" 
    : variant === "red" ? "rgba(90, 42, 42, 0.04)" 
    : "transparent"
  
  const activeBg = variant === "green" ? "#c8dcc8" 
    : variant === "red" ? "#dcc8c8" 
    : "var(--border-dark)"
  
  const hoverBg = variant === "green" ? "#d4e4d4" 
    : variant === "red" ? "#e4d4d4" 
    : "var(--border-main)"

  const textColor = variant === "green" ? "var(--status-sim)" 
    : variant === "red" ? "var(--status-error)" 
    : "var(--text-primary)"

  const iconColor = variant === "green" ? "var(--status-sim)" 
    : variant === "red" ? "var(--status-error)" 
    : "var(--mars-red)" 

  const bg = active ? activeBg : defaultBg
  
  const border = active 
    ? (variant === "green" ? "#8ab08a" : variant === "red" ? "#b08a8a" : "var(--border-main)") 
    : "transparent"

  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minWidth: 64, height: 62, padding: "6px 8px 4px 8px", gap: 6,
        fontSize: 10, color: textColor, background: bg, border: `1px solid ${border}`,
        borderRadius: 4, cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap",
        transition: "all 0.1s ease-in-out"
      }}
      onMouseEnter={e => { 
        const t = e.currentTarget as HTMLButtonElement
        t.style.background = active ? activeBg : hoverBg
        if (!active) t.style.border = `1px solid ${variant === "green" ? "#a8c8a8" : variant === "red" ? "#c8a8a8" : "var(--border-dark)"}`
      }}
      onMouseLeave={e => { 
        const t = e.currentTarget as HTMLButtonElement
        t.style.background = bg
        t.style.border = `1px solid ${border}`
      }}
    >
      <i className={`ti ${icon}`} style={{ fontSize: 22, color: iconColor }} aria-hidden />
      <span style={{ fontWeight: active ? 500 : 400 }}>{label}</span>
    </button>
  )
}