// Carga y optimización de los .glb de un asset 3D.
//
// A diferencia de `utils/field/robotModel.ts` — que carga el modelo suelto que
// el usuario elige para el Swerve 3D y le aplica un giro fijo — acá el giro lo
// dicta el `config.json` del paquete, así que el modelo se carga CRUDO y la
// escena lo orienta después.
//
// El trabajo grande de este módulo es la OPTIMIZACIÓN, y sigue el mismo camino
// que AdvantageScope porque su resultado es el que se ve bien:
//
//  1. El color del material se hornea en un atributo de VÉRTICE. Eso permite
//     fusionar mallas que NO comparten material, que es lo que lleva la cancha
//     2026 de casi tres mil mallas a tres. Fusionar por material dejaba 28 y,
//     peor, obligaba a conservar los materiales PBR originales.
//
//  2. Todo se dibuja con `MeshPhongMaterial`, no con `MeshStandardMaterial`.
//     Un material PBR con `metalness` alto y SIN mapa de entorno se renderiza
//     negro, que es exactamente cómo se veía la cancha antes: el modelo oficial
//     declara metales por todos lados. Phong no tiene ese problema y encima es
//     más barato.
//
//  3. Las piezas más chicas que un umbral se descartan. Es lo que distingue de
//     verdad los tres modos de calidad: en la cancha 2026 son miles de tornillos
//     y remaches que no aportan nada a cinco metros de distancia.
//
// La geometría se separa en tres grupos porque se sombrean distinto: la
// ALFOMBRA recibe sombras y no las proyecta, lo TRANSPARENTE (vidrios,
// policarbonato) va al 20 % sin escribir profundidad, y el resto proyecta.

import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh,
  MeshPhongMaterial, Object3D,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { invoke } from "@tauri-apps/api/core"
import { AssetSource, sourceKey } from "./assetStore"

/**
 * Cómo optimizar y sombrear un modelo. Sale del modo de calidad de la escena,
 * así que cambiar de modo obliga a volver a optimizar (y por eso entra en la
 * clave de la caché).
 */
export interface OptimizeOptions {
  /** Las piezas con radio menor a esto se descartan, en metros. */
  maxRadius: number
  /** Brillo especular. Negro = mate, que es como se ve fuera de cinematográfico. */
  specular: number
  shininess: number
  /** Marca las mallas para que proyecten y reciban sombra. */
  shadows: boolean
}

/** Los tres presets, con los mismos umbrales que usa AdvantageScope. */
export const OPTIMIZE_PRESETS: Record<"lowPower" | "standard" | "cinematic", OptimizeOptions> = {
  lowPower: { maxRadius: 0.08, specular: 0x000000, shininess: 0, shadows: false },
  standard: { maxRadius: 0.04, specular: 0x000000, shininess: 0, shadows: false },
  cinematic: { maxRadius: 0.02, specular: 0x666666, shininess: 100, shadows: true },
}

export interface LoadedAsset {
  /** Raíz ya optimizada, SIN rotar: la escena aplica los giros del config. */
  root: Group
  /**
   * Nodos que quedaron sin fusionar porque el config los nombra (las piezas de
   * juego ya colocadas). La escena los prende y apaga por nombre.
   */
  named: Map<string, Object3D[]>
  /** Triángulos que quedaron después de descartar las piezas chicas. */
  triangles: number
  /** Mallas que se dibujan por frame. */
  drawCalls: number
  /** Cuántas piezas se descartaron por ser demasiado chicas. */
  culled: number
}

async function readBytes(source: AssetSource): Promise<ArrayBuffer> {
  if (source.kind === "url") {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`Could not load ${source.url} (HTTP ${response.status}).`)
    return response.arrayBuffer()
  }

  // Un archivo elegido en disco no es servible por URL, así que los bytes se
  // piden al backend y se le pasan ya leídos al loader.
  const raw = await invoke<ArrayBuffer | number[]>("read_binary_file", { path: source.path })
  if (raw instanceof ArrayBuffer) return raw
  if (ArrayBuffer.isView(raw)) return (raw as ArrayBufferView).buffer as ArrayBuffer
  return new Uint8Array(raw as number[]).buffer
}

