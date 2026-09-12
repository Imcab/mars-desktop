// Gestor de assets 3D: los modelos de cancha y de robot que dibuja la pestaña.
//
// Un "asset" es una carpeta con un `config.json` y uno o varios `model*.glb`,
// exactamente el formato de AdvantageScope. Hay dos clases y hacen cosas
// distintas, así que el panel las separa en vez de mezclarlas en una lista:
//
//   CANCHA -> se elige en el selector FIELD de la barra de arriba.
//   ROBOT  -> se elige en la pestaña SCENE, y cada objeto robot puede usar otro.
//
// Esa segunda línea es la que faltaba: sin ella, uno instala un robot y no
// tiene idea de dónde se supone que aparece.
//
// Y una nota que importa: el .step que publica FIRST NO se puede cargar acá ni
// en AdvantageScope. STEP es un formato de CAD por fronteras (B-rep), sin
// mallas: hay que convertirlo a glTF antes. El panel lo dice, porque bajarlo y
// que no funcione es el primer tropiezo de todo el mundo.

import { memo, useState } from "react"
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"
import {
  ASSET_CATALOG, ASSET_LICENSE_NOTE, AssetPack, CatalogEntry, assetStoreDir,
  deleteAssetPack, downloadAsset, importAssetFolder, installAssetZipFromDisk,
  isFieldPack, isRobotPack,
} from "../../../utils/field3d/assetStore"
import { formatBytes } from "../../../utils/field3d/assetConfig"
import { ErrorNote, Hint, PanelButton, PanelIcon, Row, Section } from "../three/PanelFields"

interface Props {
  packs: AssetPack[]
  onChanged: () => void
}

const STEP_CONVERT_DOC = "https://docs.advantagescope.org/more-features/custom-assets/gltf-convert/"
const FIELD_LIBRARY = "https://www.firstinspires.org/resources/library/frc/playing-field"

