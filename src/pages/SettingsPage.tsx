import { useState, useEffect } from "react"
import { useMarsSettings, MarsSettings, NTTarget, NT_TARGET_PORTS } from "../hooks/useMarsSettings"
import { open } from "@tauri-apps/plugin-dialog"
import Panel from "../components/common/Panel"
import PropertyRow from "../components/common/PropertyRow"
import { propertyInputStyle } from "../styles/pageForm"
import { MARS_ENABLED } from "@mars"
import { MARS_PRODUCT_NAME } from "../constants/edition"

export default function SettingsPage() {
  const { settings, save, loading, error } = useMarsSettings()
  const [form, setForm] = useState<MarsSettings>(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setForm(settings) }, [settings])

  const handleSave = async () => {
    await save(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const browseFolder = async (field: "workspace_path" | "tools_path") => {
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === "string") {
      setForm(prev => ({ ...prev, [field]: selected }))
    }
  }

  if (loading) return <PageShell><p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading configuration...</p></PageShell>
  if (error) return <PageShell><p style={{ color: "var(--status-error)", fontSize: 13 }}>Error: {error}</p></PageShell>

  return (
    <PageShell>
      <div style={{ maxWidth: 640, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Framework Settings</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>Configuration</div>
          <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>
            Native App Configuration · {MARS_PRODUCT_NAME}
          </div>
        </div>

        <Panel title="Core Configuration" icon="ti-settings">
          <div>
            <PropertyRow label="Default team number">
              <input
                value={form.team_number}
                onChange={e => setForm(p => ({ ...p, team_number: e.target.value }))}
                style={propertyInputStyle}
                placeholder="e.g. 3472"
              />
            </PropertyRow>
            <PropertyRow label="Auto-save before deploy">
              <input
                type="checkbox"
                checked={form.auto_save_deploy}
                onChange={e => setForm(p => ({ ...p, auto_save_deploy: e.target.checked }))}
              />
            </PropertyRow>
          </div>
        </Panel>

        {/* El puerto NT4 no es siempre 5810: la Driver Station reexpone los
            datos en 6767 sobre localhost y Systemcore usa 6810. Antes estaba
            fijo en el cliente de Rust. */}
        <Panel title="NetworkTables" icon="ti-antenna">
          <div>
            <PropertyRow label="Server target">
              <select
                value={form.nt_target}
                onChange={e => setForm(p => ({ ...p, nt_target: e.target.value as NTTarget }))}
                style={propertyInputStyle}
              >
                {NT_TARGET_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </PropertyRow>

            {form.nt_target === "custom" && (
              <PropertyRow label="Custom port" indent={1}>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.nt_custom_port}
                  onChange={e => setForm(p => ({ ...p, nt_custom_port: clampPort(e.target.value) }))}
                  style={propertyInputStyle}
                />
              </PropertyRow>
            )}

            <PropertyRow label="Robot address">
              <input
                value={form.nt_custom_address}
                onChange={e => setForm(p => ({ ...p, nt_custom_address: e.target.value }))}
                style={propertyInputStyle}
                placeholder={`empty = from team number (${teamAddress(form.team_number)})`}
              />
            </PropertyRow>

            <PropertyRow label="Resolved endpoint">
              <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)" }}>
                {resolvedEndpoint(form)}
              </span>
            </PropertyRow>
          </div>
        </Panel>

        {/* Rutas y publicacion de features solo tienen sentido con el
            framework: en la edicion Tools no hay workspace ni features que
            empaquetar. El config.json guarda igual los campos, asi que cambiar
            de edicion no borra lo que ya habia escrito. */}
        {MARS_ENABLED && (
        <>
        <Panel title="System Paths" icon="ti-folder-cog">
          <div>
            <PropertyRow label="Workspace base folder">
              <div style={{ display: "flex", gap: 6, width: "100%" }}>
                <input value={form.workspace_path} onChange={e => setForm(p => ({ ...p, workspace_path: e.target.value }))} style={{ ...propertyInputStyle, flex: 1 }} placeholder="C:\..." />
                <BrowseBtn onClick={() => browseFolder("workspace_path")} />
              </div>
            </PropertyRow>
            <PropertyRow label="MARS tools directory">
              <div style={{ display: "flex", gap: 6, width: "100%" }}>
                <input value={form.tools_path} onChange={e => setForm(p => ({ ...p, tools_path: e.target.value }))} style={{ ...propertyInputStyle, flex: 1 }} placeholder="C:\Users\...\MARSTools" />
                <BrowseBtn onClick={() => browseFolder("tools_path")} />
              </div>
            </PropertyRow>
          </div>
        </Panel>

        {/* Prefill del wizard de features: se guarda acá para no volver a
            escribir autor y usuario de GitHub en cada paquete nuevo. */}
        <Panel title="Feature Publishing" icon="ti-puzzle">
          <div>
            <PropertyRow label="Feature author">
              <input value={form.feature_author} onChange={e => setForm(p => ({ ...p, feature_author: e.target.value }))} style={propertyInputStyle} placeholder="STZ-Robotics" />
            </PropertyRow>
            <PropertyRow label="GitHub user or org">
              <input value={form.github_user} onChange={e => setForm(p => ({ ...p, github_user: e.target.value }))} style={propertyInputStyle} placeholder="Imcab" />
            </PropertyRow>
          </div>
        </Panel>

        </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSave}
            style={{
              padding: "8px 28px", fontSize: 12, fontWeight: 500,
              background: saved ? "var(--status-success)" : "var(--mars-red)",
              color: "#fff", border: "none", borderRadius: 3, cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            {saved ? "✓ Saved" : "Save configuration"}
          </button>
        </div>
      </div>
    </PageShell>
  )
}

const NT_TARGET_OPTIONS: { value: NTTarget; label: string }[] = [
  { value: "default", label: `Robot / Simulator — ${NT_TARGET_PORTS.default}` },
  { value: "ds", label: `Driver Station — ${NT_TARGET_PORTS.ds}` },
  { value: "systemcore", label: `Systemcore — ${NT_TARGET_PORTS.systemcore}` },
  { value: "custom", label: "Custom port…" },
]

function clampPort(raw: string): number {
  const n = parseInt(raw, 10)
  if (isNaN(n)) return NT_TARGET_PORTS.default
  return Math.min(65535, Math.max(1, n))
}

// Misma derivación que hace el backend (3472 -> 10.34.72.2); acá solo sirve
// para mostrarle al usuario a dónde va a ir si deja la dirección vacía.
function teamAddress(team: string): string {
  const n = parseInt(team.trim(), 10)
  if (isNaN(n)) return team.trim() || "—"
  return `10.${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}.2`
}

function resolvedEndpoint(form: MarsSettings): string {
  const port = form.nt_target === "custom" ? form.nt_custom_port : NT_TARGET_PORTS[form.nt_target]
  const host = form.nt_custom_address.trim() || teamAddress(form.team_number)
  return `${host}:${port}`
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "28px 20px", background: "var(--bg-page)", overflowY: "auto" }}>
      {children}
    </div>
  )
}

function BrowseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "0 10px", fontSize: 10.5, background: "var(--bg-menubar)", border: "1px solid var(--border-main)", borderRadius: 2, cursor: "pointer", color: "var(--text-primary)", whiteSpace: "nowrap", height: 20 }}>
      Browse
    </button>
  )
}
