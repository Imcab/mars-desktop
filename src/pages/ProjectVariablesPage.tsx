import { useState, useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import 'katex/dist/katex.min.css'
import { InlineMath } from 'react-katex'
import { toLatex } from "../utils/latexUnits"

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
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Variables Table
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            Project Variables
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.4 }}>
            Project: <span style={{ color: "var(--mars-accent, var(--mars-red))", fontWeight: 600 }}>{projectName.toUpperCase()}</span><br />
            Registered with Unit Processor
          </div>
        </div>

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>

          <div>
            <label style={labelStyle}>SEARCH VARIABLE</label>
            <div style={{ position: "relative" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: 8, color: "var(--text-muted)", fontSize: 14 }} />
              <input
                type="text"
                placeholder="e.g. getVelocity..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>DATA TYPE</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={inputStyle}>
              <option value="all">All Data Types</option>
              <option value="variable">Inputs & Variables</option>
              <option value="function">Functions & Methods</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>RAW TYPE / UNIT</label>
            <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} style={inputStyle}>
              <option value="all">All Raw Types</option>
              {availableUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(""); setTypeFilter("all"); setUnitFilter("all") }}
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
            <label style={{ ...labelStyle, marginBottom: 12 }}>VARIABLE STATISTICS</label>
            <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 4, padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <StatRow label="Subsystems" value={globalStats.subsystems} />
              <StatRow label="Total entries" value={globalStats.total} />
              <StatRow label="Variables" value={globalStats.variables} color="var(--text-primary)" />
              <StatRow label="Functions" value={globalStats.functions} color="var(--module-enabled)" />
              <StatRow label="Unit types" value={availableUnits.length} />
            </div>
          </div>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Unit Registry</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {visibleCount} of {globalStats.total} entries · {globalStats.subsystems} subsystems
          </span>
        </div>

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>

            {filteredData && Object.keys(filteredData).length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 40px", color: "var(--text-muted)", fontSize: 13, border: "1px dashed var(--border-main)", borderRadius: 4 }}>
                <i className="ti ti-file-search" style={{ fontSize: 32, display: "block", marginBottom: 12, opacity: 0.5 }} />
                No variables match your current filters.
              </div>
            )}

            {filteredData && Object.entries(filteredData).map(([subsystem, variables]) => {
              const isCollapsed = collapsed.has(subsystem)
              return (
                <div key={subsystem} style={{ marginBottom: 24, background: "var(--bg-panel)", border: "1px solid var(--border-main)", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    onClick={() => toggleSection(subsystem)}
                    style={{
                      background: "var(--bg-dark)", color: "#fff", padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none",
                      borderBottom: isCollapsed ? "none" : "2px solid var(--border-main)"
                    }}
                  >
                    <i className={`ti ${isCollapsed ? "ti-chevron-right" : "ti-chevron-down"}`} style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }} />
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{subsystem} Subsystem</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 3 }}>
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