import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  startAngle: number
  endAngle: number
  min: number
  max: number
  numberOfLabels: number
  wrapValue: boolean
  showPointer: boolean
  showTicks: boolean
  onChangeStartAngle: (v: number) => void
  onChangeEndAngle: (v: number) => void
  onChangeMin: (v: number) => void
  onChangeMax: (v: number) => void
  onChangeNumberOfLabels: (v: number) => void
  onChangeWrapValue: (v: boolean) => void
  onChangeShowPointer: (v: boolean) => void
  onChangeShowTicks: (v: boolean) => void
}

export default function GaugeFields({
  startAngle, endAngle, min, max, numberOfLabels, wrapValue, showPointer, showTicks,
  onChangeStartAngle, onChangeEndAngle, onChangeMin, onChangeMax, onChangeNumberOfLabels,
  onChangeWrapValue, onChangeShowPointer, onChangeShowTicks,
}: Props) {
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>START ANGLE (CW+)</label>
          <input type="number" value={startAngle} onChange={e => onChangeStartAngle(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>END ANGLE (CW+)</label>
          <input type="number" value={endAngle} onChange={e => onChangeEndAngle(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>MIN VALUE</label>
          <input type="number" value={min} onChange={e => onChangeMin(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>MAX VALUE</label>
          <input type="number" value={max} onChange={e => onChangeMax(parseFloat(e.target.value) || 0)} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>NUMBER OF LABELS</label>
        <input type="number" min={2} value={numberOfLabels} onChange={e => onChangeNumberOfLabels(parseInt(e.target.value) || 2)} style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" id="gaugeWrap" checked={wrapValue} onChange={e => onChangeWrapValue(e.target.checked)} />
          <label htmlFor="gaugeWrap" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>WRAP VALUE</label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" id="gaugePointer" checked={showPointer} onChange={e => onChangeShowPointer(e.target.checked)} />
          <label htmlFor="gaugePointer" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>SHOW POINTER</label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" id="gaugeTicks" checked={showTicks} onChange={e => onChangeShowTicks(e.target.checked)} />
          <label htmlFor="gaugeTicks" style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>SHOW TICKS</label>
        </div>
      </div>
    </>
  )
}
