import React from "react"
import { STRUCT_DEFS, decodeStructBytes } from "../../../utils/dashboard/valueDecoding"
import StructRow from "./StructRow"

export default function StructWidget({ rawVal, structName }: { rawVal: any; structName: string }) {
  const def = STRUCT_DEFS[structName]
  if (!def || !Array.isArray(rawVal)) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>Unsupported struct: {structName}</span>
  }
  const fields = decodeStructBytes(rawVal, def)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "0 12px" }}>
      {fields.map(f => <StructRow key={f.label} label={f.label} val={f.value} suffix={f.suffix} />)}
    </div>
  )
}
