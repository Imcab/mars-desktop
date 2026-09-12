export default function TextValueWidget({ value, suffix }: { value: number; suffix: string }) {
  return (
    <span style={{ fontSize: 32, fontWeight: "bold", color: "var(--text-primary)", fontFamily: "monospace" }}>
      {value.toFixed(2)}{suffix}
    </span>
  )
}
