import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useMarsSettings } from "../hooks/useMarsSettings"
import Panel from "../components/common/Panel"
import PropertyRow from "../components/common/PropertyRow"
import { propertyInputStyle } from "../styles/pageForm"

export default function ProjectBuilderPage() {
  const { settings, loading, error } = useMarsSettings()
  const [projectName, setProjectName] = useState("")
  const [teamNumber, setTeamNumber] = useState("")
  const [isBuilding, setIsBuilding] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [statusType, setStatusType] = useState<"idle" | "success" | "error">("idle")

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setStatusMessage("Project name is required.")
      setStatusType("error")
      return
    }

    if (!settings.workspace_path) {
      setStatusMessage("Workspace base folder is not configured in settings.")
      setStatusType("error")
      return
    }

    setIsBuilding(true)
    setStatusMessage("Cloning MARS Template and configuring workspace...")
    setStatusType("idle")

    try {
      const finalTeamNumber = teamNumber.trim() || settings.team_number

      const result = await invoke<string>("create_mars_project", {
        projectName: projectName,
        workspacePath: settings.workspace_path,
        teamNumber: finalTeamNumber
      })

      setStatusMessage(result)
      setStatusType("success")
      setProjectName("")
    } catch (err) {
      setStatusMessage(String(err))
      setStatusType("error")
    } finally {
      setIsBuilding(false)
    }
  }

  if (loading) return <PageShell><p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading environment...</p></PageShell>
  if (error) return <PageShell><p style={{ color: "var(--status-error)", fontSize: 13 }}>Error: {error}</p></PageShell>

  return (
    <PageShell>
      <div style={{ maxWidth: 640, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Workspace Setup</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>Project Builder</div>
          <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>
            Initialize a new MARS Robot environment
          </div>
        </div>

        <Panel title="System Configuration" icon="ti-settings">
          <div>
            <PropertyRow label="Project name">
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                style={propertyInputStyle}
                placeholder="e.g. Atlas_2026"
                disabled={isBuilding}
              />
            </PropertyRow>
            <PropertyRow label="Team number override">
              <input
                value={teamNumber}
                onChange={e => setTeamNumber(e.target.value)}
                style={propertyInputStyle}
                placeholder={`Default: ${settings.team_number || "None"}`}
                disabled={isBuilding}
              />
            </PropertyRow>
          </div>
        </Panel>

        <Panel title="Target Directory" icon="ti-folder">
          <div style={{ padding: 10 }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "monospace", wordBreak: "break-all" }}>
              {settings.workspace_path ? (
                `${settings.workspace_path}\\${projectName || "..."}`
              ) : (
                <span style={{ color: "var(--status-error)" }}>Warning: Workspace path is not defined in settings.</span>
              )}
            </div>
          </div>
        </Panel>

        {statusMessage && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 3,
            fontSize: 12,
            background: statusType === "error" ? "var(--status-error-bg)" : statusType === "success" ? "var(--status-success-bg)" : "var(--bg-page)",
            border: `1px solid ${statusType === "error" ? "var(--status-error)" : statusType === "success" ? "var(--status-success)" : "var(--border-main)"}`,
            color: statusType === "error" ? "var(--status-error)" : statusType === "success" ? "var(--status-success)" : "var(--text-secondary)"
          }}>
            {statusMessage}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleCreate}
            disabled={isBuilding || !settings.workspace_path}
            style={{
              padding: "8px 28px", fontSize: 12, fontWeight: 500,
              background: isBuilding || !settings.workspace_path ? "var(--mars-grey)" : "var(--mars-red)",
              color: "#fff", border: "none", borderRadius: 3,
              cursor: isBuilding || !settings.workspace_path ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {isBuilding ? "INITIALIZING..." : "Create Project"}
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
