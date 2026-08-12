import React from "react"
import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  mode: "mmss" | "seconds"
  yellowAt: number
  redAt: number
  onChangeMode: (v: "mmss" | "seconds") => void
  onChangeYellow: (v: number) => void
  onChangeRed: (v: number) => void
}

export default function MatchTimeFields({ mode, yellowAt, redAt, onChangeMode, onChangeYellow, onChangeRed }: Props) {
  return (
    <>
      <div>
        <label style={labelStyle}>DISPLAY FORMAT</label>
        <select value={mode} onChange={e => onChangeMode(e.target.value as "mmss" | "seconds")} style={inputStyle}>
          <option value="mmss">Minutes and Seconds (M:SS)</option>
          <option value="seconds">Seconds Only</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>YELLOW AT (s)</label>
          <input type="number" min={0} value={yellowAt} onChange={e => onChangeYellow(parseInt(e.target.value) || 0)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>RED AT (s)</label>
          <input type="number" min={0} value={redAt} onChange={e => onChangeRed(parseInt(e.target.value) || 0)} style={inputStyle} />
        </div>
      </div>
    </>
  )
}
