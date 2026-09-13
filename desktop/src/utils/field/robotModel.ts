// Carga de modelos 3D (.stl / .glb / .gltf) para las vistas Swerve 3D y
// Mechanism 3D.
//
// El archivo lo elige el usuario con el dialog nativo, así que llega como una
// RUTA de disco, no como una URL servible: los loaders de three no pueden
// buscarlo solos. Por eso los bytes se piden al backend (`read_binary_file`)
// y se le pasan ya parseados al loader.
//
// Toda la escena se arma con Z arriba (X adelante, Y a la izquierda), que es
// el marco de WPILib. Un .glb viene con Y arriba por convención de glTF, así
// que al cargarlo se le aplica un giro de +90° en X para llevarlo a este
// marco; los .stl de CAD ya suelen venir con Z arriba.

import { Box3, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, Material } from "three"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

export type ModelFormat = "stl" | "gltf"

/**
 * Dónde queda el origen del modelo, que es el punto sobre el que rota.
 *
 * - `origin`: el origen del archivo, sin tocar. Es lo correcto para piezas
 *   exportadas de CAD con el eje del joint en el (0,0,0).
 * - `center`: el centro de su bounding box.
 * - `base`: centrado en XY y apoyado en z = 0 (un robot sobre el piso).
 */
export type ModelAnchor = "origin" | "center" | "base"

export interface LoadedModel {
  /** Modelo ya rotado al marco Z-arriba, SIN recentrar. */
  holder: Group
  format: ModelFormat
  /** Tamaño del bounding box, en unidades del archivo. */
  size: Vector3
  /** Centro del bounding box, en unidades del archivo. */
  center: Vector3
  /** Z más bajo del bounding box, para el anclaje `base`. */
  minZ: number
  /** Cantidad de triángulos, para avisar si el modelo es demasiado pesado. */
  triangles: number
}

export const MODEL_EXTENSIONS = ["stl", "glb", "gltf"]

/** Gris neutro para los .stl, que no traen color alguno. */
export const DEFAULT_MODEL_COLOR = "#8f9299"

// Un modelo puede pesar decenas de MB y parsearse tarda; sin caché, cada
// cambio de pestaña volvería a leer el disco y a construir la malla.
const cache = new Map<string, Promise<LoadedModel>>()

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase()
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Abre el dialog nativo filtrado a los formatos que las vistas saben leer. */
export async function pickModelFile(title = "Select a 3D model"): Promise<string | null> {
  const picked = await open({
    multiple: false,
    title,
    filters: [{ name: "3D model (STL / glTF)", extensions: MODEL_EXTENSIONS }],
  })
  return typeof picked === "string" ? picked : null
}

/** Igual que `pickModelFile` pero admitiendo varios archivos de una vez. */
export async function pickModelFiles(title = "Add 3D models"): Promise<string[]> {
  const picked = await open({
    multiple: true,
    title,
    filters: [{ name: "3D model (STL / glTF)", extensions: MODEL_EXTENSIONS }],
  })
  if (Array.isArray(picked)) return picked.filter((p): p is string => typeof p === "string")
  return typeof picked === "string" ? [picked] : []
}

export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  const raw = await invoke<ArrayBuffer | number[]>("read_binary_file", { path })
  // El comando devuelve `ipc::Response`, que llega como ArrayBuffer. Un
  // fallback a array de números cuesta nada y evita quedar atado a ese detalle.
  if (raw instanceof ArrayBuffer) return raw
  if (ArrayBuffer.isView(raw)) return (raw as ArrayBufferView).buffer as ArrayBuffer
  return new Uint8Array(raw as number[]).buffer
}

