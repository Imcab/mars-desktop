import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  trueLabel: string
  falseLabel: string
  onChangeTrue: (v: string) => void
  onChangeFalse: (v: string) => void
}

export default function BooleanCustomLabelsFields({ trueLabel, falseLabel, onChangeTrue, onChangeFalse }: Props) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>TRUE</label>
        <input value={trueLabel} onChange={e => onChangeTrue(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>FALSE</label>
        <input value={falseLabel} onChange={e => onChangeFalse(e.target.value)} style={inputStyle} />
      </div>
    </div>
  )
}
