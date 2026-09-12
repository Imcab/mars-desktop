interface Props {
  message: string
}

// Placeholder idéntico repetido en StructWidget, StructArrayWidget,
// StructArraySingleWidget y RotationWidget para structs sin decoder.
export default function UnsupportedValue({ message }: Props) {
  return (
    <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
      {message}
    </span>
  )
}
