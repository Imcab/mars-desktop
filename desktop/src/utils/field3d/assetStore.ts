// Catálogo de assets 3D instalados y las tres formas de instalar uno.
//
// Hay dos orígenes y la escena los trata igual:
//
//   - `bundled`: carpetas dentro de `public/fields3d/`. Viajan con la app y se
//     sirven por URL. Dejar ahí un `config.json` + `model.glb` alcanza para
//     que aparezcan; el glob los recoge en el build sin tocar código, igual
//     que las canchas 2D de `public/fields/`.
//
//   - `user`: carpetas del almacén en disco (%APPDATA%/MARS/assets3d), que se
//     leen con `read_binary_file`. Es donde caen los paquetes que el usuario
//     descarga o importa, y lo que permite tener la cancha de 20 MB sin
//     meterla en el repo.
//
// Las tres formas de instalar, todas resueltas en Rust:
//   1. Descargar del catálogo oficial de AdvantageScope.
//   2. Elegir un .zip que el usuario ya bajó.
//   3. Elegir una carpeta ya extraída, incluida la `userAssets` de
//      AdvantageScope, que tiene exactamente el mismo formato.

import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { AssetConfig, FieldAssetConfig, RobotAssetConfig, parseAssetConfig } from "./assetConfig"

/** Cómo se le pide al loader el contenido de un archivo del paquete. */
export type AssetSource =
  | { kind: "url"; url: string }
  | { kind: "path"; path: string }

export interface AssetPack {
  /** Clave estable con la que el layout referencia al asset. */
  key: string
  origin: "bundled" | "user"
  config: AssetConfig
  /** Nombres de los .glb, ya ordenados: model.glb, model_0.glb, model_1.glb... */
  models: string[]
  bytes: number
  /** Dónde vive; solo para mostrarlo en el panel. */
  location: string
}

export interface FieldPack extends AssetPack { config: FieldAssetConfig }
export interface RobotPack extends AssetPack { config: RobotAssetConfig }

export function isFieldPack(pack: AssetPack): pack is FieldPack {
  return pack.config.kind === "field"
}

export function isRobotPack(pack: AssetPack): pack is RobotPack {
  return pack.config.kind === "robot"
}

/** Cómo pedirle al loader el modelo `index` de un paquete (0 = model.glb). */
export function modelSource(pack: AssetPack, index: number): AssetSource | null {
  const file = pack.models[index]
  if (file === undefined) return null
  return pack.origin === "bundled"
    ? { kind: "url", url: `/fields3d/${pack.key}/${file}` }
    : { kind: "path", path: `${pack.location}/${file}` }
}

/** Clave estable de una fuente, para cachear el modelo ya parseado. */
export function sourceKey(source: AssetSource): string {
  return source.kind === "url" ? source.url : source.path
}

// --- Paquetes que viajan con la app ------------------------------------------

// Igual que las canchas 2D: dejar `public/fields3d/<Carpeta>/config.json` (con
// su `model.glb` al lado) alcanza para que la cancha aparezca en el selector.
const BUNDLED_CONFIGS = import.meta.glob("../../../public/fields3d/*/config.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>

function bundledPacks(): AssetPack[] {
  return Object.entries(BUNDLED_CONFIGS)
    .map(([path, text]): AssetPack | null => {
      const key = path.split("/").slice(-2)[0]
      const config = parseAssetConfig(text)
      if (config === null) return null
      // Un paquete bundled no se puede inspeccionar en disco desde el front,
      // así que se asume el nombre canónico: model.glb más los model_N.glb que
      // pidan las piezas de juego declaradas en el config.
      const extra = config.kind === "field" ? config.gamePieces.length : 0
      return {
        key,
        origin: "bundled",
        config,
        models: ["model.glb", ...Array.from({ length: extra }, (_, i) => `model_${i}.glb`)],
        bytes: 0,
        location: `/fields3d/${key}`,
      }
    })
    .filter((p): p is AssetPack => p !== null)
}

// --- Paquetes instalados en disco --------------------------------------------

interface RawPack {
  folder: string
  path: string
  config: string
  models: string[]
  bytes: number
}

async function userPacks(): Promise<AssetPack[]> {
  const raw = await invoke<RawPack[]>("list_asset3d_packs")
  return raw
    .map((entry): AssetPack | null => {
      const config = parseAssetConfig(entry.config)
      if (config === null) return null
      return {
        key: entry.folder,
        origin: "user",
        config,
        models: entry.models,
        bytes: entry.bytes,
        location: entry.path,
      }
    })
    .filter((p): p is AssetPack => p !== null)
}

/**
 * Todos los paquetes disponibles, los de la app primero.
 *
 * Si dos comparten clave gana el instalado por el usuario: es el que acaba de
 * poner a propósito, y sobreescribir una cancha que vino con la app por una
 * versión corregida es exactamente el caso de uso.
 */
export async function listAssetPacks(): Promise<AssetPack[]> {
  const user = await userPacks()
  const userKeys = new Set(user.map(p => p.key))
  return [...bundledPacks().filter(p => !userKeys.has(p.key)), ...user]
    .sort((a, b) => a.config.name.localeCompare(b.config.name))
}

export function assetStoreDir(): Promise<string> {
  return invoke<string>("asset3d_store_dir")
}

export function deleteAssetPack(key: string): Promise<void> {
  return invoke("delete_asset3d_pack", { folder: key })
}

// --- Instalación --------------------------------------------------------------

// Descargar y descomprimir viven en RUST (`src-tauri/src/assets3d.rs`), no acá.
// No es una preferencia de estilo: GitHub no manda cabeceras CORS en las
// descargas de sus releases, así que un `fetch` desde el webview falla siempre
// con "Failed to fetch" por más que la CSP esté abierta. De paso, los ~20 MB
// del paquete no cruzan el IPC.

/** Abre el dialog para elegir un .zip ya descargado y lo instala. */
export async function installAssetZipFromDisk(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    title: "Select an asset .zip",
    filters: [{ name: "Asset archive", extensions: ["zip"] }],
  })
  if (typeof picked !== "string") return null
  return invoke<string>("install_asset3d_zip", { path: picked })
}

