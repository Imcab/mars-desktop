import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  width: number
  height: number
  onChangeWidth: (v: number) => void
  onChangeHeight: (v: number) => void
}

export default function SizeFields({ width, height, onChangeWidth, onChangeHeight }: Props) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>WIDTH (cells)</label>
        <input type="number" min={3} max={30} value={width} onChange={e => onChangeWidth(parseInt(e.target.value) || 4)} style={inputStyle} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>HEIGHT (cells)</label>
        <input type="number" min={3} max={30} value={height} onChange={e => onChangeHeight(parseInt(e.target.value) || 4)} style={inputStyle} />
      </div>
    </div>
  )
}
