import React, { useMemo, useState } from "react"
import { TopicAnnounce } from "../../store/appStore"
import { useStructSchemaStore } from "../../store/structSchemaStore"
import { useTableTypeStore } from "../../store/tableTypeStore"
import { useNTSnapshot } from "../../utils/nt/useNTSnapshot"
import { classifyTopic } from "../../utils/dashboard/topicClassification"
import { arrayLengthOf, formatArrayElement, formatTopicValue } from "../../utils/dashboard/valuePreview"

interface Props {
  topics: Map<string, TopicAnnounce>
  // Filtro opcional: si se provee, solo los topics para los que devuelve true
  // son arrastrables (el resto se ve atenuado). Sin filtro = comportamiento
  // original (todo lo que tenga topic propio es arrastrable).
  dragFilter?: (topic: TopicAnnounce) => boolean
  // Hace arrastrables nodos SIN topic propio (carpetas). Si devuelve un string,
  // ese nodo se puede arrastrar y el string viaja como "topicType" (ej.
  // "Mechanism2d", que en NT4 es una tabla entera y no un topic).
  folderDragType?: (fullPath: string) => string | null
}

interface TreeNode {
  name: string
  fullPath: string
  topic?: TopicAnnounce
  children: Map<string, TreeNode>
}

// Los subtopics que empiezan con "." son metadata de WPILib (.type,
// .controllable, .instance) y ".schema" es el registro de descriptores de
// struct. Nada de eso se arrastra ni se lee: solo ensucia el árbol. Lo útil
// de ".type" ya se muestra como etiqueta al lado de la tabla.
function isMetadataSegment(name: string): boolean {
  return name.startsWith(".")
}

// Orden natural: "Module10" va DESPUÉS de "Module9", no antes. El orden que
// trae el Map es el de llegada de los announces, que es arbitrario.
function sortNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

function sortTree(node: TreeNode): TreeNode {
  const sorted = new Map<string, TreeNode>()
  Array.from(node.children.keys())
    .sort(sortNames)
    .forEach(key => sorted.set(key, sortTree(node.children.get(key)!)))
  node.children = sorted
  return node
}

/**
 * Topics que hay que pedirle al backend AHORA: solo los de las filas que
 * están renderizadas. Antes se poleaba cada struct-array del log a 1Hz
 * aunque el árbol estuviera cerrado.
 */
function collectVisibleTopics(root: TreeNode, expanded: Set<string>): string[] {
  const out: string[] = []
  const walk = (node: TreeNode) => {
    node.children.forEach(child => {
      if (child.topic) out.push(child.topic.name)
      if (expanded.has(child.fullPath)) walk(child)
    })
  }
  walk(root)
  return out
}

