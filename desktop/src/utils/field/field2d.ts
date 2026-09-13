// Lectura del Field2d de WPILib (SmartDashboard.putData("Field", field2d)).
//
// Igual que Mechanism2d, un Field2d NO es un topic sino una TABLA:
//
//   /SmartDashboard/Field/.type      string   = "Field2d"
//   /SmartDashboard/Field/Robot      double[] [x, y, GRADOS]  o struct:Pose2d
//   /SmartDashboard/Field/<lo que sea>         idem, o struct:Pose2d[]
//
// Por eso no se podía arrastrar antes: el árbol solo permitía arrastrar hojas
// con topic propio, y la raíz de la tabla no lo es.

import { TopicAnnounce } from "../../store/appStore"
import { FieldPose, extractPoses, isPoseTopic } from "./poseExtraction"

export const FIELD2D_TYPE = "Field2d"

/** El objeto que WPILib crea por defecto para el robot. */
const ROBOT_KEY = "Robot"

// Umbrales de Elastic para decidir si un objeto es una trayectoria o un puñado
// de objetos sueltos: nadie dibuja 9 robots, pero una trayectoria sí tiene
// cientos de puntos.
const TRAJECTORY_MIN_POSES = 8

export interface Field2dObject {
  /** Nombre completo del topic, único dentro de la tabla. */
  key: string
  /** Último segmento, que es como lo nombró el código del robot. */
  name: string
  isRobot: boolean
  isTrajectory: boolean
  poses: FieldPose[]
}

/** Los topics que hay que pedirle al backend para dibujar esta tabla. */
export function field2dTopicNames(topics: Map<string, TopicAnnounce>, prefix: string): string[] {
  const names: string[] = []
  topics.forEach(topic => {
    if (!topic.name.startsWith(prefix + "/")) return
    // Los subtopics de metadata (.type, .controllable) no son objetos.
    const rest = topic.name.slice(prefix.length + 1)
    if (rest.startsWith(".")) return
    if (!isPoseTopic(topic.topic_type)) return
    names.push(topic.name)
  })
  return names
}

/**
 * Un prefijo es un Field2d si su ".type" lo dice. Se necesita el VALOR del
 * topic, no solo el announce, por eso `tableTypes` viene de afuera (lo llena
 * useNTTableTypes leyendo esos strings).
 */
export function isField2dTable(tableTypes: Record<string, string>, prefix: string): boolean {
  return tableTypes[prefix] === FIELD2D_TYPE
}

export function findField2dTables(tableTypes: Record<string, string>): string[] {
  return Object.entries(tableTypes)
    .filter(([, type]) => type === FIELD2D_TYPE)
    .map(([prefix]) => prefix)
    .sort()
}

export function extractField2dObjects(
  values: Record<string, any>,
  topics: Map<string, TopicAnnounce>,
  prefix: string,
): Field2dObject[] {
  const out: Field2dObject[] = []

  for (const name of field2dTopicNames(topics, prefix)) {
    const topic = topics.get(name)
    if (!topic) continue

    const poses = extractPoses(values[name], topic.topic_type)
    if (poses.length === 0) continue

    const shortName = name.slice(prefix.length + 1)
    const isRobot = shortName === ROBOT_KEY

    // Misma heurística que Elastic: el nombre manda, y si no dice nada se mira
    // cuántas poses trae — un objeto suelto no tiene decenas.
    const isTrajectory =
      !isRobot &&
      (shortName.toLowerCase().endsWith("trajectory") || poses.length > TRAJECTORY_MIN_POSES)

    out.push({ key: name, name: shortName, isRobot, isTrajectory, poses })
  }

  // El robot siempre último para que quede dibujado por encima del resto.
  return out.sort((a, b) => Number(a.isRobot) - Number(b.isRobot))
}