function parseGltf(buffer: ArrayBuffer): Promise<Group> {
  return new Promise((resolve, reject) => {
    // La ruta base va vacía a propósito: un .gltf que apunte a .bin o texturas
    // sueltas no se puede resolver desde acá, y es preferible que falle con el
    // mensaje del loader a que cargue a medias y se vea mal sin explicación.
    new GLTFLoader().parse(
      buffer, "",
      gltf => resolve(gltf.scene),
      error => reject(new Error(String((error as any)?.message ?? error))),
    )
  })
}

function countTriangles(geometry: BufferGeometry): number {
  const index = geometry.getIndex()
  if (index) return index.count / 3
  const position = geometry.getAttribute("position")
  return position ? position.count / 3 : 0
}

/** En qué grupo cae una malla; cada uno se sombrea distinto. */
type Bucket = "normal" | "transparent" | "carpet"

function bucketOf(mesh: Mesh, material: any): Bucket {
  // La alfombra se reconoce por el NOMBRE porque geométricamente es un plano
  // más entre miles; es el exportador del asset el que la marca.
  if (mesh.name.toLowerCase().includes("carpet")) return "carpet"
  // Un material apenas translúcido (una calcomanía) no es un vidrio: solo se
  // manda al grupo transparente lo que de verdad se ve a través.
  if (material?.transparent === true && material.opacity < 0.75) return "transparent"
  return "normal"
}

/**
 * Prepara la geometría para fusionarse: en coordenadas de mundo, con solo
 * posición y normal, y con el color del material horneado por vértice.
 *
 * Ese horneado es la clave de todo: con el color en los vértices, dos mallas
 * de materiales distintos se pueden fusionar en una sola sin perder su color,
 * y la cancha entera cabe en tres draw calls.
 */
function bakeGeometry(mesh: Mesh, material: any): BufferGeometry | null {
  const source = mesh.geometry
  const position = source?.getAttribute("position")
  const normal = source?.getAttribute("normal")
  // Sin normales no hay con qué iluminarla, y fusionarla con las que sí las
  // tienen rompe la fusión entera.
  if (!position || !normal) return null

  const baked = new BufferGeometry()
  baked.setAttribute("position", position.clone())
  baked.setAttribute("normal", normal.clone())

  const index = source.getIndex()
  // Todas las entradas de una fusión tienen que coincidir en si están indexadas
  // o no; `mergeGeometries` devuelve null en cuanto una se sale de la norma. Se
  // normaliza a INDEXADA porque el camino contrario (`toNonIndexed`) duplica
  // cada vértice compartido y multiplica la memoria de la cancha.
  //
  // El índice se arma como TypedArray y no como array de JS: la cancha 2026
  // son millones de índices, y pasarlos por un array común cuesta casi el doble
  // de tiempo de carga.
  baked.setIndex(index
    ? new BufferAttribute((index.array as any).slice(), 1)
    : new BufferAttribute(new Uint32Array(position.count).map((_, i) => i), 1))

  const color: Color | undefined = material?.color
  if (color) {
    // Uint8 normalizado: una cancha son millones de vértices, y guardar el
    // color en floats costaría cuatro veces más memoria para un color plano.
    const count = position.count
    const colors = new Uint8Array(count * 3)
    const r = Math.round(color.r * 255)
    const g = Math.round(color.g * 255)
    const b = Math.round(color.b * 255)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
    }
    baked.setAttribute("color", new BufferAttribute(colors, 3, true))
  }

  // `applyMatrix4` ya usa la inversa traspuesta para las normales, así que el
  // suavizado que traía el exportador sobrevive a la transformación.
  mesh.updateWorldMatrix(true, false)
  baked.applyMatrix4(mesh.matrixWorld)

  return baked
}

/**
 * Prepara un nodo para colgarlo de la raíz nueva conservando dónde estaba.
 *
 * Sacar un nodo de su padre le quita todas las transformaciones de sus
 * ancestros, que en un glTF de CAD son la mitad de la colocación de la pieza:
 * sin hornear la matriz de mundo en su transformación local, las piezas de
 * juego reaparecen amontonadas en el centro de la cancha.
 *
 * `source` es de dónde se toma esa matriz; se separa de `node` para poder
 * hornearla sobre una COPIA, que no tiene padre y por lo tanto tampoco matriz
 * de mundo propia.
 */
function detach(node: Object3D, source: Object3D = node): Object3D {
  source.updateWorldMatrix(true, false)
  node.matrix.copy(source.matrixWorld)
  node.matrix.decompose(node.position, node.quaternion, node.scale)
  return node
}

