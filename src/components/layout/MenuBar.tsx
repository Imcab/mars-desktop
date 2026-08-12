import { useState } from "react"
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

interface MenuEntry {
  label: string
  action: () => void
  separator?: boolean
  dot?: "sim" | "real" | null // punto de estado a la izquierda (opcional)
}

interface MenuItem {
  label: string
  items: MenuEntry[]
}

export default function MenuBar({ navigate, currentPage, onOpenProject, connection, onConnectSim, onConnectReal, onDisconnect }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const toggle = (label: string) => setOpen(prev => prev === label ? null : label)
  const close = () => setOpen(null)

  const menus: MenuItem[] = [
    {
      label: "File",
      items: [
        { label: "New project", action: () => { navigate("creator"); close() } },
        { label: "Open project", action: () => { onOpenProject(); close() } },
        { label: "separator", action: () => {}, separator: true },
        { label: "Settings", action: () => { navigate("settings"); close() } },
      ]
    },
    {
      label: "Simulation",
      items: [
        {
          label: connection === "sim" ? "Disconnect simulation" : "Connect to sim",
          action: () => { connection === "sim" ? onDisconnect() : onConnectSim(); close() },
          dot: "sim",
        },
        {
          label: connection === "real" ? "Disconnect real robot" : "Connect to real robot",
          action: () => { connection === "real" ? onDisconnect() : onConnectReal(); close() },
          dot: "real",
        },
      ]
    },
    {
      label: "View",
      items: [
        { label: "2D Visualizer", action: () => { navigate("visualizer"); close() } },
        { label: "Telemetry view", action: () => { navigate("telemetry"); close() } },
        { label: "Display dashboard", action: () => { navigate("display"); close() } },
        { label: "Function plot", action: () => { navigate("functions" as Page); close() } },
      ]
    },
    {
      label: "Tools",
      items: [
        { label: "Package manager", action: () => { navigate("packages"); close() } },
        { label: "Project variables", action: () => { navigate("variables"); close() } },
        { label: "Manifest", action: () => { navigate("manifest"); close() } },
        { label: "Project wizard", action: () => { navigate("wizard" as Page); close() } },
        { label: "separator", action: () => {}, separator: true },
        { label: "Launch phone telemetry", action: () => { navigate("phone"); close() } },
      ]
    },
    {
      label: "Help",
      items: [
        { label: "Documentation", action: () => { window.open("https://github.com/STZ-Robotics", "_blank"); close() } },
        { label: "About MARS", action: () => { navigate("about"); close() } },
      ]
    },
  ]

  return (
    <div
      style={{ background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-dark)", height: 32, display: "flex", alignItems: "center", flexShrink: 0, position: "relative", zIndex: 100 }}
      onMouseLeave={close}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRight: "1px solid var(--border-dark)", height: "100%" }}>
        <img src="/marsblacklogo.png" alt="MARS" style={{ height: 18 }} />
      </div>

      {menus.map(menu => (
        <div key={menu.label} style={{ position: "relative", height: "100%" }}>
          <div
            onClick={() => toggle(menu.label)}
            onMouseEnter={() => open ? setOpen(menu.label) : undefined}
            style={{
              padding: "0 14px", height: "100%",
              display: "flex", alignItems: "center",
              fontSize: 12, color: "var(--text-primary)", cursor: "pointer",
              borderRight: "0.5px solid var(--border-main)",
              background: open === menu.label ? "var(--border-dark)" : "transparent",
            }}
          >
            {menu.label}
          </div>

          {open === menu.label && (
            <div style={{
              position: "absolute", top: 32, left: 0,
              background: "var(--bg-panel)", border: "1px solid var(--border-main)",
              minWidth: 210, zIndex: 200,
            }}>
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} style={{ height: 1, background: "var(--border-light)", margin: "2px 0" }} />
                ) : (
                  <div
                    key={i}
                    onClick={item.action}
                    style={{ padding: "7px 16px", fontSize: 12, color: "var(--text-primary)", cursor: "pointer", borderBottom: "0.5px solid var(--border-light)", display: "flex", alignItems: "center", gap: 8 }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "var(--bg-menubar)"}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                  >
                    {item.dot && (
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: connection === item.dot ? (item.dot === "sim" ? "var(--status-sim)" : "var(--status-error)") : "var(--text-muted)"
                      }} />
                    )}
                    <span>{item.label}</span>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}

      {/* Indicador de página activa a la derecha, aprovechando el espacio muerto de la barra */}
      <div style={{ marginLeft: "auto", padding: "0 14px", fontSize: 10, color: "var(--text-muted)" }}>
        {currentPage.toUpperCase()}
      </div>
    </div>
  )
}