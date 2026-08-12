import React from "react"
import { STRUCT_DEFS, decodeStructBytes } from "../../../utils/dashboard/valueDecoding"
import StructRow from "./StructRow"

interface Props {
  rawVal: any
  structName: string
  index: number
}

// Igual que StructWidget pero recorta un único elemento de un struct:X[]
// (se usa cuando el widget se creó arrastrando un índice puntual del array
// desde el Data Directory, en vez del array completo).
export default function StructArraySingleWidget({ rawVal, structName, index }: Props) {
  const def = STRUCT_DEFS[structName]
  if (!def || !Array.isArray(rawVal)) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>Unsupported struct: {structName}</span>
  }

  const start = index * def.length
  const slice = rawVal.slice(start, start + def.length)
  if (slice.length < def.length) {
    return <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>Index {index} out of range</span>
  }

  const fields = decodeStructBytes(slice, def)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "0 12px" }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: 1 }}>[{index}] · {structName}</div>
      {fields.map(f => <StructRow key={f.label} label={f.label} val={f.value} suffix={f.suffix} />)}
    </div>
  )
}