import React from "react"

interface Props {
  value: number
  mode: "mmss" | "seconds"
  yellowAt: number
  redAt: number
}

export default function MatchTimeWidget({ value, mode, yellowAt, redAt }: Props) {
  const seconds = Math.max(0, Math.round(value))
  const color =
    seconds <= redAt ? "var(--status-error)" :
    seconds <= yellowAt ? "var(--status-warning)" :
    seconds <= 60 ? "var(--status-sim)" :
    "var(--mars-accent)"

  const display = mode === "seconds"
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <span style={{ fontSize: 40, fontWeight: 800, fontFamily: "monospace", color, letterSpacing: 1 }}>
      {display}
    </span>
  )
}
