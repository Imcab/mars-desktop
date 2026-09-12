import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ConnectionState, LogSource } from "../../store/appStore"
import { MARS_VERSION_LABEL } from "../../constants/version"
import { MARS_PRODUCT_NAME } from "../../constants/edition"
import { MARS_ENABLED } from "@mars"

interface NTLinkStatus {
  address: string
  port: number
  connected: boolean
  latency_us: number
  server_time_us: number | null
}

interface Props {
  connection: ConnectionState
  projectName: string | null
  logSource: LogSource | null
}

// Barra inferior estilo el panel "Time" de RViz: campos "Label: [valor en
// caja]" en fila, plana, sin bloques de color sólido — el color se reserva
// para el punto de estado de conexión, todo lo demás es texto+caja neutra.
export default function StatusBar({ connection, projectName, logSource }: Props) {
  // Un log cargado sustituye a la conexion: comparten el buffer en el backend.
  const connLabel = logSource
    ? "Log file"
    : connection === "sim" ? "Sim running" : connection === "real" ? "Real robot" : "Not connected"
  const connDotColor = logSource
    ? "var(--mars-accent)"
    : connection === "sim" ? "var(--status-sim)" : connection === "real" ? "var(--status-real)" : "var(--text-light)"
  const link = useNTLinkStatus(connection)

  return (
    <div style={{
      background: "var(--bg-dark)",
      height: 26,
      display: "flex",
      alignItems: "center",
      padding: "0 10px",
      gap: 14,
      flexShrink: 0,
      borderTop: "1px solid var(--border-main)",
    }}>
      <StatusField label="Connection">
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: connDotColor, flexShrink: 0 }} />
        {connLabel}
      </StatusField>

      {/* Host y puerto reales de la sesión: el destino ya no es siempre
          localhost:5810 (puede ser el robot, la DS en 6767 o Systemcore). */}
      <StatusField label={logSource ? "Source" : "NT4"}>
        {logSource
          ? `${logSource.name} · ${logSource.topic_count} topics`
          : link ? `${link.address}:${link.port}` : "—"}
      </StatusField>

      {/* Mitad del round trip medido con el ping RTT. "sync…" = todavía no
          volvió ninguna respuesta, así que los relojes no están alineados. */}
      {!logSource && (
        <StatusField label="Latency">
          {link === null
            ? "—"
            : link.server_time_us === null
              ? "sync…"
              : `${(link.latency_us / 1000).toFixed(1)} ms`}
        </StatusField>
      )}

      {MARS_ENABLED && (
        <StatusField label="Project">
          {projectName ?? "none"}
        </StatusField>
      )}

      {/* Una version escrita a mano acá mentía desde hacía varias releases.
          Sale de la misma constante que el splash y el instalador. */}
      <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-light)" }}>
        {MARS_PRODUCT_NAME} {MARS_VERSION_LABEL}
      </div>
    </div>
  )
}

// El estado del enlace lo mide el backend con el ping RTT; se relee a 1Hz
// porque solo alimenta texto de la barra, no nada que se anime.
function useNTLinkStatus(connection: ConnectionState): NTLinkStatus | null {
  const [status, setStatus] = useState<NTLinkStatus | null>(null)

  useEffect(() => {
    if (connection === "disconnected") {
      setStatus(null)
      return
    }

    let cancelled = false
    const poll = () => {
      invoke<NTLinkStatus>("get_nt_link_status")
        .then(s => { if (!cancelled) setStatus(s.connected ? s : null) })
        .catch(() => { /* silencioso: puede pasar mientras reconecta */ })
    }

    poll()
    const interval = setInterval(poll, 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [connection])

  return status
}

function StatusField({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}:</span>
      <span style={{
        display: "flex", alignItems: "center", gap: 4,
        fontSize: 10.5, color: "var(--text-primary)", fontFamily: "ui-monospace, monospace",
        background: "var(--bg-input)", border: "1px solid var(--border-main)", borderRadius: 2,
        padding: "1px 6px", height: 16,
      }}>
        {children}
      </span>
    </div>
  )
}