export default function TreeDirectory({ topics, dragFilter, folderDragType }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Suscripciones para re-renderizar cuando llega un schema nuevo (cambia qué
  // structs se pueden expandir) o el ".type" de una tabla.
  const dynamicDefs = useStructSchemaStore(s => s.defs)
  const tableTypes = useTableTypeStore(s => s.types)

  const tree = useMemo(() => {
    const root: TreeNode = { name: "Root", fullPath: "", children: new Map() }

    topics.forEach(topic => {
      const parts = topic.name.split("/").filter(Boolean)
      if (parts.some(isMetadataSegment)) return

      let currentNode = root
      parts.forEach((part, index) => {
        if (!currentNode.children.has(part)) {
          currentNode.children.set(part, {
            name: part,
            fullPath: "/" + parts.slice(0, index + 1).join("/"),
            children: new Map(),
          })
        }
        currentNode = currentNode.children.get(part)!

        // Un nodo puede tener topic propio Y children a la vez (una tabla que
        // además publica un valor en su raíz); tiene que seguir siendo hoja
        // arrastrable en ese caso.
        if (index === parts.length - 1) currentNode.topic = topic
      })
    })

    return sortTree(root)
  }, [topics])

  const visibleTopics = useMemo(() => collectVisibleTopics(tree, expanded), [tree, expanded])
  // 250ms y no 33: es texto de apoyo, no una animación. useNTSnapshot ya
  // resuelve si pedir el valor en vivo o el del instante scrubbeado.
  const values = useNTSnapshot(visibleTopics, 250)

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div style={{ padding: "1px 0", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      {Array.from(tree.children.values()).map((node, i) => (
        <TreeRow
          key={node.fullPath}
          node={node}
          level={0}
          rowIndex={i}
          expanded={expanded}
          onToggle={toggle}
          values={values}
          tableTypes={tableTypes}
          structDefs={dynamicDefs}
          dragFilter={dragFilter}
          folderDragType={folderDragType}
        />
      ))}
    </div>
  )
}

interface RowProps {
  node: TreeNode
  level: number
  /** Solo para el cebrado; no tiene que ser global, alcanza con alternar por hermanos. */
  rowIndex: number
  expanded: Set<string>
  onToggle: (path: string) => void
  values: Record<string, any>
  tableTypes: Record<string, string>
  structDefs: Record<string, unknown>
  dragFilter?: (topic: TopicAnnounce) => boolean
  folderDragType?: (fullPath: string) => string | null
}

const ROW_HEIGHT = 18
const INDENT_PX = 13

function TreeRow(props: RowProps) {
  const { node, level, rowIndex, expanded, onToggle, values, tableTypes, dragFilter, folderDragType } = props
  const [hovered, setHovered] = useState(false)

  const isOpen = expanded.has(node.fullPath)
  const topic = node.topic
  const liveValue = topic ? values[topic.name] : undefined

  const classification = topic ? classifyTopic(topic.topic_type) : null
  const arrayLength = topic && classification?.isArrayType
    ? arrayLengthOf(topic.topic_type, liveValue)
    : null

  const hasRealChildren = node.children.size > 0
  const canExpandArray = arrayLength !== null && arrayLength > 0
  const isExpandable = hasRealChildren || canExpandArray

  const passesFilter = !!topic && (!dragFilter || dragFilter(topic))

  // Una carpeta puede representar algo consumible aunque no sea un topic: una
  // tabla Field2d o Mechanism2d. `folderDragType` dice si ESTA página la
  // acepta; `tableTypes` dice qué es, para etiquetarla siempre.
  const folderType = !topic && folderDragType ? folderDragType(node.fullPath) : null
  const tableType = !topic ? tableTypes[node.fullPath] : undefined
  const isDraggable = passesFilter || folderType !== null

  const valueText = topic ? formatTopicValue(topic.topic_type, liveValue) : null

  const handleDragStart = (e: React.DragEvent) => {
    if (topic) {
      e.dataTransfer.setData("topicName", topic.name)
      e.dataTransfer.setData("topicType", topic.topic_type)
    } else if (folderType) {
      e.dataTransfer.setData("topicName", node.fullPath)
      e.dataTransfer.setData("topicType", folderType)
    } else {
      return
    }
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div>
      <div
        onClick={() => isExpandable && onToggle(node.fullPath)}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 3,
          height: ROW_HEIGHT, paddingRight: 6, paddingLeft: 3 + level * INDENT_PX,
          cursor: isDraggable ? "grab" : isExpandable ? "pointer" : "default",
          userSelect: "none", whiteSpace: "nowrap",
          background: hovered ? "var(--tree-hover-bg)" : rowIndex % 2 === 1 ? "var(--bg-panel)" : "transparent",
          opacity: topic && !passesFilter ? 0.45 : 1,
        }}
      >
        {/* La flecha es lo único que distingue una carpeta de una hoja en
            filas de 18px, así que va con el color del texto y no en gris
            claro: antes casi no se veía sobre el cebrado. */}
        <span style={{
          width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          color: isExpandable ? "var(--text-primary)" : "transparent", fontSize: 11,
        }}>
          {isExpandable && <i className={`ti ${isOpen ? "ti-caret-down-filled" : "ti-caret-right-filled"}`} />}
        </span>

        <span
          style={{
            fontSize: 11,
            fontWeight: topic ? 400 : 600,
            color: "var(--text-primary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            flexShrink: 1, minWidth: 0,
          }}
        >
          {node.name}
          {topic && (
            <span style={{ fontStyle: "normal", color: "var(--text-muted)" }}>
              {" – "}{topic.topic_type}
              {arrayLength !== null && `[${arrayLength}]`}
            </span>
          )}
          {/* Una tabla sendable (Field2d, Mechanism2d, chooser...) ya no se ve
              como una carpeta cualquiera: dice qué es aunque esta página no
              sepa consumirla. */}
          {!topic && (folderType ?? tableType) && (
            <span style={{ fontStyle: "normal", color: "var(--mars-accent)" }}> – {folderType ?? tableType}</span>
          )}
        </span>

        {valueText !== null && (
          <span
            title={valueText}
            style={{
              marginLeft: "auto", flexShrink: 0, maxWidth: "50%", paddingLeft: 8,
              fontSize: 10, fontFamily: "ui-monospace, monospace",
              color: "var(--text-muted)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {valueText}
          </span>
        )}
      </div>

      {isOpen && (
        <div>
          {Array.from(node.children.values()).map((child, i) => (
            <TreeRow {...props} key={child.fullPath} node={child} level={level + 1} rowIndex={i} />
          ))}

          {canExpandArray && topic && (
            <ArrayIndexRows
              topic={topic}
              liveValue={liveValue}
              length={arrayLength!}
              level={level + 1}
              // Los índices se arrastran solo donde la página sabe recibirlos.
              // Con un dragFilter puesto (Field, Swerve, Functions) el drop
              // ignora arrayIndex y agregaría el array entero.
              draggable={!dragFilter}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Cuántos índices se listan antes de cortar; un array de 500 poses colgaría el árbol. */
const MAX_INDEX_ROWS = 128

// Filas sintéticas 0..length-1 de cualquier array (numérico, booleano, string
// o de structs), cada una arrastrable por separado.
function ArrayIndexRows({ topic, liveValue, length, level, draggable }: {
  topic: TopicAnnounce
  liveValue: any
  length: number
  level: number
  draggable: boolean
}) {
  const shown = Math.min(length, MAX_INDEX_ROWS)

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("topicName", topic.name)
    e.dataTransfer.setData("topicType", topic.topic_type)
    e.dataTransfer.setData("arrayIndex", String(index))
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <>
      {Array.from({ length: shown }, (_, i) => {
        const text = formatArrayElement(topic.topic_type, liveValue, i)
        return (
          <div
            key={i}
            draggable={draggable}
            onDragStart={draggable ? e => handleDragStart(e, i) : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              height: ROW_HEIGHT, paddingRight: 6, paddingLeft: 3 + level * INDENT_PX,
              cursor: draggable ? "grab" : "default", userSelect: "none", whiteSpace: "nowrap",
              background: i % 2 === 1 ? "var(--bg-panel)" : "transparent",
              opacity: draggable ? 1 : 0.45,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--tree-hover-bg)")}
            onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 1 ? "var(--bg-panel)" : "transparent")}
          >
            <span style={{ width: 12, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, fontFamily: "ui-monospace, monospace" }}>
              [{i}]
            </span>
            {text !== null && (
              <span
                title={text}
                style={{
                  marginLeft: "auto", flexShrink: 1, minWidth: 0, maxWidth: "72%", paddingLeft: 8,
                  fontSize: 10, fontFamily: "ui-monospace, monospace",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {text}
              </span>
            )}
          </div>
        )
      })}

      {length > shown && (
        <div style={{ height: ROW_HEIGHT, display: "flex", alignItems: "center", paddingLeft: 17 + level * INDENT_PX, fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>
          … {length - shown} more
        </div>
      )}
    </>
  )
}
