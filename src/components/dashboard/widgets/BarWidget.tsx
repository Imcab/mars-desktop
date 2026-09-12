interface Props { value: number; min: number; max: number; suffix: string }

export default function BarWidget({ value, min, max, suffix }: Props) {
  const percentage = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ textAlign: "center", fontWeight: "bold", fontFamily: "monospace", color: "var(--text-primary)", fontSize: 14 }}>{value.toFixed(2)}{suffix}</div>
      <div style={{ width: "100%", height: 12, background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${percentage * 100}%`, height: "100%", background: "var(--status-sim)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}><span>{min}</span><span>{max}</span></div>
    </div>
  )
}
