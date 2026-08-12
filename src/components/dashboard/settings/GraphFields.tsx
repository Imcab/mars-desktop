import React from "react"
import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  timeDisplayed: number
  color: string
  lineWidth: number
  autoRange: boolean
  yMin: number
  yMax: number
  onChangeTimeDisplayed: (v: number) => void
  onChangeColor: (v: string) => void
  onChangeLineWidth: (v: number) => void
  onChangeAutoRange: (v: boolean) => void
  onChangeYMin: (v: number) => void
  onChangeYMax: (v: number) => void
}

export default function GraphFields({
  timeDisplayed, color, lineWidth, autoRange, yMin, yMax,
  onChangeTimeDisplayed, onChangeColor, onChangeLineWidth, onChangeAutoRange, onChangeYMin, onChangeYMax,
}: Props) {
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>TIME DISPLAYED (s)</label>
          <input type="number" min={1} value={timeDisplayed} onChange={e => onChangeTimeDisplayed(parseFloat(e.target.value) || 5)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>LINE WIDTH</label>
          <input type="number" min={0.5} step={0.5} value={lineWidth} onChange={e => onChangeLineWidth(parseFloat(e.target.value) || 2)} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>LINE COLOR</label>
        <input type="color" value={color} onChange={e => onChangeColor(e.target.value)} style={{ ...inputStyle, padding: 2, height: 28, cursor: "pointer" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" id="graphAutoRange" checked={autoRange} onChange={e => onChangeAutoRange(e.target.checked)} />
        <label htmlFor="graphAutoRange" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>AUTO Y-RANGE</label>
      </div>
      {!autoRange && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Y MIN</label>
            <input type="number" value={yMin} onChange={e => onChangeYMin(parseFloat(e.target.value) || 0)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Y MAX</label>
            <input type="number" value={yMax} onChange={e => onChangeYMax(parseFloat(e.target.value) || 100)} style={inputStyle} />
          </div>
        </div>
      )}
    </>
  )
}
