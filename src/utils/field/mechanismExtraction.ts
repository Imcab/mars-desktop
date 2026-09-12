// Reconstrucción de un Mechanism2d de WPILib a partir de los topics sueltos
// que publica en NetworkTables.
//
// Un Mechanism2d NO es un topic: es una TABLA con esta forma
//
//   /Mech/.type                      string   = "Mechanism2d"
//   /Mech/dims                       double[] [ancho, alto] en unidades del dibujo
//   /Mech/backgroundColor            string   "#RRGGBB"
//   /Mech/<root>/x                   double   origen del root
//   /Mech/<root>/y                   double
//   /Mech/<root>/<lig>/.type         string   = "line"
//   /Mech/<root>/<lig>/angle         double   GRADOS, RELATIVOS al ligamento padre
//   /Mech/<root>/<lig>/length        double
//   /Mech/<root>/<lig>/color         string
//   /Mech/<root>/<lig>/weight        double   grosor en px
//   /Mech/<root>/<lig>/<lig2>/...             ligamentos anidados
//
// Cada ligamento arranca donde termina su padre y suma su ángulo al de él.
// Aplanar esa cadena a segmentos absolutos es todo el trabajo de este archivo:
// el canvas solo recibe líneas ya resueltas.

import { TopicAnnounce } from "../../store/appStore"
import { unpackLiveValue } from "../dashboard/valueDecoding"

const DEG_TO_RAD = Math.PI / 180

// Claves que WPILib publica como hojas de datos y que por lo tanto NUNCA son
// un root ni un ligamento.
const RESERVED_KEYS = new Set([".type", "dims", "backgroundColor", "x", "y", "angle", "length", "color", "weight"])

export type MechanismPoint = [number, number]

export interface MechanismLine {
  start: MechanismPoint
  end: MechanismPoint
  color: string
  weight: number
  /** Ruta del topic del ligamento, para poder identificarlo en la lectura numérica. */
  path: string
  /** Ángulo absoluto del segmento, en radianes. */
  angle: number
  length: number
}

export interface MechanismState {
  backgroundColor: string
  dimensions: MechanismPoint
  lines: MechanismLine[]
  /** Cantidad de roots encontrados (un Mechanism2d puede tener varios). */
  rootCount: number
}

// --- Descubrimiento de tablas Mechanism2d -----------------------------------

// No se puede preguntar por el valor de "<prefix>/.type" con solo los
// announces, así que la tabla se reconoce por su forma: dims + backgroundColor
// son obligatorios en todo Mechanism2d y no aparecen juntos en ninguna otra
// estructura de WPILib.
export function isMechanismTable(topics: Map<string, TopicAnnounce>, prefix: string): boolean {
  const dims = topics.get(prefix + "/dims")
  const background = topics.get(prefix + "/backgroundColor")
  if (!dims || !background) return false
  return dims.topic_type.endsWith("[]") && background.topic_type.includes("string")
}

// Todas las rutas de tabla que son un Mechanism2d, ordenadas alfabéticamente.
export function findMechanismTables(topics: Map<string, TopicAnnounce>): string[] {
  const prefixes = new Set<string>()
  topics.forEach(topic => {
    const parts = topic.name.split("/").filter(Boolean)
    // Solo interesa el padre directo de "dims"/"backgroundColor"; recorrer
    // todos los prefijos posibles multiplicaría el trabajo sin encontrar más.
    if (parts.length < 2) return
    const prefix = "/" + parts.slice(0, parts.length - 1).join("/")
    if (isMechanismTable(topics, prefix)) prefixes.add(prefix)
  })
  return Array.from(prefixes).sort()
}

// Los topics que hay que pedirle al backend para poder dibujar esta tabla.
export function mechanismTopicNames(topics: Map<string, TopicAnnounce>, prefix: string): string[] {
  const names: string[] = []
  topics.forEach(topic => {
    if (topic.name === prefix || topic.name.startsWith(prefix + "/")) names.push(topic.name)
  })
  return names
}

// --- Árbol de claves --------------------------------------------------------

