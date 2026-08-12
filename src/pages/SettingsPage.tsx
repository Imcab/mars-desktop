import { useState, useEffect } from "react"
import { useMarsSettings, MarsSettings } from "../hooks/useMarsSettings"
import { open } from "@tauri-apps/plugin-dialog"

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
      <div style={{ maxWidth: 640, width: "100%" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Framework Settings</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>Configuration</div>
          <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>
            Native App Configuration · MARS Core
          </div>
        </div>

        <Section title="Core Configuration">
          <Field label="DEFAULT TEAM NUMBER">
            <input
              value={form.team_number}
              onChange={e => setForm(p => ({ ...p, team_number: e.target.value }))}
              style={inputStyle}
              placeholder="e.g. 3472"
            />
          </Field>
          <Field label="">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.auto_save_deploy}
                onChange={e => setForm(p => ({ ...p, auto_save_deploy: e.target.checked }))}
              />
              Auto-Save all files before deploying to RoboRIO
            </label>
          </Field>
        </Section>

        <Section title="System Paths">
          <Field label="DEFAULT WORKSPACE BASE FOLDER">
            <div style={{ display: "flex", gap: 8 }}>
              <input value={form.workspace_path} onChange={e => setForm(p => ({ ...p, workspace_path: e.target.value }))} style={{ ...inputStyle, flex: 1 }} placeholder="C:\..." />
              <BrowseBtn onClick={() => browseFolder("workspace_path")} />
            </div>
          </Field>
          <Field label="MARS TOOLS DIRECTORY (GLOBAL)">
            <div style={{ display: "flex", gap: 8 }}>
              <input value={form.tools_path} onChange={e => setForm(p => ({ ...p, tools_path: e.target.value }))} style={{ ...inputStyle, flex: 1 }} placeholder="C:\Users\...\MARSTools" />
              <BrowseBtn onClick={() => browseFolder("tools_path")} />
            </div>
          </Field>
        </Section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
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

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "28px 20px", background: "var(--bg-page)", overflowY: "auto" }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-panel)", border: "0.5px solid var(--border-main)", borderRadius: 3, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14, paddingBottom: 8, borderBottom: "0.5px solid var(--border-light)" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 5 }}>{label}</div>}
      {children}
    </div>
  )
}

function BrowseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "5px 14px", fontSize: 11, background: "var(--bg-menubar)", border: "0.5px solid var(--border-main)", borderRadius: 3, cursor: "pointer", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
      Browse
    </button>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 10px", fontSize: 12,
  border: "0.5px solid var(--border-main)", borderRadius: 3,
  background: "var(--bg-input)", color: "var(--text-primary)",
  outline: "none",
}