/**
 * Pasa los materiales de un subárbol a Phong.
 *
 * Los nodos nombrados no se fusionan, así que conservan los materiales del
 * archivo. Si se dejaran como `MeshStandardMaterial`, las piezas de juego se
 * verían negras (metalness sin entorno) justo al lado de una cancha que sí se
 * ve bien.
 */
function toPhong(root: Object3D, options: OptimizeOptions) {
  const convert = (original: any): MeshPhongMaterial => {
    const phong = new MeshPhongMaterial({
      color: original?.color?.clone() ?? new Color(0xcfd2d8),
      side: DoubleSide,
      specular: new Color(options.specular),
      shininess: options.shininess,
      transparent: original?.transparent === true,
      opacity: original?.opacity ?? 1,
    })
    original?.dispose?.()
    return phong
  }

  root.traverse(node => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material)
    mesh.castShadow = options.shadows
    mesh.receiveShadow = options.shadows
  })
}

function makeMaterial(bucket: Bucket, options: OptimizeOptions): MeshPhongMaterial {
  return new MeshPhongMaterial({
    vertexColors: true,
    side: DoubleSide,
    specular: new Color(options.specular),
    // La alfombra siempre va mate: un brillo especular sobre ella se lee como
    // un charco y confunde más de lo que ayuda.
    shininess: bucket === "carpet" ? 0 : options.shininess,
    // Sin `depthWrite: false` los vidrios se tapan entre sí y la cancha aparece
    // con agujeros según desde dónde se la mire.
    ...(bucket === "transparent"
      ? { transparent: true, opacity: 0.2, depthWrite: false }
      : {}),
  })
}

function optimize(
  scene: Object3D,
  keepNamed: Set<string>,
  options: OptimizeOptions,
): LoadedAsset {
  scene.updateMatrixWorld(true)

  const buckets: Record<Bucket, BufferGeometry[]> = { normal: [], transparent: [], carpet: [] }
  const named = new Map<string, Object3D[]>()
  const loose: Object3D[] = []
  let triangles = 0
  let culled = 0

  // Un nodo nombrado se saca ENTERO con sus hijos: una pieza de juego suele ser
  // un grupo de varias mallas, y fusionar la mitad la dejaría partida.
  const claimed = new Set<Object3D>()
  if (keepNamed.size > 0) {
    scene.traverse(node => {
      if (!keepNamed.has(node.name)) return
      // Si un ancestro ya se llevó este nodo, no se vuelve a tomar.
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (claimed.has(parent)) return
      }
      claimed.add(node)
    })
  }

  const walk = (node: Object3D) => {
    if (claimed.has(node)) {
      const list = named.get(node.name) ?? []
      list.push(node)
      named.set(node.name, list)
      loose.push(detach(node))
      node.traverse(child => {
        const mesh = child as Mesh
        if (mesh.isMesh && mesh.geometry) triangles += countTriangles(mesh.geometry)
      })
      return
    }

    const mesh = node as Mesh
    if (mesh.isMesh && mesh.geometry) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const baked = bakeGeometry(mesh, material)
      if (baked) {
        // El radio de la esfera envolvente decide si la pieza sobrevive. Se usa
        // `computeBoundingSphere` en vez de recorrer los vértices a mano porque
        // hace la misma cuenta sin crear un Vector3 por vértice, y acá se pasa
        // por millones de ellos.
        baked.computeBoundingSphere()
        const radius = baked.boundingSphere?.radius ?? Infinity
        if (radius < options.maxRadius) {
          baked.dispose()
          culled++
          return
        }
        triangles += countTriangles(baked)
        buckets[bucketOf(mesh, material)].push(baked)
        return
      }
      loose.push(detach(mesh.clone(), mesh))
      return
    }

    node.children.forEach(walk)
  }
  scene.children.forEach(walk)

  const root = new Group()
  root.name = "asset"
  let drawCalls = 0

  ;(Object.keys(buckets) as Bucket[]).forEach(bucket => {
    const geometries = buckets[bucket]
    if (geometries.length === 0) return

    const merged = geometries.length === 1
      ? geometries[0]
      : BufferGeometryUtils.mergeGeometries(geometries, false)
    if (!merged) {
      // La fusión puede fallar si dos geometrías siguen sin coincidir en
      // atributos; ahí se dibujan sueltas, que es correcto aunque cueste más.
      geometries.forEach(geometry => {
        root.add(new Mesh(geometry, makeMaterial(bucket, options)))
        drawCalls++
      })
      return
    }
    if (geometries.length > 1) geometries.forEach(g => g.dispose())

    const mesh = new Mesh(merged, makeMaterial(bucket, options))
    mesh.name = bucket
    // La alfombra RECIBE la sombra del robot; el resto la proyecta. Que la
    // cancha se proyecte sombra sobre sí misma cuesta una pasada entera sobre
    // millones de triángulos para ganar el borde de una pared contra otra.
    mesh.castShadow = options.shadows && bucket !== "carpet"
    mesh.receiveShadow = options.shadows && bucket === "carpet"
    root.add(mesh)
    drawCalls++
  })

  loose.forEach(node => {
    toPhong(node, options)
    root.add(node)
    node.traverse(child => { if ((child as Mesh).isMesh) drawCalls++ })
  })

  return { root, named, triangles: Math.round(triangles), drawCalls, culled }
}

