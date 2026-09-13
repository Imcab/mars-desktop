import { useRef, useState } from "react"
import { ConnectionState } from "../../store/appStore"
import { useSelectionStore, PLAYBACK_SPEEDS } from "../../store/selectionStore"
import { useMarkerStore, findAdjacentMarker } from "../../store/markerStore"
import { useNTLiveClock } from "../../utils/nt/useNTLiveClock"
import { usePlaybackEngine } from "../../utils/nt/usePlaybackEngine"
import TimelineCanvas, { TimelineCanvasHandle } from "./TimelineCanvas"
import ToolbarButton from "../common/ToolbarButton"
import TimelineSettings from "./TimelineSettings"

interface Props {
  connection: ConnectionState
  /** Hay un log cargado: hay datos que recorrer aunque no haya conexion NT4. */
  hasLog?: boolean
}

// Chrome de la timeline global: transporte (play/pausa/ir al final), marcas y
// ajustes. El motor de dibujo y toda la interacción de scrub/pan/zoom viven en
// TimelineCanvas — este componente solo orquesta el estado.
export default function TimelineGlobal({ connection, hasLog = false }: Props) {
  const canvasRef = useRef<TimelineCanvasHandle>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const isLive = useSelectionStore((s) => s.isLive)
  const selectedTime = useSelectionStore((s) => s.selectedTime)
  const isPlaying = useSelectionStore((s) => s.isPlaying)
  const playbackSpeed = useSelectionStore((s) => s.playbackSpeed)
  const goLive = useSelectionStore((s) => s.goLive)
  const pauseAt = useSelectionStore((s) => s.pauseAt)
  const scrubTo = useSelectionStore((s) => s.scrubTo)
  const setHovered = useSelectionStore((s) => s.setHovered)
  const play = useSelectionStore((s) => s.play)
  const stop = useSelectionStore((s) => s.stop)
  const setPlaybackSpeed = useSelectionStore((s) => s.setPlaybackSpeed)

  const markers = useMarkerStore((s) => s.markers)
  const addMarker = useMarkerStore((s) => s.addMarker)
  const removeMarker = useMarkerStore((s) => s.removeMarker)

  // Reloj real: startUs viene del PRIMER dato recibido por el backend (no
  // del montaje del componente), getEstimatedNowUs() del último dato + una
  // interpolación suave para que fluya entre polls.
  const { startUs, endUs, getEstimatedNowUs } = useNTLiveClock(200)

  // En un log el "ahora" es el ultimo sample y no se mueve: extrapolar con
  // performance.now() (que es lo correcto en vivo) haria que el playhead se
  // fuera corriendo hacia adelante sobre una zona sin datos.
  const getNowUs = hasLog ? () => endUs : getEstimatedNowUs

  // Reproducir avanza selectedTime; el tope es el último dato disponible.
  usePlaybackEngine(getNowUs)

  // "isConnected" aca significa "hay una fuente de datos", no literalmente un
  // socket: con un log abierto la timeline tiene que funcionar igual.
  const isConnected = connection !== "disconnected" || hasLog
  const hasData = startUs !== null

  const statusColor = !isConnected || !hasData ? "var(--text-muted)"
    : isPlaying ? "var(--mars-accent)"
    : isLive ? "var(--status-sim)" : "var(--mars-red)"
  // El texto se fue al tooltip: la barra ya dice lo mismo con el color, y
  // ese bloque de letras comía ancho útil de la regla de tiempo.
  const statusTitle = !isConnected
    ? "Offline"
    : !hasData ? "Waiting for data"
    : isPlaying ? `Playing ${playbackSpeed}×`
    : hasLog ? "Log file"
    : isLive ? "Live" : "Paused"

  /** Instante al que apuntan las acciones que necesitan un "ahora" concreto. */
  const currentTime = () => selectedTime ?? getNowUs() ?? startUs ?? 0

  const handlePlayPause = () => {
    if (isPlaying) {
      stop()
      return
    }
    // Sin cursor (en vivo) arranca desde el presente; con cursor, desde ahí.
    canvasRef.current?.stopFollowingLive()
    play(currentTime())
  }

  const handleAddMarker = () => {
    const label = window.prompt("Marker label", `Mark ${markers.length + 1}`)
    if (label === null) return
    addMarker(currentTime(), label)
  }

  const jumpToMarker = (direction: "prev" | "next") => {
    const target = findAdjacentMarker(markers, currentTime(), direction)
    if (!target) return
    canvasRef.current?.stopFollowingLive()
    pauseAt(target.timeUs)
  }

  return (
    <div
      style={{
        height: 38,
        background: "linear-gradient(180deg, #f2f2f4 0%, #e2e2e6 100%)",
        borderTop: "1px solid var(--bevel-light)",
        borderBottom: "1px solid var(--bevel-dark)",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        flexShrink: 0,
        opacity: isConnected ? 1 : 0.5,
        position: "relative",
        gap: 8,
        userSelect: "none",
        WebkitUserSelect: "none"
      }}
    >
      {/* Transporte: reproducir sigue desde la línea, "ir al final" es lo que
          salta al último dato. Antes esas dos cosas eran el mismo botón. */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <ToolbarButton
          size="sm"
          icon="ti-player-track-prev"
          label="Previous marker"
          disabled={!isConnected || markers.length === 0}
          onClick={() => jumpToMarker("prev")}
        />
        <ToolbarButton
          size="sm"
          icon={isPlaying ? "ti-player-pause" : "ti-player-play"}
          label={isPlaying ? "Pause" : "Play from cursor"}
          active={isPlaying}
          disabled={!isConnected || !hasData}
          onClick={handlePlayPause}
        />
        <ToolbarButton
          size="sm"
          icon="ti-player-track-next"
          label="Next marker"
          disabled={!isConnected || markers.length === 0}
          onClick={() => jumpToMarker("next")}
        />
        <ToolbarButton
          size="sm"
          icon="ti-player-skip-forward"
          label="Jump to latest"
          active={isLive}
          disabled={!isConnected}
          onClick={() => canvasRef.current?.goLive()}
        />
      </div>

      <div style={{ width: 1, height: 18, background: "var(--bevel-dark)", flexShrink: 0 }} />

      <ToolbarButton
        size="sm"
        icon="ti-flag-plus"
        label="Add marker at cursor"
        disabled={!isConnected || !hasData}
        onClick={handleAddMarker}
      />

      <span
        title={statusTitle}
        style={{
          width: 9, height: 9, borderRadius: "50%", flexShrink: 0, margin: "0 2px",
          background: statusColor,
          // Hueco hundido alrededor del LED, como un indicador de panel físico.
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.25), 0 0 0 2px var(--bg-toolbar), 0 0 0 3px var(--bevel-dark)${
            isConnected && hasData ? `, 0 0 6px ${statusColor}` : ""
          }`,
        }}
      />

      <TimelineCanvas
        ref={canvasRef}
        isConnected={isConnected}
        hasData={hasData}
        startUs={startUs}
        getEstimatedNowUs={getNowUs}
        isLive={isLive}
        selectedTime={selectedTime}
        markers={markers}
        goLive={goLive}
        pauseAt={pauseAt}
        scrubTo={scrubTo}
        setHovered={setHovered}
        onMarkerContextMenu={(id) => {
          const marker = markers.find(m => m.id === id)
          if (marker && window.confirm(`Delete marker "${marker.label}"?`)) removeMarker(id)
        }}
      />

      <div style={{ position: "relative", flexShrink: 0 }}>
        <ToolbarButton
          size="sm"
          icon="ti-adjustments-horizontal"
          label="Timeline settings"
          active={settingsOpen}
          onClick={() => setSettingsOpen(o => !o)}
        />
        {settingsOpen && (
          <TimelineSettings
            playbackSpeed={playbackSpeed}
            speeds={PLAYBACK_SPEEDS}
            onChangeSpeed={setPlaybackSpeed}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