function Field3dAssetPanel({ packs, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const fields = packs.filter(isFieldPack)
  const robots = packs.filter(isRobotPack)
  const installed = new Set(packs.map(p => p.key))

  // Toda acción que toca el disco pasa por acá: así el panel queda bloqueado
  // mientras corre (una segunda descarga en paralelo escribiría sobre la
  // primera) y cualquier fallo aterriza en el mismo cartel.
  const run = async (label: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(label)
    setError(null)
    setDone(null)
    try {
      const result = await action()
      // `null` = el usuario cerró el dialog sin elegir nada. No es un error ni
      // hay nada que celebrar.
      if (result !== null && success) setDone(success)
      onChanged()
    } catch (err) {
      setError(String((err as any)?.message ?? err))
    } finally {
      setBusy(null)
    }
  }

  // `revealItemInDir` y no `openPath`: el primero entra en el permiso
  // `opener:default` que la app ya declara, y abrir el explorador con la
  // carpeta seleccionada es exactamente lo que se quiere acá.
  const handleReveal = async () => {
    setError(null)
    try {
      await revealItemInDir(await assetStoreDir())
    } catch (err) {
      setError(String((err as any)?.message ?? err))
    }
  }

  const handleDownload = (entry: CatalogEntry) => run(
    entry.key,
    () => downloadAsset(entry),
    entry.kind === "robot"
      ? `${entry.label} installed. Pick it under Scene › Robot model.`
      : `${entry.label} installed. Pick it in the FIELD selector above.`,
  )

  const handleRemove = (key: string) => run(key, () => deleteAssetPack(key))

  const catalogueFields = ASSET_CATALOG.filter(e => e.kind === "field")
  const catalogueRobots = ASSET_CATALOG.filter(e => e.kind === "robot")

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "10px 12px", fontSize: 10, lineHeight: 1.6,
        color: "var(--text-muted)", borderBottom: "1px solid var(--border-light)",
      }}>
        The 3D models this tab draws. Two kinds, and they show up in different places:
        <br />
        <b style={{ color: "var(--text-primary)" }}>Fields</b> — pick one in the
        <b style={{ color: "var(--text-primary)" }}> FIELD</b> selector at the top of the window.
        <br />
        <b style={{ color: "var(--text-primary)" }}>Robots</b> — pick one under
        <b style={{ color: "var(--text-primary)" }}> Scene › Robot model</b>, or per object in
        the Objects tab. Without one, every robot is drawn as a box with coloured bumpers.
      </div>

      <Section title={`Fields installed (${fields.length})`} defaultOpen svg="field3d.svg" svgFallback="visualizer2d.svg" icon="ti-map-2">
        {fields.length === 0
          ? <Hint>None yet — the tab is running on the built-in schematic field. Download a season below.</Hint>
          : fields.map(pack => (
            <PackRow key={pack.key} pack={pack} busy={busy} onRemove={handleRemove} />
          ))}
      </Section>

      <Section title={`Robots installed (${robots.length})`} defaultOpen svg="robot.svg" icon="ti-robot">
        {robots.length === 0
          ? (
            <Hint>
              None yet, so your robot is drawn as a plain box. Download the KitBot below to
              see how it works, or use <i>Install folder</i> to add your own CAD once it is
              exported as <code>.glb</code>.
            </Hint>
          )
          : robots.map(pack => (
            <PackRow key={pack.key} pack={pack} busy={busy} onRemove={handleRemove} />
          ))}
      </Section>

      <Section title="Download" defaultOpen svg="export.svg" icon="ti-download">
        <Hint>
          Official AdvantageScope models — the same geometry that app uses, already converted
          from the FIRST CAD and measured. They are fetched on demand rather than shipped with
          MARS, because one field weighs more than the whole app.
        </Hint>

        <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>
          Fields
        </div>
        {catalogueFields.map(entry => (
          <CatalogueRow
            key={entry.key}
            entry={entry}
            installed={installed.has(entry.key)}
            busy={busy}
            onDownload={handleDownload}
          />
        ))}

        <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 }}>
          Robots
        </div>
        {catalogueRobots.map(entry => (
          <CatalogueRow
            key={entry.key}
            entry={entry}
            installed={installed.has(entry.key)}
            busy={busy}
            onDownload={handleDownload}
          />
        ))}

        {busy !== null && (
          <Hint>Downloading and unpacking — a field can take a minute on a slow connection.</Hint>
        )}
        {done !== null && (
          <div style={{ fontSize: 10, lineHeight: 1.4, color: "var(--status-sim, var(--mars-accent))" }}>
            {done}
          </div>
        )}
        {error !== null && <ErrorNote>{error}</ErrorNote>}

        <Hint>{ASSET_LICENSE_NOTE}</Hint>
      </Section>

      <Section title="Install from disk" svg="import-model.svg" icon="ti-folder-plus">
        <Hint>
          For an asset you already have: one you downloaded by hand, one another team shared,
          or your own robot. Both accept the AdvantageScope layout — a{" "}
          <code>config.json</code> next to a <code>model.glb</code>.
        </Hint>
        <Row>
          <PanelButton
            label="Install .zip…"
            svg="import-model.svg"
            icon="ti-file-zip"
            disabled={busy !== null}
            onClick={() => run("zip", installAssetZipFromDisk, "Archive installed.")}
            title="An asset archive you already downloaded, still zipped"
          />
          <PanelButton
            label="Install folder…"
            svg="open-folder.svg"
            icon="ti-folder"
            disabled={busy !== null}
            onClick={() => run("folder", importAssetFolder, "Folder installed.")}
            title="An already-extracted folder — AdvantageScope's userAssets works as-is"
          />
        </Row>
        <PanelButton
          label="Show the asset folder"
          svg="open-folder.svg"
          icon="ti-folder-open"
          onClick={handleReveal}
          title="Opens the folder where installed assets live"
        />
      </Section>

      <Section title="Using your own CAD" svg="model-file.svg" icon="ti-help">
        <Hint>
          <b>A .step file cannot be loaded</b> — not here and not in AdvantageScope. STEP
          describes surfaces mathematically (B-rep) and has no triangles; a renderer needs a
          mesh. The field CAD that FIRST publishes is STEP, so it has to be converted first.
          <br /><br />
          The short version: open the .step in <b>CAD Assistant</b> (free), tick
          <i> merge faces within the same part</i>, and save as <b>.glb</b>. Put that file in a
          folder beside a <code>config.json</code>, then use <i>Install folder</i> above.
          <br /><br />
          Unless you need this season's field exactly as FIRST published it, the download list
          is the shortcut: someone already did the conversion, the cleanup and the measuring.
        </Hint>
        <Row>
          <PanelButton
            label="Convert guide"
            svg="help.svg"
            icon="ti-external-link"
            onClick={() => { void openUrl(STEP_CONVERT_DOC) }}
          />
          <PanelButton
            label="FIRST field CAD"
            svg="help.svg"
            icon="ti-external-link"
            onClick={() => { void openUrl(FIELD_LIBRARY) }}
          />
        </Row>
      </Section>
    </div>
  )
}