// Un modelo de cancha son 18 MB y optimizarlo tarda; sin caché, cambiar de
// pestaña volvería a leer el disco y a rehacer la fusión cada vez.
const cache = new Map<string, Promise<LoadedAsset>>()

/**
 * Carga (y cachea) un modelo del paquete.
 *
 * `keepNamed` son los nodos que la fusión no debe tocar. La caché incluye ese
 * conjunto y las opciones de optimización en la clave: el mismo archivo pedido
 * con otro modo de calidad es un resultado distinto.
 */
export function loadAssetModel(
  source: AssetSource,
  keepNamed: string[] = [],
  options: OptimizeOptions = OPTIMIZE_PRESETS.standard,
): Promise<LoadedAsset> {
  const key = [
    sourceKey(source),
    options.maxRadius, options.specular, options.shininess, options.shadows,
    keepNamed.slice().sort().join(","),
  ].join("#")

  const hit = cache.get(key)
  if (hit) return hit

  const pending = readBytes(source)
    .then(parseGltf)
    .then(scene => optimize(scene, new Set(keepNamed), options))
    // Si falla se saca de la caché: si no, corregir el archivo y volver a
    // pedirlo devolvería el mismo error para siempre.
    .catch(error => {
      cache.delete(key)
      throw error
    })

  cache.set(key, pending)
  return pending
}

/**
 * Copia independiente con materiales propios.
 *
 * La escena les cambia color y opacidad (el fantasma, el resaltado de la
 * alianza) y sin clonarlos eso pisaría el original que comparten las demás
 * instancias. La GEOMETRÍA sí se comparte: es lo pesado y nadie la muta.
 */
export function instantiateAsset(asset: LoadedAsset): Group {
  const clone = asset.root.clone(true)
  clone.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(m => m.clone())
      : mesh.material.clone()
  })
  // La marca viaja con la instancia para que quien la descarte no tenga que
  // acordarse de que su geometría es prestada. Olvidarlo una sola vez deja la
  // cancha (o el robot) en negro para TODAS las demás copias y para la próxima
  // vez que se abra la pestaña, porque lo liberado es lo que hay en la caché.
  clone.userData.sharedGeometry = true
  return clone
}

/** Libera los materiales de una instancia que se descarta (la geometría no). */
export function disposeAssetInstance(object: Object3D) {
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
    else mesh.material?.dispose()
  })
}

/**
 * Libera un árbol entero respetando lo prestado: las instancias de asset solo
 * sueltan sus materiales, todo lo demás suelta también su geometría.
 *
 * Es la única forma correcta de descartar un objeto de la escena, porque casi
 * todos mezclan las dos cosas — un robot es una instancia del asset más las
 * mallas propias de su etiqueta y su estela.
 */
export function disposeSceneTree(object: Object3D) {
  const walk = (node: Object3D) => {
    if (node.userData.sharedGeometry === true) {
      disposeAssetInstance(node)
      return
    }
    const mesh = node as Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const material = mesh.material as any
      if (Array.isArray(material)) material.forEach((m: any) => m?.dispose())
      else material?.dispose()
    }
    node.children.slice().forEach(walk)
  }
  walk(object)
}
