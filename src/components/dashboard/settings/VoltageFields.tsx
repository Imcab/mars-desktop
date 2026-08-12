import React from "react"
import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  orientation: "horizontal" | "vertical"
  min: number
  max: number
  divisions: number
  inverted: boolean
  onChangeOrientation: (v: "horizontal" | "vertical") => void
  onChangeMin: (v: number) => void
  onChangeMax: (v: number) => void
  onChangeDivisions: (v: number) => void
  onChangeInverted: (v: boolean) => void
}

export default function VoltageFields({
  orientation, min, max, divisions, inverted,
  onChangeOrientation, onChangeMin, onChangeMax, onChangeDivisions, onChangeInverted,
}: Props) {
  return (
    <>
      <div>
        <label style={labelStyle}>ORIENTATION</label>
        <select value={orientation} onChange={e => onChangeOrientation(e.target.value as "horizontal" | "vertical")} style={inputStyle}>
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>MIN (V)</label>
          <input type="number" value={min} onChange={e => onChangeMin(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>MAX (V)</label>
          <input type="number" value={max} onChange={e => onChangeMax(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>DIVISIONS</label>
          <input type="number" min={2} value={divisions} onChange={e => onChangeDivisions(parseInt(e.target.value) || 2)} style={inputStyle} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 28 }}>
          <input type="checkbox" id="voltageInverted" checked={inverted} onChange={e => onChangeInverted(e.target.checked)} />
          <label htmlFor="voltageInverted" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>INVERTED</label>
        </div>
      </div>
    </>
  )
}
