import { useState } from "react"
import { Page, ConnectionState, ToolKind, LogSource } from "../../store/appStore"
import { MARS_ENABLED, PROJECT_ITEMS, MODULE_ITEMS, CONFIG_ITEMS } from "@mars"

interface Props {
  navigate: (page: Page) => void
  currentPage: Page
  onOpenProject: () => void
  connection: ConnectionState
  onConnectSim: () => void
  onConnectReal: () => void
  onDisconnect: () => void
  onCreateTab: (kind: ToolKind) => void
  logSource: LogSource | null
  onOpenLog: () => void
  onExportLog: () => void
  onCloseLog: () => void
  onSaveLayoutAs: () => void
  onOpenLayout: () => void
  onResetLayout: () => void
  onToggleSidebar: () => void
  sidebarCollapsed: boolean
  projectName: string | null
}

interface MenuEntry {
  label: string
  action: () => void
  separator?: boolean
  disabled?: boolean
  dot?: "sim" | "real" | null // punto de estado a la izquierda (opcional)
}

interface MenuItem {
  label: string
  items: MenuEntry[]
}

const BAR_HEIGHT = 30

// Barra de menú oscura: además de los menús lleva el logo y el punto de
// conexión, porque absorbió la franja de título que había arriba (una fila
// entera de 32px gastada en una sola línea de texto fija).
export default function MenuBar({
  navigate, onOpenProject, connection, onConnectSim, onConnectReal, onDisconnect, onCreateTab,
  logSource, onOpenLog, onExportLog, onCloseLog, onSaveLayoutAs, onOpenLayout, onResetLayout,
  onToggleSidebar, sidebarCollapsed, projectName,
}: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const toggle = (label: string) => setOpen(prev => prev === label ? null : label)
  const close = () => setOpen(null)

  const isConnected = connection !== "disconnected"

  // Una lista de @mars se convierte en entradas de menu seguidas de un
  // separador; vacia no aporta nada, ni siquiera el separador.
  const marsMenuItems = (items: readonly { label: string; page: Page }[]): MenuEntry[] =>
    items.length === 0 ? [] : [
      ...items.map(item => ({ label: item.label, action: () => { navigate(item.page); close() } })),
      { label: "separator", action: () => {}, separator: true },
    ]

  const menus: MenuItem[] = [
    {
      label: "File",
      items: [
        // Un proyecto es un proyecto de MARS: en la edicion Tools estas dos
        // entradas y su separador no existen.
        ...(MARS_ENABLED ? [
          { label: "New project", action: () => { navigate("creator"); close() } },
          { label: "Open project", action: () => { onOpenProject(); close() } },
          { label: "separator", action: () => {}, separator: true },
        ] : []),
        { label: "Open log…", action: () => { onOpenLog(); close() } },
        { label: "Export log…", action: () => { onExportLog(); close() } },
        // Antes esta entrada solo existía si había un log abierto, así que
        // aparecía y desaparecía y corría todo lo de abajo. Ahora está siempre
        // y se deshabilita, que es como se comporta un menú de verdad.
        {
          label: logSource ? `Close log (${logSource.name})` : "Close log",
          action: () => { onCloseLog(); close() },
          disabled: logSource === null,
        },
        { label: "separator", action: () => {}, separator: true },
        { label: "Save layout as…", action: () => { onSaveLayoutAs(); close() } },
        { label: "Open layout…", action: () => { onOpenLayout(); close() } },
        { label: "Reset layout", action: () => { onResetLayout(); close() } },
        { label: "separator", action: () => {}, separator: true },
        { label: "Settings", action: () => { navigate("settings"); close() } },
      ],
    },
    {
      // "Simulation" mentía: desde acá también se conecta al robot real.
      label: "Connection",
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
        { label: "separator", action: () => {}, separator: true },
        // Misma acción que arriba, pero como entrada propia no obliga a
        // acordarse de con cuál de las dos te habías conectado.
        { label: "Disconnect", action: () => { onDisconnect(); close() }, disabled: !isConnected },
        { label: "separator", action: () => {}, separator: true },
        { label: "Connection settings…", action: () => { navigate("settings"); close() } },
      ],
    },
    {
      label: "View",
      items: [
        { label: "2D Visualizer (new tab)", action: () => { onCreateTab("visualizer"); close() } },
        { label: "Field 3D (new tab)", action: () => { onCreateTab("field3d"); close() } },
        { label: "Swerve (new tab)", action: () => { onCreateTab("swerve"); close() } },
        { label: "Swerve 3D (new tab)", action: () => { onCreateTab("swerve3d"); close() } },
        { label: "Mechanism2d (new tab)", action: () => { onCreateTab("mechanism"); close() } },
        { label: "Mechanism 3D (new tab)", action: () => { onCreateTab("mechanism3d"); close() } },
        { label: "NT Session (new tab)", action: () => { onCreateTab("ntsession"); close() } },
        { label: "Telemetry view (new tab)", action: () => { onCreateTab("telemetry"); close() } },
        { label: "Display dashboard (new tab)", action: () => { onCreateTab("display"); close() } },
        { label: "Function plot (new tab)", action: () => { onCreateTab("functions"); close() } },
        { label: "Equations (new tab)", action: () => { onCreateTab("equations"); close() } },
        { label: "separator", action: () => {}, separator: true },
        {
          label: sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
          action: () => { onToggleSidebar(); close() },
        },
      ],
    },
    {
      label: "Tools",
      items: [
        // Las entradas que dependen del framework salen de @mars, que en la
        // edicion Tools exporta listas vacias: aca no hay condicionales
        // sueltos que se puedan olvidar de actualizar.
        ...marsMenuItems([...PROJECT_ITEMS, ...MODULE_ITEMS]),
        ...marsMenuItems(CONFIG_ITEMS),
        // Estas páginas existían pero no estaban en ningún menú: solo se
        // llegaba a ellas desde el sidebar.
        { label: "Loop timing", action: () => { navigate("jitter"); close() } },
        { label: "Network bandwidth", action: () => { navigate("bandwidth"); close() } },
        { label: "System identification", action: () => { navigate("sysid"); close() } },
        { label: "Command console", action: () => { navigate("console"); close() } },
        { label: "separator", action: () => {}, separator: true },
        { label: "Launch phone telemetry", action: () => { navigate("phone"); close() } },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Documentation", action: () => { window.open("https://github.com/STZ-Robotics", "_blank"); close() } },
        { label: "About MARS", action: () => { navigate("about"); close() } },
      ],
    },
  ]

  const statusColor = connection === "sim" ? "var(--status-sim)"
    : connection === "real" ? "var(--status-error)"
    : logSource ? "var(--mars-accent)"
    : "var(--text-menubar-dim)"

  return (
    <div
      style={{
        background: "var(--bg-menubar-dark)",
        borderBottom: "1px solid #14151a",
        height: BAR_HEIGHT, display: "flex", alignItems: "center",
        flexShrink: 0, position: "relative", zIndex: 100, userSelect: "none",
      }}
      onMouseLeave={close}
    >
      {/* "marslogo" es el logo CLARO: es el que corresponde sobre fondo oscuro
          (el que se llama "black" es para fondo claro). */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 11px 0 10px", flexShrink: 0 }}>
        <img src="/marslogo.png" alt="MARS" style={{ height: 17, objectFit: "contain" }} draggable={false} />
      </div>

      <div style={{ width: 1, height: 16, background: "#4a4b53", marginRight: 4, flexShrink: 0 }} />

      {menus.map(menu => (
        <div key={menu.label} style={{ position: "relative", height: "100%" }}>
          <div
            onClick={() => toggle(menu.label)}
            // Con un menú ya abierto, pasar el mouse cambia de menú sin volver
            // a hacer click — el comportamiento clásico de una barra de menús.
            onMouseEnter={() => open ? setOpen(menu.label) : undefined}
            onMouseOver={e => {
              if (open !== menu.label) e.currentTarget.style.background = "var(--bg-menubar-dark-hover)"
            }}
            onMouseOut={e => {
              if (open !== menu.label) e.currentTarget.style.background = "transparent"
            }}
            style={{
              padding: "0 11px", height: "100%",
              display: "flex", alignItems: "center",
              fontSize: 11.5, cursor: "pointer",
              color: "var(--text-menubar)",
              background: open === menu.label ? "var(--bg-menubar-dark-active)" : "transparent",
            }}
          >
            {menu.label}
          </div>

          {open === menu.label && (
            <div style={{
              position: "absolute", top: BAR_HEIGHT, left: 0,
              background: "var(--bg-panel)",
              // Bisel clásico: claro arriba-izquierda, oscuro abajo-derecha.
              borderTop: "1px solid var(--bevel-light)",
              borderLeft: "1px solid var(--bevel-light)",
              borderRight: "1px solid var(--bevel-dark)",
              borderBottom: "1px solid var(--bevel-dark)",
              minWidth: 218, zIndex: 200,
              boxShadow: "2px 2px 0 var(--shadow-soft)",
              padding: "2px 0",
            }}>
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} style={{ borderTop: "1px solid var(--bevel-dark)", borderBottom: "1px solid var(--bevel-light)", margin: "3px 2px" }} />
                ) : (
                  <MenuItemRow
                    key={i}
                    item={item}
                    dotOn={item.dot !== undefined && connection === item.dot}
                  />
                )
              )}
            </div>
          )}
        </div>
      ))}

      {/* Zona de arrastre de la ventana: ocupa todo el hueco sobrante para que
          se pueda mover la app agarrando la barra, sin robarle clicks a los
          menús (que quedan a la izquierda). */}
      <div data-tauri-drag-region style={{ flex: 1, height: "100%" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px", flexShrink: 0 }}>
        {projectName && (
          <span style={{ fontSize: 10.5, color: "var(--text-menubar-dim)", letterSpacing: 0.3, fontFamily: "ui-monospace, monospace" }}>
            {projectName}
          </span>
        )}
        <span
          title={
            logSource ? `Log: ${logSource.name}`
              : connection === "disconnected" ? "Not connected"
              : `Connected (${connection})`
          }
          style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: statusColor,
            boxShadow: isConnected ? `0 0 5px ${statusColor}` : "none",
          }}
        />
      </div>
    </div>
  )
}

function MenuItemRow({ item, dotOn }: { item: MenuEntry, dotOn: boolean }) {
  const [hovered, setHovered] = useState(false)
  const active = hovered && !item.disabled

  return (
    <div
      onClick={item.disabled ? undefined : item.action}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "0 14px", fontSize: 11.5, height: 22,
        display: "flex", alignItems: "center", gap: 8,
        color: item.disabled ? "var(--btn-classic-text-disabled)"
          : active ? "var(--tree-selection-fg)" : "var(--text-primary)",
        background: active ? "var(--tree-selection-bg)" : "transparent",
        cursor: item.disabled ? "default" : "pointer",
      }}
    >
      {item.dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: dotOn ? (item.dot === "sim" ? "var(--status-sim)" : "var(--status-error)") : "var(--text-muted)",
        }} />
      )}
      <span>{item.label}</span>
    </div>
  )
}
