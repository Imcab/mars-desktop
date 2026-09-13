import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { TopicAnnounce } from "../store/appStore"
import { useStructSchemaStore } from "../store/structSchemaStore"

// WPILib publica el descriptor de cada struct en un topic hermano bajo
// ".schema". La ruta puede estar anidada (AdvantageKit loguea bajo
// "/AdvantageKit/.schema/..."), así que se busca el fragmento en cualquier
// posición en vez de exigir que arranque el nombre.
const SCHEMA_MARKER = "/.schema/struct:"

export function structNameFromSchemaKey(topicName: string): string | null {
  const idx = topicName.indexOf(SCHEMA_MARKER)
  if (idx === -1) return null
  let name = topicName.slice(idx + SCHEMA_MARKER.length)
  if (name.endsWith("[]")) name = name.slice(0, -2)
  return name.length > 0 ? name : null
}

const RETRY_MS = 1000

/**
 * Descubre los topics de schema y registra su contenido en el store, para que
 * la app entienda structs que no están en la tabla escrita a mano.
 *
 * Reintenta porque un topic se anuncia ANTES de tener valor: en vivo, el
 * announce y el primer sample llegan en mensajes distintos, así que la primera
 * lectura de un schema recién aparecido suele venir vacía.
 */
export function useStructSchemas(topics: Map<string, TopicAnnounce>) {
  const registerSchemas = useStructSchemaStore(s => s.registerSchemas)
  const clear = useStructSchemaStore(s => s.clear)

  useEffect(() => {
    // Sin topics no hay fuente de datos (se desconectó o se cerró el log): los
    // schemas del robot anterior no aplican al siguiente.
    if (topics.size === 0) {
      clear()
      return
    }

    const schemaTopics: { topic: string; name: string }[] = []
    topics.forEach(t => {
      const name = structNameFromSchemaKey(t.name)
      if (name !== null) schemaTopics.push({ topic: t.name, name })
    })
    if (schemaTopics.length === 0) return

    let cancelled = false
    let timer: number | null = null

    const poll = async () => {
      if (cancelled) return

      const known = useStructSchemaStore.getState().texts
      const pending = schemaTopics.filter(s => !(s.name in known))
      if (pending.length === 0) return // todos resueltos, no hace falta reintentar

      try {
        const data = await invoke<Record<string, any>>("get_live_values", {
          topicNames: pending.map(s => s.topic),
        })
        if (cancelled) return

        const entries: Record<string, string> = {}
        for (const s of pending) {
          const bytes = data[s.topic]?.Raw
          if (!Array.isArray(bytes) || bytes.length === 0) continue
          entries[s.name] = new TextDecoder().decode(new Uint8Array(bytes))
        }
        if (Object.keys(entries).length > 0) registerSchemas(entries)
      } catch {
        // El backend puede estar reconectando; se reintenta en el próximo tick.
      }

      if (!cancelled) timer = window.setTimeout(poll, RETRY_MS)
    }

    poll()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [topics, registerSchemas, clear])
}
