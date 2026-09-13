import { useState, useRef, useEffect, Fragment, ReactNode, CSSProperties } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Page, ConnectionState, ToolKind, WorkspaceTab } from "../../store/appStore"
import SidebarIcon from "../common/SidebarIcon"
import { MARS_ENABLED, HAS_SIM_STUDIO, PROJECT_ITEMS, MODULE_ITEMS, CONFIG_ITEMS } from "@mars"

interface Props {
  navigate: (page: Page) => void
  currentPage: Page
  onOpenProject: () => void
  connection: ConnectionState
  onConnectSim: () => void
  onConnectReal: () => void
  onDisconnect: () => void
  openTabs: WorkspaceTab[]
  activeTabId: string | null
  onCreateTab: (kind: ToolKind) => void
  onSelectTab: (id: string) => void
  onRenameTab: (id: string, title: string) => void
  onCloseTab: (id: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

// `svg` es el archivo en public/icons; `icon` es el respaldo tabler para las
// herramientas que todavía no tienen SVG propio.
export const TOOL_KIND_META: Record<ToolKind, { label: string; icon: string; svg?: string; svgFallback?: string }> = {
  visualizer: { label: "2D Visualizer", icon: "ti-vector", svg: "visualizer2d.svg" },
  field3d: { label: "Field 3D", icon: "ti-cube-3d-sphere", svg: "field3d.svg", svgFallback: "visualizer2d.svg" },
  swerve: { label: "Swerve", icon: "ti-steering-wheel", svg: "swerve.svg" },
  swerve3d: { label: "Swerve 3D", icon: "ti-cube", svg: "swerve3d.svg" },
  mechanism: { label: "Mechanism", icon: "ti-hierarchy-2", svg: "mechanism.svg" },
  mechanism3d: { label: "Mechanism 3D", icon: "ti-3d-cube-sphere", svg: "mechanism3d.svg", svgFallback: "swerve3d.svg" },
  ntsession: { label: "NT Session", icon: "ti-broadcast", svg: "nt-session.svg", svgFallback: "network.svg" },
  telemetry: { label: "Telemetry", icon: "ti-chart-line", svg: "telemetry.svg" },
  display: { label: "Display", icon: "ti-layout-dashboard", svg: "display.svg" },
  functions: { label: "Function", icon: "ti-wave-sine", svg: "function.svg" },
  equations: { label: "Equations", icon: "ti-math-function", svg: "equation.svg" },
}

const TOOL_KIND_ORDER: ToolKind[] = ["visualizer", "field3d", "swerve", "swerve3d", "mechanism", "mechanism3d", "ntsession", "telemetry", "display", "functions", "equations"]

const EXPANDED_WIDTH = 250
const COLLAPSED_WIDTH = 44

// Panel acoplado estilo "Displays" de RViz: un QTreeWidget denso (grupos
// plegables + hojas seleccionables) y, debajo del grupo de herramientas, la
// botonera clásica Add/Rename/Remove que en RViz opera sobre la fila
// seleccionada del árbol.
//
// Colapsado se convierte en un riel de solo iconos: los grupos se reducen a
// una línea separadora y cada fila muestra su nombre en el tooltip.
export default function Sidebar({
  navigate, currentPage, onOpenProject,
  connection, onConnectSim, onConnectReal, onDisconnect,
  openTabs, activeTabId, onCreateTab, onSelectTab, onRenameTab, onCloseTab,
  collapsed, onToggleCollapsed,
}: Props) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null)

  // `null` mientras no se sabe; `false` si el Studio no esta compilado. Solo se
  // usa para atenuar el icono: el error util lo da el comando al intentarlo,
  // que ademas explica como compilarlo.
  const [simDisponible, setSimDisponible] = useState<boolean | null>(null)
  useEffect(() => {
    // In the Tools edition the command does not exist in the binary: do not
    // even ask.
    if (!HAS_SIM_STUDIO) return
    invoke<string | null>("sim_app_disponible")
      .then(ruta => setSimDisponible(ruta !== null))
      .catch(() => setSimDisponible(false))
  }, [])

