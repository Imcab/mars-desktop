import { labelStyle, inputStyle, ROTATION_UNIT_OPTIONS } from "../DashboardCard.styles"

export default function RotationUnitField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={labelStyle}>ANGLE UNIT</label>
      <select value={value || "deg"} onChange={e => onChange(e.target.value)} style={inputStyle}>
        {ROTATION_UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </div>
  )
}