// --- Filas -------------------------------------------------------------------

// Las dos filas viven en el MÓDULO y no dentro del panel. Definir un componente
// dentro del cuerpo de otro crea un tipo nuevo en cada render, y React responde
// desmontando y volviendo a montar todo el subárbol. Como la página se redibuja
// a 30 Hz (el poll de NT devuelve un objeto nuevo cada 33 ms), eso hacía dos
// cosas visibles: los iconos reiniciaban su cadena de respaldo y parpadeaban, y
// el `mousedown` caía en un botón mientras el `mouseup` caía en otro distinto,
// así que los clicks nunca llegaban a dispararse.

function CatalogueRow({ entry, installed, busy, onDownload }: {
  entry: CatalogEntry
  installed: boolean
  busy: string | null
  onDownload: (entry: CatalogEntry) => void
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <PanelIcon
        svg={entry.kind === "field" ? "field3d.svg" : "robot.svg"}
        svgFallback={entry.kind === "field" ? "visualizer2d.svg" : "part.svg"}
        fallback={entry.kind === "field" ? "ti-map-2" : "ti-robot"}
        size={13}
      />
      <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--text-primary)" }}>
        {entry.label}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>
        {formatBytes(entry.approxBytes)}
      </span>
      <button
        disabled={busy !== null || installed}
        onClick={() => onDownload(entry)}
        style={{
          flexShrink: 0, fontSize: 9.5, padding: "2px 7px", borderRadius: 2, minWidth: 58,
          cursor: busy !== null || installed ? "default" : "pointer",
          background: installed ? "transparent" : "var(--bg-input)",
          color: installed ? "var(--text-muted)" : "var(--text-primary)",
          border: `1px solid ${installed ? "transparent" : "var(--border-main)"}`,
          opacity: busy !== null && busy !== entry.key ? 0.4 : 1,
        }}
      >
        {installed ? "Installed" : busy === entry.key ? "Getting…" : "Download"}
      </button>
    </div>
  )
}

function PackRow({ pack, busy, onRemove }: {
  pack: AssetPack
  busy: string | null
  onRemove: (key: string) => void
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 0", borderBottom: "1px solid var(--border-light)",
      }}
    >
      <PanelIcon
        svg={pack.config.kind === "field" ? "field3d.svg" : "robot.svg"}
        svgFallback={pack.config.kind === "field" ? "visualizer2d.svg" : "part.svg"}
        fallback={pack.config.kind === "field" ? "ti-map-2" : "ti-robot"}
        size={14}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10.5, color: "var(--text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {pack.config.name}
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {pack.origin === "bundled" ? "Bundled" : formatBytes(pack.bytes)}
          {pack.config.kind === "field"
            && ` · ${pack.config.size.length.toFixed(2)} × ${pack.config.size.width.toFixed(2)} m`}
          {pack.config.kind === "robot" && pack.config.components.length > 0
            && ` · ${pack.config.components.length} moving parts`}
          {pack.config.kind === "robot" && pack.config.cameras.length > 0
            && ` · ${pack.config.cameras.length} cameras`}
        </div>
      </div>
      {pack.origin === "user" && (
        <button
          title="Remove from disk"
          disabled={busy !== null}
          onClick={() => onRemove(pack.key)}
          style={{
            border: "none", background: "transparent", cursor: "pointer",
            padding: 0, display: "flex", flexShrink: 0,
          }}
        >
          <PanelIcon svg="delete.svg" fallback="ti-trash" size={13} color="var(--text-muted)" />
        </button>
      )}
    </div>
  )
}

// El panel no mira ningún dato en vivo, así que no tiene por qué redibujarse
// con el poll de NT. `memo` lo deja quieto salvo que cambie la lista de
// paquetes, que es lo único que puede cambiar de afuera.
export default memo(Field3dAssetPanel)
