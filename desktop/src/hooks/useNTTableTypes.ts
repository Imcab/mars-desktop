import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { TopicAnnounce } from "../store/appStore"
import { useTableTypeStore } from "../store/tableTypeStore"

const TYPE_SUFFIX = "/.type"
const RETRY_MS = 1000

/**
 * Lee el valor de cada subtopic ".type" y lo deja en el store, que es lo que
 * permite reconocer un Field2d (o cualquier otra tabla sendable) sin adivinar
 * por su forma.
 *
 * Reintenta por el mismo motivo que los schemas: el announce de un topic llega
 * antes que su primer valor, así que la primera lectura suele venir vacía.
 */
export function useNTTableTypes(topics: Map<string, TopicAnnounce>) {
  const registerTypes = useTableTypeStore(s => s.registerTypes)
  const clear = useTableTypeStore(s => s.clear)

  useEffect(() => {
    // Sin topics no hay fuente: los tipos de la sesión anterior no aplican.
    if (topics.size === 0) {
      clear()
      return
    }

    const typeTopics: { topic: string; prefix: string }[] = []
    topics.forEach(t => {
      if (!t.name.endsWith(TYPE_SUFFIX)) return
      if (!t.topic_type.includes("string")) return
      typeTopics.push({ topic: t.name, prefix: t.name.slice(0, -TYPE_SUFFIX.length) })
    })
    if (typeTopics.length === 0) return

    let cancelled = false
    let timer: number | null = null

    const poll = async () => {
      if (cancelled) return

      const known = useTableTypeStore.getState().types
      const pending = typeTopics.filter(t => !(t.prefix in known))
      if (pending.length === 0) return

      try {
        const data = await invoke<Record<string, any>>("get_live_values", {
          topicNames: pending.map(t => t.topic),
        })
        if (cancelled) return

        const entries: Record<string, string> = {}
        for (const t of pending) {
          const value = data[t.topic]?.String
          if (typeof value === "string" && value.length > 0) entries[t.prefix] = value
        }
        if (Object.keys(entries).length > 0) registerTypes(entries)
      } catch {
        // Reconectando; se reintenta en el próximo tick.
      }

      if (!cancelled) timer = window.setTimeout(poll, RETRY_MS)
    }

    poll()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [topics, registerTypes, clear])
}
