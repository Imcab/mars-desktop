import { decodeStructBytes } from "../../../utils/dashboard/valueDecoding"
import { useStructDef } from "../../../store/structSchemaStore"
import StructRow from "./StructRow"
import UnsupportedValue from "../../common/UnsupportedValue"

interface Props {
  rawVal: any
  structName: string
  index: number
}

// Igual que StructWidget pero recorta un único elemento de un struct:X[]
// (se usa cuando el widget se creó arrastrando un índice puntual del array
// desde el Data Directory, en vez del array completo).
export default function StructArraySingleWidget({ rawVal, structName, index }: Props) {
  const def = useStructDef(structName)
  if (!def || !Array.isArray(rawVal)) {
    return <UnsupportedValue message={`Unsupported struct: ${structName}`} />
  }

  const start = index * def.length
  const slice = rawVal.slice(start, start + def.length)
  if (slice.length < def.length) {
    return <UnsupportedValue message={`Index ${index} out of range`} />
  }

  const fields = decodeStructBytes(slice, def)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "0 12px" }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: 1 }}>[{index}] · {structName}</div>
      {fields.map(f => <StructRow key={f.label} label={f.label} val={f.text} suffix={f.suffix} />)}
    </div>
  )
}