import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import 'katex/dist/katex.min.css'
import { InlineMath } from 'react-katex'
import { toLatex } from "../utils/latexUnits"
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

export default function ProjectVariablesPage({ projectName, projectPath }: Props) {
  const [unitsData, setUnitsData] = useState<Record<string, Record<string, string>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "variable" | "function">("all")
  const [unitFilter, setUnitFilter] = useState<string>("all")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!projectName || !projectPath) {
      setLoading(false)
      return
    }

    invoke<string>("read_project_units", { projectPath })
      .then(res => { setUnitsData(JSON.parse(res)); setLoading(false) })
      .catch(err => { setError(err); setLoading(false) })
  }, [projectName, projectPath])

  const availableUnits = useMemo(() => {
    if (!unitsData) return []
    const units = new Set<string>()
    Object.values(unitsData).forEach(subsystem => {
      Object.values(subsystem).forEach(unit => units.add(unit))
    })
    return Array.from(units).sort()
  }, [unitsData])

  const globalStats = useMemo(() => {
    if (!unitsData) return { subsystems: 0, total: 0, variables: 0, functions: 0 }
    let total = 0, functions = 0
    Object.values(unitsData).forEach(subsystem => {
      Object.keys(subsystem).forEach(key => {
        total++
        if (key.includes("(")) functions++
      })
    })
    return { subsystems: Object.keys(unitsData).length, total, variables: total - functions, functions }
  }, [unitsData])

  const filteredData = useMemo(() => {
    if (!unitsData) return null
    const filtered: Record<string, Record<string, string>> = {}

    Object.entries(unitsData).forEach(([subsystem, variables]) => {
      const filteredVars: Record<string, string> = {}

      Object.entries(variables).forEach(([key, unit]) => {
        const isFunction = key.includes("(")
        if (searchQuery.trim() !== "" && !key.toLowerCase().includes(searchQuery.toLowerCase())) return
        if (typeFilter === "variable" && isFunction) return
        if (typeFilter === "function" && !isFunction) return
        if (unitFilter !== "all" && unit !== unitFilter) return
        filteredVars[key] = unit
      })

      if (Object.keys(filteredVars).length > 0) filtered[subsystem] = filteredVars
    })

    return filtered
  }, [unitsData, searchQuery, typeFilter, unitFilter])

  const toggleSection = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

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
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Parsing project units...</p>
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

  const hasActiveFilters = searchQuery !== "" || typeFilter !== "all" || unitFilter !== "all"
  const visibleCount = filteredData ? Object.values(filteredData).reduce((sum, v) => sum + Object.keys(v).length, 0) : 0

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <PageHeader
          eyebrow="Variables Table"
          title="Project Variables"
          subtitle={
            <>
              Project: <span style={{ color: "var(--mars-accent)", fontWeight: 600 }}>{projectName.toUpperCase()}</span><br />
              Registered with Unit Processor
            </>
          }
        />

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 24, overflowY: "auto" }}>

          <Panel title="Filters" icon="ti-filter">
            <div>
              <PropertyRow label="Search variable">
                <input
                  type="text"
                  placeholder="e.g. getVelocity..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={propertyInputStyle}
                />
              </PropertyRow>
              <PropertyRow label="Data type">
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={propertyInputStyle}>
                  <option value="all">All Data Types</option>
                  <option value="variable">Inputs & Variables</option>
                  <option value="function">Functions & Methods</option>
                </select>
              </PropertyRow>
              <PropertyRow label="Raw type / unit">
                <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} style={propertyInputStyle}>
                  <option value="all">All Raw Types</option>
                  {availableUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </PropertyRow>
            </div>
            {hasActiveFilters && (
              <div style={{ padding: 8 }}>
                <DangerButton onClick={() => { setSearchQuery(""); setTypeFilter("all"); setUnitFilter("all") }}>
                  CLEAR ALL FILTERS
                </DangerButton>
              </div>
            )}
          </Panel>

          <Panel title="Variable Statistics" icon="ti-chart-bar">
            <div>
              <PropertyRow label="Subsystems"><span>{globalStats.subsystems}</span></PropertyRow>
              <PropertyRow label="Total entries"><span>{globalStats.total}</span></PropertyRow>
              <PropertyRow label="Variables"><span style={{ color: "var(--text-primary)" }}>{globalStats.variables}</span></PropertyRow>
              <PropertyRow label="Functions"><span style={{ color: "var(--module-enabled)" }}>{globalStats.functions}</span></PropertyRow>
              <PropertyRow label="Unit types"><span>{availableUnits.length}</span></PropertyRow>
            </div>
          </Panel>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <PanelHeader
          title="Unit Registry"
          meta={`${visibleCount} of ${globalStats.total} entries · ${globalStats.subsystems} subsystems`}
        />

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>

            {filteredData && Object.keys(filteredData).length === 0 && (
              <EmptyState icon="ti-file-search" message="No variables match your current filters." />
            )}

            {filteredData && Object.entries(filteredData).map(([subsystem, variables]) => {
              const isCollapsed = collapsed.has(subsystem)
              return (
                <div key={subsystem} style={{ marginBottom: 24, background: "var(--bg-panel)", border: "1px solid var(--border-main)", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    onClick={() => toggleSection(subsystem)}
                    style={{
                      background: "var(--bg-menubar)", color: "var(--text-primary)", padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none",
                      borderBottom: isCollapsed ? "none" : "2px solid var(--border-main)"
                    }}
                  >
                    <i className={`ti ${isCollapsed ? "ti-chevron-right" : "ti-chevron-down"}`} style={{ fontSize: 14, color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{subsystem} Subsystem</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", background: "var(--bg-page)", padding: "2px 6px", borderRadius: 3 }}>
                      {Object.keys(variables).length} entries
                    </span>
                  </div>

                  {!isCollapsed && (
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg-panel)" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-page)", borderBottom: "1px solid var(--border-main)", fontSize: 10, color: "var(--text-secondary)", textAlign: "left" }}>
                          <th style={{ padding: "10px 14px", width: "50%" }}>DATA</th>
                          <th style={{ padding: "10px 14px", width: "25%" }}>RAW TYPE</th>
                          <th style={{ padding: "10px 14px", width: "25%", textAlign: "center" }}>NOTATION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(variables).map(([key, unit], index) => {
                          const isFunction = key.includes("(")
                          const mathNotation = toLatex(unit) || `\\text{${unit}}`

                          return (
                            <tr key={key} style={{ borderBottom: "1px solid var(--border-light)", background: index % 2 === 0 ? "var(--bg-panel)" : "var(--bg-input)" }}>
                              <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace", color: isFunction ? "var(--module-enabled)" : "var(--text-primary)" }}>
                                {key}
                              </td>
                              <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-muted)" }}>
                                <span style={{ background: "var(--bg-menubar)", padding: "3px 8px", borderRadius: 3 }}>{unit}</span>
                              </td>
                              <td style={{ padding: "14px", textAlign: "center", fontSize: 15 }}>
                                <InlineMath math={mathNotation} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

