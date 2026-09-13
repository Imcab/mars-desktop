// Detección automática de unidad a partir del nombre de un topic, inspirada
// en el mismo espíritu que Units.getUnitForField de AdvantageScope: mira el
// sufijo del último segmento del path (ej. "Elevator/HeightMeters" -> "m")
// y solo lo acepta si el sufijo empieza en un límite de palabra "de verdad"
// (una mayúscula en camelCase, o un guion bajo) para no confundir
// "Timestamp" con "amp" o similares falsos positivos.
//
// No pretende ser exhaustivo como la tabla completa de AdvantageScope, cubre
// las unidades más comunes en telemetría de FRC.

const UNIT_SUFFIXES: Record<string, string> = {
  meters: "m",
  meter: "m",
  centimeters: "cm",
  centimeter: "cm",
  millimeters: "mm",
  millimeter: "mm",
  inches: "in",
  inch: "in",
  feet: "ft",
  foot: "ft",
  degrees: "°",
  degree: "°",
  deg: "°",
  radians: "rad",
  radian: "rad",
  rad: "rad",
  rotations: "rot",
  rotation: "rot",
  rot: "rot",
  volts: "V",
  volt: "V",
  voltage: "V",
  amps: "A",
  amp: "A",
  amperage: "A",
  current: "A",
  watts: "W",
  watt: "W",
  celsius: "°C",
  fahrenheit: "°F",
  percent: "%",
  percentage: "%",
  hertz: "Hz",
  hz: "Hz",
  rpm: "rpm",
  seconds: "s",
  second: "s",
  sec: "s",
  milliseconds: "ms",
  ms: "ms",
}

// Ordenados de más largo a más corto para que "milliseconds" gane sobre "seconds"
// al buscar la coincidencia más específica.
const SORTED_SUFFIXES = Object.keys(UNIT_SUFFIXES).sort((a, b) => b.length - a.length)

function isUpperCaseChar(c: string | undefined): boolean {
  return !!c && c === c.toUpperCase() && c !== c.toLowerCase()
}

export function detectUnitSuffix(topicName: string): string | null {
  const lastSegment = topicName.split("/").filter(Boolean).pop() ?? topicName
  const lower = lastSegment.toLowerCase()

  for (const suffix of SORTED_SUFFIXES) {
    if (lower.length <= suffix.length) continue
    if (!lower.endsWith(suffix)) continue

    const boundaryChar = lastSegment[lastSegment.length - suffix.length - 1]
    const suffixStartChar = lastSegment[lastSegment.length - suffix.length]
    const isWordBoundary = isUpperCaseChar(suffixStartChar) || boundaryChar === "_" || boundaryChar === " "
    if (!isWordBoundary) continue

    return UNIT_SUFFIXES[suffix]
  }
  return null
}