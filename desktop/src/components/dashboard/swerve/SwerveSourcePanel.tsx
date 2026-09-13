import React from "react"
import { SwerveSourceConfig, SwerveSourceType, SwerveModuleRole, SWERVE_ARRANGEMENTS } from "../../../store/appStore"
import { classifyTopic } from "../../../utils/dashboard/topicClassification"

interface Props {
  sources: SwerveSourceConfig[]
  onUpdate: (id: string, updates: Partial<SwerveSourceConfig>) => void
  onRemove: (id: string) => void
}

const TYPE_LABELS: Record<SwerveSourceType, string> = {
  modules: "Module States",
  positions: "Module Positions",
  chassis: "Chassis Speeds",
  rotation: "Rotation",
}

const TYPE_OPTIONS: SwerveSourceType[] = ["modules", "positions", "chassis", "rotation"]

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-main)",
  padding: "3px 6px",
  borderRadius: 2,
  fontSize: 10.5,
  outline: "none",
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 9.5,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 2,
}

export default function SwerveSourcePanel({ sources, onUpdate, onRemove }: Props) {
  if (sources.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        No sources yet. Drag a <i>SwerveModuleState[]</i>, a <i>ChassisSpeeds</i> or a{" "}
        <i>Rotation2d</i> from the Data Directory onto the diagram.
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {sources.map(source => {
        const isRawNumber = classifyTopic(source.topicType).isNumber

        return (
          <div key={source.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--border-light)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                value={source.color}
                onChange={e => onUpdate(source.id, { color: e.target.value })}
                title="Source color"
                style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border-main)", background: "var(--bg-input)", borderRadius: 2, cursor: "pointer" }}
              />
              <span
                style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={source.topicName}
              >
                {source.label}
              </span>
              <button
                onClick={() => onRemove(source.id)}
                title="Remove source"
                style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
              >
                <i className="ti ti-x" aria-hidden />
              </button>
            </div>

            <div style={{ fontSize: 9.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {source.topicType}
            </div>

            <div>
              <div style={fieldLabelStyle}>Type</div>
              <select
                value={source.type}
                onChange={e => onUpdate(source.id, { type: e.target.value as SwerveSourceType })}
                style={selectStyle}
              >
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>

            {source.type === "modules" && (
              <div>
                <div style={fieldLabelStyle}>Role</div>
                <select
                  value={source.role}
                  onChange={e => onUpdate(source.id, { role: e.target.value as SwerveModuleRole })}
                  style={selectStyle}
                >
                  <option value="measured">Measured</option>
                  <option value="setpoint">Setpoint</option>
                </select>
              </div>
            )}

            {(source.type === "modules" || source.type === "positions") && (
              <div>
                <div style={fieldLabelStyle}>Arrangement</div>
                <select
                  value={source.arrangement}
                  onChange={e => onUpdate(source.id, { arrangement: e.target.value })}
                  style={selectStyle}
                >
                  {SWERVE_ARRANGEMENTS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
            )}

            {source.type === "rotation" && isRawNumber && (
              <div>
                <div style={fieldLabelStyle}>Angle units</div>
                <select
                  value={source.angleUnits}
                  onChange={e => onUpdate(source.id, { angleUnits: e.target.value as "degrees" | "radians" })}
                  style={selectStyle}
                >
                  <option value="degrees">Degrees</option>
                  <option value="radians">Radians</option>
                </select>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