  const abrirSim = () => {
    invoke("abrir_sim_app").catch((e: unknown) => {
      // No hay toast en el Sidebar; un alert es feo pero es mucho mejor que
      // un clic que no hace nada y no dice por que.
      alert(String(e))
      setSimDisponible(false)
    })
  }

  const selectedTab = openTabs.find(t => t.id === activeTabId) ?? null

  const handleRemove = () => {
    if (!selectedTab) return
    if (window.confirm(`Delete tab "${selectedTab.title}"? Its configuration will be lost.`)) {
      onCloseTab(selectedTab.id)
    }
  }

  return (
    <div style={{
      width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
      flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0,
      background: "var(--bg-sidebar)", borderRight: "1px solid var(--border-dark)",
      transition: "width 0.12s ease",
    }}>
      <CollapseBar collapsed={collapsed} onToggle={onToggleCollapsed} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", background: "var(--tree-body-bg)" }}>
        <TreeLeaf
          svg="home.svg"
          icon="ti-home"
          label="Home"
          indent={0}
          collapsed={collapsed}
          selected={activeTabId === null && currentPage === "welcome"}
          onClick={() => navigate("welcome")}
        />

        {/* A project is a MARS project: the whole group disappears in the Tools
            edition, just like its code. */}
        {MARS_ENABLED && (
          <TreeGroup title="Project" icon="ti-folder" collapsed={collapsed}>
            {PROJECT_ITEMS.map(item => (
              <Fragment key={item.page}>
                <TreeLeaf
                  svg={item.svg}
                  icon={item.icon}
                  label={item.label}
                  collapsed={collapsed}
                  selected={activeTabId === null && currentPage === item.page}
                  onClick={() => navigate(item.page)}
                />
                {/* "Open Project" is an action, not a page, so it is not in the
                    list; it goes after "New Project" as it always did. */}
                {item.page === "creator" && (
                  <TreeLeaf svg="open-folder.svg" icon="ti-folder-open" label="Open Project" collapsed={collapsed} onClick={onOpenProject} />
                )}
              </Fragment>
            ))}
          </TreeGroup>
        )}

        <TreeGroup title="Connection" icon="ti-antenna" collapsed={collapsed}>
          {/* MARS Simulation Studio es una aplicación aparte: esto solo la
              abre. Va aquí, encima de los conectores, porque el orden de uso es
              levantar el simulador y después conectarse a él en modo sim.
              La etiqueta va corta ("Simulation Studio") porque el sidebar
              colapsa a 250px y el nombre completo no entra en una línea.
              El icono es la marca del Studio (mss.svg), la misma que lleva su
              ejecutable: antes apuntaba a "simulator.svg", que no existe en
              public/icons, y la fila caía siempre al robot de tabler. */}
          {HAS_SIM_STUDIO && (
            <TreeLeaf
              svg="mss.svg"
              icon="ti-robot"
              iconColor={simDisponible === false ? "var(--icon-tree-disabled, var(--icon-tree))" : "var(--icon-tree)"}
              label="Simulation Studio"
              collapsed={collapsed}
              onClick={abrirSim}
            />
          )}
          <TreeLeaf
            svg="connect.svg"
            icon="ti-player-play"
            iconColor={connection === "sim" ? "var(--status-sim)" : "var(--icon-tree)"}
            label="Connect Sim"
            collapsed={collapsed}
            onClick={connection === "sim" ? onDisconnect : onConnectSim}
            trailing={<CheckBox checked={connection === "sim"} />}
          />
          <TreeLeaf
            svg="connect.svg"
            icon="ti-player-play"
            iconColor={connection === "real" ? "var(--status-error)" : "var(--icon-tree)"}
            label="Connect Real"
            collapsed={collapsed}
            onClick={connection === "real" ? onDisconnect : onConnectReal}
            trailing={<CheckBox checked={connection === "real"} />}
          />
        </TreeGroup>

        <TreeGroup title="Tools" icon="ti-tool" collapsed={collapsed}>
          {openTabs.map(tab => (
            <ToolTabRow
              key={tab.id}
              tab={tab}
              collapsed={collapsed}
              selected={tab.id === activeTabId}
              editing={editingTabId === tab.id}
              onSelect={() => onSelectTab(tab.id)}
              onStartEdit={() => setEditingTabId(tab.id)}
              onCommit={(title) => { onRenameTab(tab.id, title); setEditingTabId(null) }}
              onCancelEdit={() => setEditingTabId(null)}
            />
          ))}
        </TreeGroup>

        {/* Colapsado no hay lugar para la botonera: queda solo el "+", que es
            la única acción que no depende de tener una fila seleccionada. */}
        {collapsed ? (
          <RailAddButton onCreateTab={onCreateTab} />
        ) : (
          <ButtonBar>
            <AddToolButton onCreateTab={onCreateTab} />
            <ClassicButton label="Rename" disabled={!selectedTab} onClick={() => selectedTab && setEditingTabId(selectedTab.id)} />
            <ClassicButton label="Remove" disabled={!selectedTab} onClick={handleRemove} />
          </ButtonBar>
        )}

        <TreeGroup title="Modules" icon="ti-blocks" collapsed={collapsed}>
          {MODULE_ITEMS.map(item => (
            <TreeLeaf
              key={item.page}
              svg={item.svg}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              selected={activeTabId === null && currentPage === item.page}
              onClick={() => navigate(item.page)}
            />
          ))}
          <TreeLeaf svg="phone.svg" icon="ti-device-mobile" label="Phone" collapsed={collapsed} selected={activeTabId === null && currentPage === "phone"} onClick={() => navigate("phone")} />
        </TreeGroup>

        <TreeGroup title="Config" icon="ti-settings" collapsed={collapsed}>
          {CONFIG_ITEMS.map(item => (
            <TreeLeaf
              key={item.page}
              svg={item.svg}
              icon={item.icon}
              label={item.label}
              collapsed={collapsed}
              selected={activeTabId === null && currentPage === item.page}
              onClick={() => navigate(item.page)}
            />
          ))}
          <TreeLeaf svg="loop-timing.svg" icon="ti-activity-heartbeat" label="Loop Timing" collapsed={collapsed} selected={activeTabId === null && currentPage === "jitter"} onClick={() => navigate("jitter")} />
          <TreeLeaf svg="sysid.svg" icon="ti-math-avg" label="SysId" collapsed={collapsed} selected={activeTabId === null && currentPage === "sysid"} onClick={() => navigate("sysid")} />
          <TreeLeaf svg="preferences.svg" icon="ti-adjustments-alt" label="Preferences" collapsed={collapsed} selected={activeTabId === null && currentPage === "preferences"} onClick={() => navigate("preferences")} />
          <TreeLeaf svg="network.svg" icon="ti-antenna-bars-5" label="Bandwidth" collapsed={collapsed} selected={activeTabId === null && currentPage === "bandwidth"} onClick={() => navigate("bandwidth")} />
          <TreeLeaf svg="console.svg" icon="ti-terminal-2" label="Console" collapsed={collapsed} selected={activeTabId === null && currentPage === "console"} onClick={() => navigate("console")} />
          <TreeLeaf svg="settings.svg" icon="ti-settings" label="Settings" collapsed={collapsed} selected={activeTabId === null && currentPage === "settings"} onClick={() => navigate("settings")} />
        </TreeGroup>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Piezas del árbol
// ---------------------------------------------------------------------------

function CollapseBar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={{
      display: "flex", alignItems: "center",
      justifyContent: collapsed ? "center" : "flex-end",
      height: 24, padding: collapsed ? 0 : "0 4px", flexShrink: 0,
      background: "var(--bg-panel-header)",
      borderBottom: "1px solid var(--border-main)",
    }}>
      <button
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 18, padding: 0,
          background: hovered ? "var(--bg-panel-header-hover)" : "transparent",
          border: "none", borderRadius: 2, cursor: "pointer",
          color: "var(--text-muted)",
        }}
      >
        <i className={`ti ${collapsed ? "ti-chevron-right" : "ti-chevron-left"}`} style={{ fontSize: 12 }} aria-hidden />
      </button>
    </div>
  )
}