/** Copia una carpeta ya extraída al almacén. */
export async function importAssetFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Select an asset folder (the one with config.json)",
  })
  if (typeof picked !== "string") return null
  return invoke<string>("import_asset3d_folder", { source: picked })
}

// --- Catálogo oficial ---------------------------------------------------------

export interface CatalogEntry {
  /** Nombre del .zip en la release, sin extensión; es también la carpeta. */
  key: string
  label: string
  kind: "field" | "robot"
  url: string
  /** Tamaño aproximado, para avisar antes de bajar 20 MB. */
  approxBytes: number
}

const ASSETS_RELEASE =
  "https://github.com/Mechanical-Advantage/AdvantageScopeAssets/releases/download/default-assets-v2"

/**
 * Los paquetes oficiales de AdvantageScope, que son los mismos modelos que usa
 * esa app: es la única fuente pública de la cancha en glTF ya convertida y
 * medida. Se descargan bajo demanda y no se meten en el repo porque una sola
 * cancha pesa más que todo el resto del proyecto junto.
 *
 * Los assets son de Littleton Robotics (FRC 6328) y su licencia permite la
 * redistribución conservando el aviso de copyright — ver ASSET_LICENSE_NOTE.
 */
export const ASSET_CATALOG: CatalogEntry[] = [
  { key: "Field3d_2026FRCFieldV1", label: "2026 Field (Rebuilt)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2026FRCFieldV1.zip`, approxBytes: 4_871_831 },
  { key: "Field3d_2025FRCFieldWeldedV2", label: "2025 Field (welded)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2025FRCFieldWeldedV2.zip`, approxBytes: 9_000_000 },
  { key: "Field3d_2025FRCFieldAndyMarkV2", label: "2025 Field (AndyMark)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2025FRCFieldAndyMarkV2.zip`, approxBytes: 9_000_000 },
  { key: "Field3d_2024FRCFieldV3", label: "2024 Field (Crescendo)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2024FRCFieldV3.zip`, approxBytes: 8_000_000 },
  { key: "Field3d_2023FRCFieldV4", label: "2023 Field (Charged Up)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2023FRCFieldV4.zip`, approxBytes: 7_000_000 },
  { key: "Field3d_2022FRCFieldV3", label: "2022 Field (Rapid React)", kind: "field", url: `${ASSETS_RELEASE}/Field3d_2022FRCFieldV3.zip`, approxBytes: 7_000_000 },
  { key: "Robot_2026FRCKitBotV1", label: "2026 KitBot", kind: "robot", url: `${ASSETS_RELEASE}/Robot_2026FRCKitBotV1.zip`, approxBytes: 2_000_000 },
  { key: "Robot_2025FRCKitBotV2", label: "2025 KitBot", kind: "robot", url: `${ASSETS_RELEASE}/Robot_2025FRCKitBotV2.zip`, approxBytes: 2_000_000 },
  { key: "Robot_CrabBotV3", label: "CrabBot (swerve demo)", kind: "robot", url: `${ASSETS_RELEASE}/Robot_CrabBotV3.zip`, approxBytes: 2_000_000 },
]

export const ASSET_LICENSE_NOTE =
  "3D field and robot models © 2021-2026 Littleton Robotics (FRC 6328). " +
  "Redistributed under the AdvantageScopeAssets BSD-3-Clause licence."

/** Descarga un paquete del catálogo y lo instala. */
export function downloadAsset(entry: CatalogEntry): Promise<string> {
  return invoke<string>("download_asset3d", { url: entry.url, fallbackName: entry.key })
}
