import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import PageHeader from "../components/layout/PageHeader"
import PanelHeader from "../components/layout/PanelHeader"
import EmptyState from "../components/common/EmptyState"
import DangerButton from "../components/common/DangerButton"
import Panel from "../components/common/Panel"
import PropertyRow from "../components/common/PropertyRow"
import { propertyInputStyle } from "../styles/pageForm"

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
        <PageHeader
          eyebrow="Hardware Manifest"
          title="Active Modules"
          subtitle={
            <>
              Project: <span style={{ color: "var(--mars-accent)", fontWeight: 600 }}>{projectName.toUpperCase()}</span><br />
              Manifest.java parser
            </>
          }
        />

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 24, overflowY: "auto" }}>

          <Panel title="Filters" icon="ti-filter">
            <div>
              <PropertyRow label="Search module">
                <input
                  type="text"
                  placeholder="e.g. drivetrain..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={propertyInputStyle}
                />
              </PropertyRow>
              <PropertyRow label="Module status">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={propertyInputStyle}>
                  <option value="all">All Modules</option>
                  <option value="enabled">Enabled Only</option>
                  <option value="disabled">Disabled Only</option>
                </select>
              </PropertyRow>
            </div>
            {hasActiveFilters && (
              <div style={{ padding: 8 }}>
                <DangerButton onClick={() => { setSearchQuery(""); setStatusFilter("all") }}>
                  CLEAR ALL FILTERS
                </DangerButton>
              </div>
            )}
          </Panel>

          <Panel title="Module Statistics" icon="ti-chart-bar">
            <div>
              <PropertyRow label="Total modules"><span>{stats.total}</span></PropertyRow>
              <PropertyRow label="Enabled"><span style={{ color: "var(--module-enabled)" }}>{stats.enabled}</span></PropertyRow>
              <PropertyRow label="Disabled"><span style={{ color: "var(--text-muted)" }}>{stats.disabled}</span></PropertyRow>
            </div>
          </Panel>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <PanelHeader
          title="Detected Modules"
          meta={`${stats.total} total · ${stats.enabled} enabled · ${stats.disabled} disabled`}
        />

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 800, margin: "0 auto" }}>

            {filteredFeatures && Object.keys(filteredFeatures).length === 0 && (
              <EmptyState icon="ti-blocks" message="No modules match your current filters." />
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