function rowStyle(selected: boolean, hovered: boolean, indent: number, collapsed: boolean): CSSProperties {
  return {
    display: "flex", alignItems: "center",
    gap: collapsed ? 0 : 6,
    justifyContent: collapsed ? "center" : "flex-start",
    height: collapsed ? 28 : "var(--tree-row-height)",
    padding: collapsed ? 0 : `0 8px 0 ${8 + indent * 16}px`,
    fontSize: 11,
    background: selected ? "var(--tree-selection-bg)" : hovered ? "var(--tree-hover-bg)" : "transparent",
    color: selected ? "var(--tree-selection-fg)" : "var(--text-primary)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
  }
}

// Nodo padre plegable: flecha + ícono + título en negrita, sobre la banda gris
// que separa cada grupo (el equivalente al ítem raíz de un QTreeWidget).
// Colapsado se reduce a una línea: el título no entra y plegarlo dejaría
// filas escondidas sin ninguna pista de que existen.
function TreeGroup({ title, icon, collapsed, children }: {
  title: string
  icon: string
  collapsed: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const [hovered, setHovered] = useState(false)

  if (collapsed) {
    return (
      <div>
        <div style={{ height: 1, background: "var(--border-main)", margin: "4px 8px" }} />
        {children}
      </div>
    )
  }

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          height: "var(--tree-row-height)", padding: "0 8px",
          fontSize: 11, fontWeight: 600, color: "var(--text-primary)",
          background: hovered ? "var(--bg-panel-header-hover)" : "var(--bg-panel-header)",
          borderTop: "1px solid var(--border-light)",
          borderBottom: "1px solid var(--border-main)",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <i className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`} style={{ fontSize: 10, color: "var(--text-muted)", width: 10, flexShrink: 0 }} aria-hidden />
        <i className={`ti ${icon}`} style={{ fontSize: 12, color: "var(--icon-tree)", width: 14, textAlign: "center", flexShrink: 0 }} aria-hidden />
        <span>{title}</span>
      </div>
      {open && children}
    </div>
  )
}

// Hoja del árbol: ícono + label, con selección azul sólida y un control
// opcional a la derecha (el checkbox de "visible" de RViz).
function TreeLeaf({
  svg, icon, label, iconColor, selected = false, indent = 1, trailing, collapsed, onClick, onDoubleClick,
}: {
  svg?: string
  icon: string
  label: string
  iconColor?: string
  selected?: boolean
  indent?: number
  trailing?: ReactNode
  collapsed: boolean
  onClick: () => void
  onDoubleClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Colapsado el nombre solo existe en el tooltip.
      title={collapsed ? label : undefined}
      style={rowStyle(selected, hovered, indent, collapsed)}
    >
      <SidebarIcon
        svg={svg}
        fallback={icon}
        size={collapsed ? 20 : 16}
        color={selected ? "var(--tree-selection-fg)" : iconColor}
      />
      {!collapsed && (
        <>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          {trailing}
        </>
      )}
    </div>
  )
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span style={{
      width: 12, height: 12, flexShrink: 0,
      border: "1px solid #767676", background: "var(--bg-input)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {checked && <i className="ti ti-check" style={{ fontSize: 9, color: "var(--tree-selection-bg)" }} aria-hidden />}
    </span>
  )
}

// Fila de pestaña: igual que una hoja, pero el label se convierte en input al
// renombrar (doble click o el botón "Rename" de la botonera).
function ToolTabRow({
  tab, selected, editing, collapsed, onSelect, onStartEdit, onCommit, onCancelEdit,
}: {
  tab: WorkspaceTab
  selected: boolean
  editing: boolean
  collapsed: boolean
  onSelect: () => void
  onStartEdit: () => void
  onCommit: (title: string) => void
  onCancelEdit: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [draft, setDraft] = useState(tab.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(tab.title)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) onCommit(trimmed)
    else onCancelEdit()
  }

  const meta = TOOL_KIND_META[tab.kind]

  return (
    <div
      onClick={() => !editing && onSelect()}
      onDoubleClick={onStartEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? tab.title : undefined}
      style={rowStyle(selected, hovered, 1, collapsed)}
    >
      <SidebarIcon
        svg={meta.svg}
        fallback={meta.icon}
        size={collapsed ? 20 : 16}
        color={selected ? "var(--tree-selection-fg)" : undefined}
      />
      {!collapsed && (editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") onCancelEdit()
          }}
          style={{
            flex: 1, minWidth: 0, fontSize: 11, height: 16, padding: "0 3px",
            border: "1px solid var(--mars-accent)", background: "var(--bg-input)", color: "var(--text-primary)",
          }}
        />
      ) : (
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title}</span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Botonera clásica (Add / Rename / Remove)
// ---------------------------------------------------------------------------

function ButtonBar({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "flex", gap: 4, padding: 5,
      background: "var(--bg-sidebar)",
      borderBottom: "1px solid var(--border-main)",
    }}>
      {children}
    </div>
  )
}

function ClassicButton({
  label, onClick, disabled = false,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const background = disabled
    ? "var(--btn-classic-bg)"
    : pressed ? "var(--btn-classic-bg-active)"
    : hovered ? "var(--btn-classic-bg-hover)"
    : "var(--btn-classic-bg)"

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        flex: 1, height: 22, fontSize: 10.5,
        background,
        border: "1px solid var(--btn-classic-border)",
        color: disabled ? "var(--btn-classic-text-disabled)" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  )
}

// Menú de tipos compartido por la botonera y el riel colapsado.
function ToolTypeMenu({ onPick, align }: { onPick: (kind: ToolKind) => void; align: "left" | "center" }) {
  return (
    <div style={{
      position: "absolute", top: "100%", marginTop: 2, zIndex: 300,
      left: align === "left" ? 0 : "50%",
      transform: align === "center" ? "translateX(-50%)" : undefined,
      background: "var(--bg-page)", border: "1px solid var(--border-dark)",
      minWidth: 168, boxShadow: "0 2px 6px var(--shadow-soft)",
    }}>
      {TOOL_KIND_ORDER.map(kind => (
        <AddToolOption key={kind} kind={kind} onPick={() => onPick(kind)} />
      ))}
    </div>
  )
}

// Cierra el menú al hacer click afuera. Vive acá porque los dos botones que
// abren el menú (botonera y riel) necesitan exactamente lo mismo.
function useDismissOnOutsideClick(open: boolean, onDismiss: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open, onDismiss])

  return rootRef
}

// "Add" abre el selector de tipo de herramienta — el equivalente compacto al
// diálogo de tipos de display de RViz. Las pestañas solo nacen desde acá.
function AddToolButton({ onCreateTab }: { onCreateTab: (kind: ToolKind) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useDismissOnOutsideClick(open, () => setOpen(false))

  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1, display: "flex" }}>
      <ClassicButton label="Add" onClick={() => setOpen(o => !o)} />
      {open && <ToolTypeMenu align="left" onPick={(kind) => { onCreateTab(kind); setOpen(false) }} />}
    </div>
  )
}

function RailAddButton({ onCreateTab }: { onCreateTab: (kind: ToolKind) => void }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const rootRef = useDismissOnOutsideClick(open, () => setOpen(false))

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", justifyContent: "center", padding: "4px 0" }}>
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Add tool"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 22, padding: 0,
          background: hovered ? "var(--btn-classic-bg-hover)" : "var(--btn-classic-bg)",
          border: "1px solid var(--btn-classic-border)",
          color: "var(--text-primary)", cursor: "pointer",
        }}
      >
        <i className="ti ti-plus" style={{ fontSize: 12 }} aria-hidden />
      </button>
      {open && <ToolTypeMenu align="center" onPick={(kind) => { onCreateTab(kind); setOpen(false) }} />}
    </div>
  )
}

function AddToolOption({ kind, onPick }: { kind: ToolKind; onPick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const meta = TOOL_KIND_META[kind]

  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        height: "var(--tree-row-height)", padding: "0 8px", fontSize: 11,
        background: hovered ? "var(--tree-selection-bg)" : "transparent",
        color: hovered ? "var(--tree-selection-fg)" : "var(--text-primary)",
        cursor: "pointer", userSelect: "none",
      }}
    >
      <SidebarIcon
        svg={meta.svg}
        fallback={meta.icon}
        size={16}
        color={hovered ? "var(--tree-selection-fg)" : undefined}
      />
      {meta.label}
    </div>
  )
}