interface KeyNode {
  path: string
  children: Map<string, KeyNode>
}

function buildKeyTree(topicNames: string[], prefix: string): KeyNode {
  const root: KeyNode = { path: prefix, children: new Map() }

  for (const name of topicNames) {
    if (!name.startsWith(prefix + "/")) continue
    const parts = name.slice(prefix.length + 1).split("/").filter(Boolean)
    let node = root
    parts.forEach((part, index) => {
      if (!node.children.has(part)) {
        node.children.set(part, {
          path: prefix + "/" + parts.slice(0, index + 1).join("/"),
          children: new Map(),
        })
      }
      node = node.children.get(part)!
    })
  }

  return root
}

// Un root o un ligamento SIEMPRE es una subtabla (tiene hijos: x/y, o
// angle/length/color/weight). Las hojas de datos no tienen hijos, así que
// esta sola condición separa la estructura de los valores.
function subTables(node: KeyNode): KeyNode[] {
  const out: KeyNode[] = []
  node.children.forEach((child, key) => {
    if (child.children.size > 0 && !RESERVED_KEYS.has(key)) out.push(child)
  })
  return out
}

// --- Lectura de valores -----------------------------------------------------

function readNumber(values: Record<string, any>, key: string, fallback: number): number {
  const value = unpackLiveValue(values[key])
  return typeof value === "number" && isFinite(value) ? value : fallback
}

function readString(values: Record<string, any>, key: string, fallback: string): string {
  const value = unpackLiveValue(values[key])
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function readNumberArray(values: Record<string, any>, key: string): number[] | null {
  const value = unpackLiveValue(values[key])
  return Array.isArray(value) ? value : null
}

// --- Construcción del estado ------------------------------------------------

export function buildMechanismState(
  values: Record<string, any>,
  topicNames: string[],
  prefix: string,
): MechanismState | null {
  const dims = readNumberArray(values, prefix + "/dims")
  // Sin dims no hay sistema de coordenadas: el dibujo no se puede escalar, así
  // que se prefiere no mostrar nada antes que inventar un tamaño.
  if (!dims || dims.length < 2 || dims[0] <= 0 || dims[1] <= 0) return null

  const state: MechanismState = {
    backgroundColor: readString(values, prefix + "/backgroundColor", "#000020"),
    dimensions: [dims[0], dims[1]],
    lines: [],
    rootCount: 0,
  }

  const tree = buildKeyTree(topicNames, prefix)

  const addLigament = (node: KeyNode, start: MechanismPoint, parentAngle: number) => {
    const angle = parentAngle + readNumber(values, node.path + "/angle", 0) * DEG_TO_RAD
    const length = readNumber(values, node.path + "/length", 0)
    const end: MechanismPoint = [
      start[0] + length * Math.cos(angle),
      start[1] + length * Math.sin(angle),
    ]

    state.lines.push({
      start,
      end,
      color: readString(values, node.path + "/color", "#ffffff"),
      weight: readNumber(values, node.path + "/weight", 1),
      path: node.path,
      angle,
      length,
    })

    subTables(node).forEach(child => addLigament(child, end, angle))
  }

  subTables(tree).forEach(rootNode => {
    state.rootCount++
    const origin: MechanismPoint = [
      readNumber(values, rootNode.path + "/x", 0),
      readNumber(values, rootNode.path + "/y", 0),
    ]
    subTables(rootNode).forEach(child => addLigament(child, origin, 0))
  })

  return state
}

// Varias tablas en un mismo lienzo: el área dibujable es la que cabe a todas,
// y el fondo lo pone la primera (las de abajo quedan superpuestas encima).
export function mergeMechanismStates(states: MechanismState[]): MechanismState | null {
  if (states.length === 0) return null
  return {
    backgroundColor: states[0].backgroundColor,
    dimensions: [
      Math.max(...states.map(s => s.dimensions[0])),
      Math.max(...states.map(s => s.dimensions[1])),
    ],
    lines: states.flatMap(s => s.lines),
    rootCount: states.reduce((sum, s) => sum + s.rootCount, 0),
  }
}
