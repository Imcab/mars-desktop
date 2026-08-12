import React, { useState } from "react"
import { DashboardWidget } from "../../store/appStore"
import { unpackLiveValue } from "../../utils/dashboard/valueDecoding"
import { classifyTopic } from "../../utils/dashboard/topicClassification"
import CardSettingsPanel from "./settings/CardSettingsPanel"
import WidgetRenderer from "./widgets/WidgetRenderer"

interface Props {
  widget: DashboardWidget
  liveValue?: any
  onRemove: () => void
  onUpdate: (updates: Partial<DashboardWidget>) => void
}

// Este archivo es SOLO el orquestador de la tarjeta: cabecera (label editable,
// botones), el toggle entre "ver valor" y "settings", y pasar la
// clasificación del topic hacia abajo. Toda la lógica de cada widget vive en
// ./widgets/*, y toda la lógica de cada formulario de settings vive en
// ./settings/*. Para agregar un widget nuevo no hace falta tocar este archivo
// salvo, quizás, WidgetRenderer.tsx.
export default function DashboardCard({ widget, liveValue, onRemove, onUpdate }: Props) {
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [editLabel, setEditLabel] = useState(widget.label)

  const handleSaveLabel = () => {
    onUpdate({ label: editLabel })
    setIsEditingLabel(false)
  }

  const handleSaveSettings = (updates: Partial<DashboardWidget>) => {
    onUpdate(updates)
    setIsSettingsOpen(false)
  }

  const rawVal = unpackLiveValue(liveValue)
  const classification = classifyTopic(widget.topicType)

  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border-main)", borderRadius: 4, display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", position: "relative" }}>

      {/* CABECERA (Funciona como manija para mover) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderBottom: "1px solid var(--border-main)", background: "var(--bg-dark)", cursor: "grab" }}>
        {isEditingLabel ? (
          <input
            autoFocus value={editLabel} onChange={e => setEditLabel(e.target.value)}
            onBlur={handleSaveLabel} onKeyDown={e => e.key === "Enter" && handleSaveLabel()}
            onMouseDown={e => e.stopPropagation()}
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-light)", outline: "none", fontSize: 11, padding: "2px 4px", width: "100%", borderRadius: 2 }}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setIsEditingLabel(true) }}
            onMouseDown={e => e.stopPropagation()}
            style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text", flex: 1, letterSpacing: 0.3 }}
          >
            {widget.label}
          </span>
        )}

        <div style={{ display: "flex", gap: 4, marginLeft: 8 }} onMouseDown={e => e.stopPropagation()}>
          <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} style={{ background: isSettingsOpen ? "var(--bg-input)" : "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", borderRadius: 3, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-settings" style={{ fontSize: 12 }} />
          </button>
          <button onClick={onRemove} style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", borderRadius: 3, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-x" style={{ fontSize: 12 }} />
          </button>
        </div>
      </div>

      {isSettingsOpen ? (
        <CardSettingsPanel widget={widget} classification={classification} onSave={handleSaveSettings} />
      ) : (
        <div style={{ flex: 1, padding: (classification.isNumericArray || classification.isStructArray) ? 0 : 12, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
          <WidgetRenderer widget={widget} rawVal={rawVal} classification={classification} />
        </div>
      )}
    </div>
  )
}
