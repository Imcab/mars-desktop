import React from "react"
import { FunctionSeriesConfig, FunctionTransform, FunctionAxis } from "../../../store/appStore"
import { SeriesOperator, OPERATOR_LABELS } from "../../../utils/functions/seriesAlgebra"

interface Props {
  series: FunctionSeriesConfig[]
  onUpdate: (id: string, updates: Partial<FunctionSeriesConfig>) => void
  onRemove: (id: string) => void
}

const TRANSFORM_LABELS: Record<FunctionTransform, string> = {
  raw: "Raw",
  integral: "∫ Integral (trapezoidal)",
  derivative: "d/dt Derivative (finite diff.)",
}

const AXIS_OPTIONS: FunctionAxis[] = ["left", "right"]
const OPERATOR_OPTIONS: SeriesOperator[] = ["add", "subtract", "multiply", "divide"]

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

export default function SeriesPanel({ series, onUpdate, onRemove }: Props) {
  if (series.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
        No hay series todavía. Arrastra un valor <i>double</i> desde el Data Directory hacia la gráfica.
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {series.map(s => {
        // Candidatos para combinar: cualquier otra serie que a su vez NO
        // tenga ya su propio combine (evita tener que resolver cadenas A→B→C).
        const combineCandidates = series.filter(other => other.id !== s.id && !other.combine)
        // Candidatos para "target": cualquier otra serie (sin esta restricción,
        // porque acá solo se usa para sombrear, no para recalcular valores).
        const errorCandidates = series.filter(other => other.id !== s.id)

        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderBottom: "1px solid var(--border-light)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="color"
                value={s.color}
                onChange={e => onUpdate(s.id, { color: e.target.value })}
                title="Line color"
                style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--border-main)", background: "var(--bg-input)", borderRadius: 2, cursor: "pointer" }}
              />
              <span
                style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={s.topicName}
              >
                {s.label}
              </span>
              <button
                onClick={() => onRemove(s.id)}
                title="Remove series"
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <i className="ti ti-x" style={{ fontSize: 11 }} />
              </button>
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={s.transform}
                onChange={e => onUpdate(s.id, { transform: e.target.value as FunctionTransform })}
                style={{ ...selectStyle, flex: 1 }}
              >
                {(Object.keys(TRANSFORM_LABELS) as FunctionTransform[]).map(t => (
                  <option key={t} value={t}>{TRANSFORM_LABELS[t]}</option>
                ))}
              </select>

              <div style={{ display: "flex", border: "1px solid var(--border-main)", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
                {AXIS_OPTIONS.map(axis => (
                  <button
                    key={axis}
                    onClick={() => onUpdate(s.id, { axis })}
                    title={axis === "left" ? "Plot on left axis" : "Plot on right axis"}
                    style={{
                      width: 26,
                      fontSize: 10,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      background: s.axis === axis ? "var(--mars-accent)" : "var(--bg-input)",
                      color: s.axis === axis ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {axis === "left" ? "L" : "R"}
                  </button>
                ))}
              </div>
            </div>

            {/* Álgebra entre series: A op B. Solo se puede combinar con
                series "simples" (sin su propio combine) para no resolver
                dependencias en cadena. */}
            <div>
              <div style={fieldLabelStyle}>Combine with</div>
              <div style={{ display: "flex", gap: 6 }}>
                <select
                  value={s.combine?.withSeriesId ?? ""}
                  onChange={e => {
                    const withSeriesId = e.target.value
                    if (!withSeriesId) {
                      onUpdate(s.id, { combine: null })
                    } else {
                      onUpdate(s.id, { combine: { withSeriesId, operator: s.combine?.operator ?? "subtract" } })
                    }
                  }}
                  style={{ ...selectStyle, flex: 1 }}
                >
                  <option value="">None</option>
                  {combineCandidates.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                {s.combine && (
                  <select
                    value={s.combine.operator}
                    onChange={e => onUpdate(s.id, { combine: { withSeriesId: s.combine!.withSeriesId, operator: e.target.value as SeriesOperator } })}
                    style={{ ...selectStyle, width: 44, flexShrink: 0, textAlign: "center" }}
                  >
                    {OPERATOR_OPTIONS.map(op => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Target vs Actual: esta serie se trata como "actual" y se
                sombrea el área contra la serie elegida como "target". La
                serie target sigue dibujándose normalmente por su cuenta. */}
            <div>
              <div style={fieldLabelStyle}>Show error vs (target)</div>
              <select
                value={s.errorTargetId ?? ""}
                onChange={e => onUpdate(s.id, { errorTargetId: e.target.value || null })}
                style={selectStyle}
              >
                <option value="">None</option>
                {errorCandidates.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </div>
  )
}