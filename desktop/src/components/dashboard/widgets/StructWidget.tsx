import { decodeStructBytes } from "../../../utils/dashboard/valueDecoding"
import { useStructDef } from "../../../store/structSchemaStore"
import StructRow from "./StructRow"
import UnsupportedValue from "../../common/UnsupportedValue"

export default function StructWidget({ rawVal, structName }: { rawVal: any; structName: string }) {
  const def = useStructDef(structName)
  if (!def || !Array.isArray(rawVal)) {
    return <UnsupportedValue message={`Unsupported struct: ${structName}`} />
  }
  const fields = decodeStructBytes(rawVal, def)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", padding: "0 12px" }}>
      {fields.map(f => <StructRow key={f.label} label={f.label} val={f.text} suffix={f.suffix} />)}
    </div>
  )
}
