import { Page, ConnectionState } from "../store/appStore"

interface Props {
  navigate: (page: Page) => void
  onOpenProject: () => void
  connection: ConnectionState
  onConnectSim: () => void
  onConnectReal: () => void
  onDisconnect: () => void
  projectName: string | null
}

export default function WelcomePage({ navigate, onOpenProject, projectName }: Props) {

  return (
    <div style={{ flex: 1, display: "flex", justifyContent: "center", background: "var(--bg-page)", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 820, padding: "48px 24px 60px" }}>

        {/* HERO: LOGO PREDOMINANTE */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="/marsblacklogo.png" alt="MARS Logo" style={{ height: 190, objectFit: "contain" }} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 0 }}>
            Modular Architecture for Robot Systems
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
            {projectName ? (
              <span style={{ color: "var(--mars-accent, var(--mars-red))", fontWeight: 600 }}>PROJECT: {projectName.toUpperCase()}</span>
            ) : "no project loaded"}
          </div>
        </div>

        {/* SECCIONES DE ACCESOS RÁPIDOS */}
        <LaunchSection
          title="PROJECT"
          items={[
            { icon: "ti-plus", title: "New project", desc: "Start a MARS robot project from scratch", page: "creator" as Page },
            { icon: "ti-folder-open", title: "Open project", desc: "Load an existing project from disk", action: onOpenProject },
            { icon: "ti-file-plus", title: "Project wizard", desc: "Guided setup for a new robot codebase", page: "wizard" as Page },
            { icon: "ti-settings", title: "Settings", desc: "Configure workspace paths and defaults", page: "settings" as Page },
          ]}
          navigate={navigate}
        />

        <LaunchSection
          title="LIVE DATA"
          items={[
            { icon: "ti-vector", title: "2D Visualizer", desc: "Visualize robot mechanisms via NT4", page: "visualizer" as Page },
            { icon: "ti-chart-line", title: "Telemetry", desc: "Live variable inspector for all NT4 topics", page: "telemetry" as Page },
            { icon: "ti-layout-dashboard", title: "Display", desc: "Build a custom live dashboard", page: "display" as Page },
            { icon: "ti-wave-sine", title: "Function plot", desc: "Plot and transform numeric topics over time", page: "functions" as Page },
          ]}
          navigate={navigate}
        />

        <LaunchSection
          title="TOOLS"
          items={[
            { icon: "ti-package", title: "Package manager", desc: "Browse and install MARS modules", page: "packages" as Page },
            { icon: "ti-variable", title: "Variables table", desc: "Units and raw types registered by the project", page: "variables" as Page },
            { icon: "ti-blocks", title: "Manifest table", desc: "Hardware modules detected in Manifest.java", page: "manifest" as Page },
            { icon: "ti-device-mobile", title: "Phone telemetry", desc: "Cast the dashboard to a mobile device", page: "phone" as Page },
          ]}
          navigate={navigate}
        />

      </div>
    </div>
  )
}

interface LaunchItem {
  icon: string
  title: string
  desc: string
  page?: Page
  action?: () => void
}

function LaunchSection({ title, items, navigate }: { title: string, items: LaunchItem[], navigate: (page: Page) => void }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1 }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-light)" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {items.map(card => {
          const isClickable = card.page !== undefined || card.action !== undefined

          return (
            <div
              key={card.title}
              onClick={() => card.action ? card.action() : card.page && navigate(card.page)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                background: "var(--bg-panel)", border: "1px solid var(--border-main)", color: "var(--text-primary)",
                borderRadius: 3, padding: "14px 16px", cursor: isClickable ? "pointer" : "default"
              }}
              onMouseEnter={e => isClickable && ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-input)")}
              onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-panel)")}
            >
              <i className={`ti ${card.icon}`} style={{ fontSize: 20, color: "var(--mars-red, var(--mars-red))", flexShrink: 0, marginTop: 2 }} aria-hidden />
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{card.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{card.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