function parseGltf(buffer: ArrayBuffer): Promise<Object3D> {
  return new Promise((resolve, reject) => {
    // El segundo argumento es la ruta base para los recursos externos. Se
    // manda vacía a propósito: un .gltf que apunte a .bin/texturas sueltas no
    // se puede resolver desde acá, y es preferible que falle con el mensaje
    // del loader a que cargue a medias.
    new GLTFLoader().parse(
      buffer, "",
      gltf => resolve(gltf.scene),
      error => reject(new Error(String((error as any)?.message ?? error))),
    )
  })
}

function countTriangles(object: Object3D): number {
  let total = 0
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const index = mesh.geometry.getIndex()
    const position = mesh.geometry.getAttribute("position")
    if (index) total += index.count / 3
    else if (position) total += position.count / 3
  })
  return Math.round(total)
}

async function buildModel(path: string): Promise<LoadedModel> {
  const extension = extensionOf(path)
  if (!MODEL_EXTENSIONS.includes(extension)) {
    throw new Error(`Unsupported model format ".${extension}". Use .stl, .glb or .gltf.`)
  }

  const buffer = await readFileBytes(path)

  let object: Object3D
  let format: ModelFormat
  if (extension === "stl") {
    const geometry = new STLLoader().parse(buffer)
    geometry.computeVertexNormals()
    object = new Mesh(geometry, new MeshStandardMaterial({
      color: DEFAULT_MODEL_COLOR, metalness: 0.15, roughness: 0.65,
    }))
    format = "stl"
  } else {
    object = await parseGltf(buffer)
    // glTF define Y arriba; la escena trabaja con Z arriba.
    object.rotation.x = Math.PI / 2
    format = "gltf"
  }

  const holder = new Group()
  holder.name = "model"
  holder.add(object)
  holder.updateMatrixWorld(true)

  // La caja se mide DESPUÉS de la rotación al marco Z-arriba: es la que usan
  // el auto-fit y los anclajes, y tiene que estar en el mismo marco en que se
  // va a colocar la pieza.
  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())

  if (!isFinite(size.x) || size.x <= 0) {
    throw new Error("The model has no geometry (empty bounding box).")
  }

  return { holder, format, size, center, minZ: box.min.z, triangles: countTriangles(object) }
}

export function loadModel(path: string): Promise<LoadedModel> {
  const hit = cache.get(path)
  if (hit) return hit

  // Si la carga falla se saca de la caché: si no, corregir el archivo y
  // volver a elegirlo devolvería el mismo error para siempre.
  const pending = buildModel(path).catch(error => {
    cache.delete(path)
    throw error
  })
  cache.set(path, pending)
  return pending
}

/**
 * Copia independiente del modelo cacheado, con materiales propios: la escena
 * les cambia color y opacidad, y sin clonarlos eso pisaría el original que
 * comparten las demás pestañas.
 *
 * El desplazamiento del anclaje se aplica al hijo y no al grupo devuelto, para
 * que quien llama pueda usar libremente `position`/`scale` del grupo sin que
 * el anclaje se le escale encima.
 */
export function instantiateModel(model: LoadedModel, anchor: ModelAnchor = "base"): Group {
  const clone = model.holder.clone(true)
  clone.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(m => m.clone())
      : mesh.material.clone()
  })

  const inner = clone.children[0]
  if (inner) {
    const { center, minZ } = model
    if (anchor === "center") inner.position.set(-center.x, -center.y, -center.z)
    else if (anchor === "base") inner.position.set(-center.x, -center.y, -minZ)
    else inner.position.set(0, 0, 0)
  }

  return clone
}

/** Devuelve los materiales de una instancia, para poder mutarlos en bloque. */
export function materialsOf(object: Object3D): Material[] {
  const out: Material[] = []
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) out.push(...mesh.material)
    else if (mesh.material) out.push(mesh.material)
  })
  return out
}

/** Libera los materiales de una instancia que se va a descartar. */
export function disposeInstance(object: Object3D) {
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    // La geometría es COMPARTIDA con el modelo cacheado (clone() no la copia),
    // así que solo se descartan los materiales, que sí son propios.
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
    else mesh.material?.dispose()
  })
}
