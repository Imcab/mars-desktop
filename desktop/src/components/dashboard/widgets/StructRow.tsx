// `val` llega ya formateado por decodeStructBytes: los enteros sin decimales,
// los bool como true/false y los enums con el nombre que declara el schema.
export default function StructRow({ label, val, suffix = "" }: { label: string; val: string; suffix?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-light)", paddingBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--mars-accent)" }}>{label}</span>
      <span style={{ fontSize: 14, fontFamily: "monospace", color: "var(--text-primary)" }}>{val}{suffix}</span>
    </div>
  )
}
