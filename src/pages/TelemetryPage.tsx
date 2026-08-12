import { useState, useEffect, useMemo, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { TopicAnnounce } from "../store/appStore"

interface Props {
  projectName: string | null
  topics: Map<string, TopicAnnounce>
}

type TypeFilter = "all" | "numeric" | "boolean" | "string" | "struct" | "array"

function classify(topicType: string): TypeFilter {
  if (topicType.startsWith("struct:")) return "struct"
  if (topicType.endsWith("[]")) return "array"
  if (topicType === "boolean") return "boolean"
  if (topicType === "double" || topicType === "int" || topicType === "float") return "numeric"
  if (topicType.includes("string")) return "string"
  return "array"
}

function getTypeColor(topicType: string): string {
  const c = classify(topicType)
  if (c === "numeric") return "var(--status-sim)"
  if (c === "boolean") return "var(--mars-red)"
  if (c === "string") return "#e3b341"
  if (c === "struct") return "#4db8d8"
  return "#c76fd1"
}

function formatLiveValue(v: any): string {
  if (v === undefined || v === null) return "—"
  if (v.Boolean !== undefined) return v.Boolean ? "TRUE" : "FALSE"
  if (v.Number !== undefined) return v.Number.toFixed(3)
  if (v.String !== undefined) return v.String
  if (v.NumberArray !== undefined) {
    const arr = v.NumberArray as number[]
    const preview = arr.slice(0, 4).map(n => n.toFixed(2)).join(", ")
    return `[${preview}${arr.length > 4 ? ", …" : ""}] (${arr.length})`
  }
  if (v.Raw !== undefined) return `<${(v.Raw as number[]).length} bytes>`
  return "—"
}

export default function TelemetryPage({ projectName, topics }: Props) {
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [liveValues, setLiveValues] = useState<Record<string, any>>({})

  const topicsRef = useRef(topics)
  topicsRef.current = topics

  // Poll de valores en vivo para toda la tabla. Intervalo más relajado que
  // el del Dashboard (aquí puede haber cientos de topics a la vez).
  useEffect(() => {
    if (topics.size === 0) { setLiveValues({}); return }
    let active = true

    const poll = async () => {
      if (!active) return
      try {
        const names = Array.from(topicsRef.current.keys())
        const data: Record<string, any> = await invoke("get_live_values", { topicNames: names })
        if (active) setLiveValues(data)
      } catch (e) { /* silencioso: puede pasar mientras se reconecta */ }
      if (active) setTimeout(poll, 150)
    }
    poll()
    return () => { active = false }
  }, [topics.size])

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { all: 0, numeric: 0, boolean: 0, string: 0, struct: 0, array: 0 }
    topics.forEach(t => { counts.all++; counts[classify(t.topic_type)]++ })
    return counts
  }, [topics])

  const groupedTopics = useMemo(() => {
    const groups = new Map<string, TopicAnnounce[]>()

    const filtered = Array.from(topics.values()).filter(t => {
      if (searchQuery.trim() !== "" && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (typeFilter !== "all" && classify(t.topic_type) !== typeFilter) return false
      return true
    })

    filtered.forEach(topic => {
      const parts = topic.name.split("/").filter(Boolean)
      const rootFolder = parts.length > 0 ? parts[0] : "Root"
      if (!groups.has(rootFolder)) groups.set(rootFolder, [])
      groups.get(rootFolder)!.push(topic)
    })

    groups.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)))
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [topics, searchQuery, typeFilter])

  const toggleGroup = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const hasActiveFilters = searchQuery !== "" || typeFilter !== "all"

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-page)", overflow: "hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width: 300, background: "var(--bg-panel)", borderRight: "1px solid var(--border-main)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", borderBottom: "1px solid var(--border-light)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            NetworkTables 4
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
            Telemetry Tree
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.4 }}>
            Project: <span style={{ color: "var(--mars-accent, var(--mars-red))", fontWeight: 600 }}>{projectName ? projectName.toUpperCase() : "NONE"}</span><br />
            Live variable inspector
          </div>
        </div>

        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>

          <div>
            <label style={labelStyle}>SEARCH TOPICS</label>
            <div style={{ position: "relative" }}>
              <i className="ti ti-search" style={{ position: "absolute", left: 10, top: 8, color: "var(--text-muted)", fontSize: 14 }} />
              <input
                type="text"
                placeholder="e.g. Pose, Speed..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>DATA TYPE</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)} style={inputStyle}>
              <option value="all">All Types ({typeCounts.all})</option>
              <option value="numeric">Numeric ({typeCounts.numeric})</option>
              <option value="boolean">Boolean ({typeCounts.boolean})</option>
              <option value="string">String ({typeCounts.string})</option>
              <option value="struct">Struct ({typeCounts.struct})</option>
              <option value="array">Array ({typeCounts.array})</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(""); setTypeFilter("all") }}
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
            <label style={{ ...labelStyle, marginBottom: 12 }}>TOPIC STATISTICS</label>
            <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 4, padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <StatRow label="Total variables" value={topics.size} />
              <StatRow label="Groups detected" value={groupedTopics.length} />
              <StatRow label="Numeric" value={typeCounts.numeric} color="var(--status-sim)" />
              <StatRow label="Boolean" value={typeCounts.boolean} color="var(--mars-red)" />
              <StatRow label="String" value={typeCounts.string} color="#e3b341" />
              <StatRow label="Struct" value={typeCounts.struct} color="#4db8d8" />
              <StatRow label="Array" value={typeCounts.array} color="#c76fd1" />
            </div>
          </div>

        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ height: 48, background: "var(--bg-menubar)", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Robot Data Hierarchy</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {topics.size > 0 ? `${topics.size} live topics · updating` : "waiting for NetworkTables data"}
          </span>
          {topics.size > 0 && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-sim)" }} />
          )}
        </div>

        <div style={{ flex: 1, padding: "24px 24px 40px", overflowY: "auto" }}>
          <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto" }}>

            {topics.size === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 40px", color: "var(--text-muted)", fontSize: 13, border: "1px dashed var(--border-main)", borderRadius: 4 }}>
                <i className="ti ti-broadcast" style={{ fontSize: 32, display: "block", marginBottom: 12, opacity: 0.5 }} />
                Waiting for NetworkTables data... <br />
                <span style={{ fontSize: 11, opacity: 0.7 }}>Connect to the robot or simulation to see variables.</span>
              </div>
            ) : groupedTopics.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 40px", color: "var(--text-muted)", fontSize: 13, border: "1px dashed var(--border-main)", borderRadius: 4 }}>
                No topics match your current filters.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {groupedTopics.map(([groupName, groupTopics]) => {
                  const isCollapsed = collapsed.has(groupName)
                  return (
                    <div key={groupName} style={{ background: "var(--bg-panel)", border: "1px solid var(--border-main)", borderRadius: 4, overflow: "hidden" }}>

                      <div
                        onClick={() => toggleGroup(groupName)}
                        style={{ background: "var(--bg-input)", padding: "10px 16px", borderBottom: isCollapsed ? "none" : "1px solid var(--border-light)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
                      >
                        <i className={`ti ${isCollapsed ? "ti-chevron-right" : "ti-chevron-down"}`} style={{ color: "var(--text-muted)", fontSize: 14 }} />
                        <i className="ti ti-folder" style={{ color: "var(--mars-accent, var(--mars-red))", fontSize: 16 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{groupName}</span>
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", background: "var(--bg-page)", padding: "2px 6px", borderRadius: 3 }}>
                          {groupTopics.length} topics
                        </span>
                      </div>

                      {!isCollapsed && (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "var(--bg-page)", borderBottom: "1px solid var(--border-main)" }}>
                              <th style={theadStyle}>NAME</th>
                              <th style={{ ...theadStyle, width: 130 }}>TYPE</th>
                              <th style={{ ...theadStyle, width: 60, textAlign: "right" }}>ID</th>
                              <th style={{ ...theadStyle, width: 220, textAlign: "right" }}>LIVE VALUE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupTopics.map((topic, i) => (
                              <tr key={topic.id} style={{ borderBottom: "1px solid var(--border-light)", background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-input)" }}>
                                <td style={{ ...tdStyle, fontFamily: "monospace", wordBreak: "break-all" }}>
                                  {topic.name.replace(`/${groupName}/`, "") || topic.name}
                                </td>
                                <td style={tdStyle}>
                                  <span style={{
                                    fontSize: 10, fontWeight: 600, color: getTypeColor(topic.topic_type),
                                    background: "var(--bg-page)", padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border-main)"
                                  }}>
                                    {topic.topic_type}
                                  </span>
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", color: "var(--text-muted)", fontSize: 10 }}>{topic.id}</td>
                                <td style={{ ...tdStyle, textAlign: "right", fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 600 }}>
                                  {formatLiveValue(liveValues[topic.name])}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

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
  width: "100%", background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "8px 12px", borderRadius: 3, fontSize: 12, outline: "none", boxSizing: "border-box"
}

const theadStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: "var(--text-muted)", textAlign: "left"
}

const tdStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 12, color: "var(--text-primary)"
}