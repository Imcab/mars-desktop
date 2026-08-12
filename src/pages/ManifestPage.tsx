import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"

interface Props {
  projectName: string | null
  projectPath: string | null
}

export default function ManifestPage({ projectName, projectPath }: Props) {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all")

  useEffect(() => {
    if (!projectName || !projectPath) {
      setLoading(false)
      return
    }

    invoke<Record<string, boolean>>("read_manifest_features", { projectPath })
      .then(res => { setFeatures(res); setLoading(false) })
      .catch(err => { setError(err); setLoading(false) })
  }, [projectName, projectPath])

  const stats = useMemo(() => {
    if (!features) return { total: 0, enabled: 0, disabled: 0 }
    const entries = Object.values(features)
    const enabled = entries.filter(Boolean).length
    return { total: entries.length, enabled, disabled: entries.length - enabled }
  }, [features])

  const filteredFeatures = useMemo(() => {
    if (!features) return null
    const filtered: Record<string, boolean> = {}

    Object.entries(features).forEach(([key, isEnabled]) => {
      if (searchQuery.trim() !== "" && !key.toLowerCase().includes(searchQuery.toLowerCase())) return
      if (statusFilter === "enabled" && !isEnabled) return
      if (statusFilter === "disabled" && isEnabled) return
      filtered[key] = isEnabled
    })

    return filtered
  }, [features, searchQuery, statusFilter])

  const { enabledEntries, disabledEntries } = useMemo(() => {
    const enabledEntries: [string, boolean][] = []
    const disabledEntries: [string, boolean][] = []
    if (filteredFeatures) {
      Object.entries(filteredFeatures)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(entry => (entry[1] ? enabledEntries : disabledEntries).push(entry))
    }
    return { enabledEntries, disabledEntries }
  }, [filteredFeatures])

  if (!projectName) {
    return (
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", background: "var(--bg-page)" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No active project selected. Please open a project first.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", background: "var(--bg-page)" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Scanning Manifest.java...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", background: "var(--bg-page)" }}>
        <p style={{ color: "var(--status-error)", fontSize: 13 }}>Error: {error}</p>
      </div>
    )
  }

  const hasActiveFilters = searchQuery !== "" || statusFilter !== "all"

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Hardware Manifest
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            Active Modules
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.4 }}>
            Project: <span style={{ color: "var(--mars-accent, var(--mars-red))", fontWeight: 600 }}>{projectName.toUpperCase()}</span><br />
            Manifest.java parser
          </div>
        </div>

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>

          <div>
            <label style={labelStyle}>SEARCH MODULE</label>
            <div style={{ position: "relative" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: 8, color: "var(--text-muted)", fontSize: 14 }} />
              <input
                type="text"
                placeholder="e.g. drivetrain..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>MODULE STATUS</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={inputStyle}>
              <option value="all">All Modules</option>
              <option value="enabled">Enabled Only</option>
              <option value="disabled">Disabled Only</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(""); setStatusFilter("all") }}
              style={{
                padding: "8px 0", background: "rgba(214, 92, 92, 0.1)",
                border: "1px solid rgba(214, 92, 92, 0.3)", borderRadius: 3,
                color: "var(--status-error)", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              CLEAR ALL FILTERS
            </button>
          )}

          <div style={{ height: 1, background: "var(--border-light)", margin: "4px 0" }} />

          <div>
            <label style={{ ...labelStyle, marginBottom: 12 }}>MODULE STATISTICS</label>
            <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 4, padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <StatRow label="Total modules" value={stats.total} />
              <StatRow label="Enabled" value={stats.enabled} color="var(--module-enabled)" />
              <StatRow label="Disabled" value={stats.disabled} color="var(--text-muted)" />
            </div>
          </div>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Detected Modules</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {stats.total} total · {stats.enabled} enabled · {stats.disabled} disabled
          </span>
        </div>

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 800, margin: "0 auto" }}>

            {filteredFeatures && Object.keys(filteredFeatures).length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 40px", color: "var(--text-muted)", fontSize: 13, border: "1px dashed var(--border-main)", borderRadius: 4 }}>
                <i className="ti ti-blocks" style={{ fontSize: 32, display: "block", marginBottom: 12, opacity: 0.5 }} />
                No modules match your current filters.
              </div>
            )}

            {enabledEntries.length > 0 && (
              <ModuleSection title="ENABLED" entries={enabledEntries} />
            )}
            {disabledEntries.length > 0 && (
              <ModuleSection title="DISABLED" entries={disabledEntries} />
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

function ModuleSection({ title, entries }: { title: string, entries: [string, boolean][] }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1 }}>{title}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg-input)", border: "1px solid var(--border-main)", padding: "1px 6px", borderRadius: 3 }}>{entries.length}</span>
        <div style={{ flex: 1, height: 1, background: "var(--border-light)" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {entries.map(([key, isEnabled]) => (
          <div key={key} style={{
            display: "flex", justifyContent: "space-between", alignItems: "stretch",
            background: "var(--bg-input)", border: "1px solid var(--border-main)",
            borderRadius: 4, overflow: "hidden", height: 48
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", flex: 1, overflow: "hidden" }}>
              <i className={`ti ${isEnabled ? "ti-circle-check" : "ti-circle-x"}`} style={{ color: isEnabled ? "var(--module-enabled)" : "var(--text-muted)", fontSize: 14, flexShrink: 0 }} />
              <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {key.toLowerCase()}
              </span>
            </div>
            <div style={{ width: 48, background: isEnabled ? "var(--module-enabled)" : "var(--module-disabled)", flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string, value: string | number, color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--text-light)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, fontWeight: 600
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "8px 12px", borderRadius: 3, fontSize: 12, outline: "none", cursor: "pointer", boxSizing: "border-box"
}