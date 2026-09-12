interface Props { value: number; max: number; suffix: string }

export default function DeviationWidget({ value, max, suffix }: Props) {
  const safeRange = max === 0 ? 1 : max
  const normalized = Math.max(-1, Math.min(1, value / safeRange))
  const barLen = Math.abs(normalized) * 50
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ textAlign: "center", fontWeight: "bold", fontFamily: "monospace", color: "var(--status-sim)", fontSize: 14 }}>{value.toFixed(1)}{suffix}</div>
      <div style={{ position: "relative", height: 16, width: "100%", display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", width: "100%", height: 2, background: "var(--border-main)" }} />
        <div style={{ position: "absolute", left: "50%", width: 2, height: 12, background: "var(--text-muted)", transform: "translateX(-50%)" }} />
        <div style={{ position: "absolute", left: normalized < 0 ? `${50 - barLen}%` : "50%", width: `${barLen}%`, height: 10, background: "var(--status-sim)", borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}><span>-{Math.round(safeRange)}</span><span>+{Math.round(safeRange)}</span></div>
    </div>
  )
}
