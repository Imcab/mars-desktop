import React, { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { TopicAnnounce } from "../../store/appStore"
import { STRUCT_DEFS } from "../../utils/dashboard/valueDecoding"

interface Props {
  topics: Map<string, TopicAnnounce>
  // Filtro opcional: si se provee, solo los topics para los que devuelve true
  // son arrastrables (el resto se ve atenuado). Sin filtro = comportamiento
  // original (todo lo que tenga topic propio es arrastrable).
  dragFilter?: (topic: TopicAnnounce) => boolean
}

// Estructura recursiva para armar el árbol
interface TreeNode {
  name: string
  fullPath: string
  topic?: TopicAnnounce
  children: Map<string, TreeNode>
}

// --- Helpers para reconocer struct:X[] con un StructDef conocido ---
function structNameOf(topicType: string): string | null {
  if (!topicType.endsWith("[]")) return null
  const base = topicType.slice(0, -2)
  if (!base.startsWith("struct:")) return null
  return base.slice("struct:".length)
}

function structDefOf(topic: TopicAnnounce) {
  const name = structNameOf(topic.topic_type)
  return name ? STRUCT_DEFS[name] : undefined
}

// Polling liviano (1Hz) solo para los topics que son struct-array conocidos,
// únicamente para poder mostrar cuántos elementos tienen en el árbol.
function useStructArrayLengths(topics: Map<string, TopicAnnounce>) {
  const [lengths, setLengths] = useState<Record<string, number>>({})

  useEffect(() => {
    const structArrayTopics = Array.from(topics.values()).filter(t => !!structDefOf(t))
    if (structArrayTopics.length === 0) return

    let cancelled = false
    const poll = async () => {
      try {
        const data: Record<string, any> = await invoke("get_live_values", {
          topicNames: structArrayTopics.map(t => t.name),
        })
        if (cancelled) return
        setLengths(prev => {
          const next = { ...prev }
          for (const t of structArrayTopics) {
            const bytes: number[] | undefined = data[t.name]?.Raw
            const def = structDefOf(t)!
            if (bytes) next[t.name] = Math.floor(bytes.length / def.length)
          }
          return next
        })
      } catch {
        // El topic todavía no tiene valor en vivo; se reintenta en el próximo tick.
      }
    }

    poll()
    const interval = setInterval(poll, 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [topics])

  return lengths
}

export default function TreeDirectory({ topics, dragFilter }: Props) {
  const arrayLengths = useStructArrayLengths(topics)

  const tree = useMemo(() => {
    const root: TreeNode = { name: "Root", fullPath: "", children: new Map() }

    topics.forEach(topic => {
      const parts = topic.name.split("/").filter(Boolean)
      let currentNode = root

      parts.forEach((part, index) => {
        if (!currentNode.children.has(part)) {
          currentNode.children.set(part, {
            name: part,
            fullPath: "/" + parts.slice(0, index + 1).join("/"),
            children: new Map()
          })
        }
        currentNode = currentNode.children.get(part)!

        // Si es el último segmento, asignamos el tópico real (es una hoja "de dato").
        // OJO: esto puede pasar aunque el nodo YA tenga children de otro topic
        // (ej. "/Pose" es un topic real de tipo Field2d, y "/Pose/.type" y
        // "/Pose/RobotPose" son subtopics de metadata que cuelgan de la misma ruta).
        // Un nodo así debe seguir siendo arrastrable.
        if (index === parts.length - 1) {
          currentNode.topic = topic
        }
      })
    })

    return root
  }, [topics])

  return (
    <div style={{ padding: "4px 0" }}>
      {Array.from(tree.children.values()).map(node => (
        <TreeFolder key={node.fullPath} node={node} arrayLengths={arrayLengths} dragFilter={dragFilter} />
      ))}
    </div>
  )
}

function TreeFolder({ node, level = 0, arrayLengths, dragFilter }: {
  node: TreeNode
  level?: number
  arrayLengths: Record<string, number>
  dragFilter?: (topic: TopicAnnounce) => boolean
}) {
  const [isOpen, setIsOpen] = useState(false)

  const hasOwnTopic = !!node.topic
  const structDef = node.topic ? structDefOf(node.topic) : undefined
  const structName = node.topic ? structNameOf(node.topic.topic_type) : null
  const isStructArrayNode = hasOwnTopic && !!structDef
  const hasRealChildren = node.children.size > 0
  const isExpandable = hasRealChildren || isStructArrayNode

  // Separado del concepto de "expandible": un nodo con topic propio SIEMPRE
  // es arrastrable (aunque tenga hijos de metadata), salvo que un dragFilter
  // externo lo excluya (ej. la página de Funciones solo permite doubles).
  const passesFilter = hasOwnTopic && (!dragFilter || dragFilter(node.topic!))
  const isDraggable = passesFilter

  const arrayLength = node.topic ? arrayLengths[node.topic.name] : undefined

  const handleDragStart = (e: React.DragEvent) => {
    if (!node.topic) return
    e.dataTransfer.setData("topicName", node.topic.name)
    e.dataTransfer.setData("topicType", node.topic.topic_type)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div>
      <div
        onClick={() => isExpandable && setIsOpen(o => !o)}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px", paddingLeft: 8 + level * 16,
          cursor: isDraggable ? "grab" : (isExpandable ? "pointer" : "default"),
          userSelect: "none", borderRadius: 3,
          opacity: hasOwnTopic && !passesFilter ? 0.45 : 1,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-input)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <span style={{ width: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 11 }}>
          {isExpandable && <i className={`ti ${isOpen ? "ti-chevron-down" : "ti-chevron-right"}`} />}
        </span>

        <span
          style={{
            fontSize: 12,
            fontStyle: hasOwnTopic ? "italic" : "normal",
            fontWeight: hasOwnTopic ? 400 : 600,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
          {hasOwnTopic && node.topic && (
            <span style={{ fontStyle: "normal", color: "var(--text-muted)" }}> – {node.topic.topic_type}</span>
          )}
        </span>
      </div>

      {isOpen && (
        <div>
          {hasRealChildren && Array.from(node.children.values()).map(child => (
            <TreeFolder key={child.fullPath} node={child} level={level + 1} arrayLengths={arrayLengths} dragFilter={dragFilter} />
          ))}
          {isStructArrayNode && (
            <StructArrayIndexRows
              topic={node.topic!}
              structName={structName!}
              length={arrayLength}
              level={level + 1}
              draggable={!dragFilter} // los elementos de un struct[] nunca son "doubles" puros
            />
          )}
        </div>
      )}
    </div>
  )
}

// Filas sintéticas 0..length-1 para un struct:X[] conocido, más una fila
// informativa "length" (igual a como lo muestra AdvantageScope).
function StructArrayIndexRows({ topic, structName, length, level, draggable }: {
  topic: TopicAnnounce, structName: string, length?: number, level: number, draggable: boolean
}) {
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("topicName", topic.name)
    e.dataTransfer.setData("topicType", topic.topic_type)
    e.dataTransfer.setData("arrayIndex", String(index))
    e.dataTransfer.effectAllowed = "copy"
  }

  if (length === undefined) {
    return (
      <div style={{ padding: "3px 8px", paddingLeft: 8 + level * 16, fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
        waiting for live value…
      </div>
    )
  }

  return (
    <>
      {Array.from({ length }, (_, i) => (
        <div
          key={i}
          draggable={draggable}
          onDragStart={draggable ? (e) => handleDragStart(e, i) : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", paddingLeft: 8 + level * 16,
            cursor: draggable ? "grab" : "default", userSelect: "none", borderRadius: 3,
            opacity: draggable ? 1 : 0.45,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-input)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ width: 12, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--text-primary)" }}>
            {i}
            <span style={{ fontStyle: "normal", color: "var(--text-muted)" }}> – {structName}</span>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 8px", paddingLeft: 8 + level * 16, fontSize: 11, color: "var(--text-muted)" }}>
        <span>length</span><span>{length}</span>
      </div>
    </>
  )
}
