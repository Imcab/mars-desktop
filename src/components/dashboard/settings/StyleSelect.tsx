import { labelStyle, inputStyle } from "../DashboardCard.styles"

interface Props {
  isBoolean: boolean
  isRotationSingle: boolean
  value: string
  onChange: (v: string) => void
}

// Agregar un nuevo "style" para numeros = agregar la <option> aquí y su
// case correspondiente en widgets/NumberWidget.tsx + settings/ si necesita campos.
export default function StyleSelect({ isBoolean, isRotationSingle, value, onChange }: Props) {
  return (
    <div>
      <label style={labelStyle}>STYLE</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle}>
        {isBoolean ? (
          <>
            <option value="Simple">Simple Text</option>
            <option value="Box">Color Box</option>
            <option value="Custom">Custom Text</option>
          </>
        ) : isRotationSingle ? (
          <>
            <option value="List">List</option>
            <option value="Compass">Compass</option>
          </>
        ) : (
          <>
            <option value="Text">Standard Text</option>
            <option value="Bar">Velocity / Bar</option>
            <option value="Deviation">Deviation</option>
            <option value="Compass">Compass / Angle</option>
            <option value="MatchTime">Match Time</option>
            <option value="Graph">Graph</option>
            <option value="Gauge">Radial Gauge</option>
            <option value="Voltage">Voltage View</option>
          </>
        )}
      </select>
    </div>
  )
}
