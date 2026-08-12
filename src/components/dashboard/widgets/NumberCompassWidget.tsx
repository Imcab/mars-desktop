import React from "react"
import CompassDial from "./CompassDial"

export default function NumberCompassWidget({ value }: { value: number }) {
  return <CompassDial angleDeg={value} needleColor="var(--mars-red)" valueLabel={`${value.toFixed(1)}°`} />
}
