interface Props {
  value: boolean
  style: string
  customTrue?: string
  customFalse?: string
}

export default function BooleanWidget({ value, style, customTrue = "True", customFalse = "False" }: Props) {
  const stateColor = value ? "var(--status-sim)" : "var(--mars-red)"
  switch (style) {
    case "Box":
      return <div style={{ width: "100%", height: "100%", margin: 4, background: stateColor, borderRadius: 4 }} />
    case "Custom":
      return <span style={{ color: stateColor, fontWeight: "bold", fontSize: 20, fontFamily: "monospace", textAlign: "center" }}>{value ? customTrue : customFalse}</span>
    case "Simple":
    default:
      return <span style={{ color: stateColor, fontWeight: "bold", fontSize: 24, fontFamily: "monospace" }}>{value ? "TRUE" : "FALSE"}</span>
  }
}
