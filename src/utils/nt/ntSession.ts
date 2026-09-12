// Núcleo de la NT Session: qué forma tiene cada tipo, cómo se publica, y cómo
// se convierte en código Java listo para pegar.
//
// Todo acá es PURO. Es la parte que se equivoca en silencio — un ángulo que se
// publica en grados cuando el robot espera radianes, un `1` que Java lee como
// int en vez de double — y que conviene poder probar sin conexión ni UI.
//
// CONVENCIÓN DE ÁNGULOS: la UI y el Java copiado trabajan en GRADOS, porque es
// lo que uno tiene en la cabeza. Lo que sale por el cable va en RADIANES, que
// es lo que reciben los constructores de WPILib (`new Rotation2d(double)`,
// `ChassisSpeeds(..., omegaRadiansPerSecond)`). La conversión se hace una sola
// vez, acá.

import { NTSessionCopyMode, NTSessionEntry, NTSessionKind } from "../../store/appStore"

const DEG = Math.PI / 180

/**
 * Tabla bajo la que publica la sesión. Es fija a propósito: si fuera editable,
 * cambiarla dejaría huérfano todo lo ya publicado bajo la anterior, y el robot
 * tendría que adivinar en qué tabla buscar.
 */
export const NT_SESSION_ROOT = "MarsDesktop"

export interface ComponentSpec {
  label: string
  /** Sufijo mostrado en la UI. */
  suffix: string
  /** Se publica en radianes aunque se edite en grados. */
  angle?: boolean
}

export interface KindSpec {
  /** Tipo con el que se publica en NetworkTables. */
  ntType: string
  /** Nombre del struct de WPILib, si se publica como tal. */
  structName?: string
  /** Qué array del entry guarda el valor. */
  store: "numbers" | "booleans" | "strings"
  /** Componentes fijos (geometría) o null si el largo es libre (arrays). */
  components: ComponentSpec[] | null
  /** Tipo Java de la declaración. */
  javaType: string
  /** Import que hace falta para ese tipo, si no es primitivo. */
  javaImport?: string
}

export const NT_SESSION_KINDS: Record<NTSessionKind, KindSpec> = {
  double: { ntType: "double", store: "numbers", components: [{ label: "Value", suffix: "" }], javaType: "double" },
  int: { ntType: "int", store: "numbers", components: [{ label: "Value", suffix: "" }], javaType: "int" },
  boolean: { ntType: "boolean", store: "booleans", components: [{ label: "Value", suffix: "" }], javaType: "boolean" },
  string: { ntType: "string", store: "strings", components: [{ label: "Value", suffix: "" }], javaType: "String" },

  "double[]": { ntType: "double[]", store: "numbers", components: null, javaType: "double[]" },
  "boolean[]": { ntType: "boolean[]", store: "booleans", components: null, javaType: "boolean[]" },
  "string[]": { ntType: "string[]", store: "strings", components: null, javaType: "String[]" },

  Rotation2d: {
    ntType: "struct:Rotation2d", structName: "Rotation2d", store: "numbers", javaType: "Rotation2d",
    javaImport: "edu.wpi.first.math.geometry.Rotation2d",
    components: [{ label: "θ", suffix: "°", angle: true }],
  },
  Translation2d: {
    ntType: "struct:Translation2d", structName: "Translation2d", store: "numbers", javaType: "Translation2d",
    javaImport: "edu.wpi.first.math.geometry.Translation2d",
    components: [{ label: "X", suffix: "m" }, { label: "Y", suffix: "m" }],
  },
  Pose2d: {
    ntType: "struct:Pose2d", structName: "Pose2d", store: "numbers", javaType: "Pose2d",
    javaImport: "edu.wpi.first.math.geometry.Pose2d",
    components: [{ label: "X", suffix: "m" }, { label: "Y", suffix: "m" }, { label: "θ", suffix: "°", angle: true }],
  },
  Translation3d: {
    ntType: "struct:Translation3d", structName: "Translation3d", store: "numbers", javaType: "Translation3d",
    javaImport: "edu.wpi.first.math.geometry.Translation3d",
    components: [{ label: "X", suffix: "m" }, { label: "Y", suffix: "m" }, { label: "Z", suffix: "m" }],
  },
  Pose3d: {
    ntType: "struct:Pose3d", structName: "Pose3d", store: "numbers", javaType: "Pose3d",
    javaImport: "edu.wpi.first.math.geometry.Pose3d",
    components: [
      { label: "X", suffix: "m" }, { label: "Y", suffix: "m" }, { label: "Z", suffix: "m" },
      { label: "Roll", suffix: "°", angle: true },
      { label: "Pitch", suffix: "°", angle: true },
      { label: "Yaw", suffix: "°", angle: true },
    ],
  },
  ChassisSpeeds: {
    ntType: "struct:ChassisSpeeds", structName: "ChassisSpeeds", store: "numbers", javaType: "ChassisSpeeds",
    javaImport: "edu.wpi.first.math.kinematics.ChassisSpeeds",
    components: [
      { label: "vx", suffix: "m/s" }, { label: "vy", suffix: "m/s" },
      { label: "ω", suffix: "°/s", angle: true },
    ],
  },
}

export const NT_SESSION_KIND_ORDER: NTSessionKind[] = [
  "double", "int", "boolean", "string",
  "double[]", "boolean[]", "string[]",
  "Rotation2d", "Translation2d", "Pose2d", "Translation3d", "Pose3d", "ChassisSpeeds",
]

export function kindSpec(kind: NTSessionKind): KindSpec {
  return NT_SESSION_KINDS[kind] ?? NT_SESSION_KINDS.double
}

/** true si el tipo es una lista de largo libre (se pueden agregar elementos). */
export function isListKind(kind: NTSessionKind): boolean {
  return kindSpec(kind).components === null
}

// --- Nombres -------------------------------------------------------------------

/**
 * Ruta completa del topic. NT4 pide que empiece con "/", y la raíz se limpia
 * de barras sobrantes para que "MarsDesktop/" y "/MarsDesktop" den lo mismo.
 */
export function fullTopicName(root: string, key: string): string {
  const cleanRoot = root.replace(/^\/+|\/+$/g, "")
  const cleanKey = key.replace(/^\/+|\/+$/g, "")
  if (cleanRoot.length === 0) return `/${cleanKey}`
  return cleanKey.length === 0 ? `/${cleanRoot}` : `/${cleanRoot}/${cleanKey}`
}

/** La parte de un topic que va después de la raíz, o null si no cuelga de ella. */
export function keyFromTopicName(topicName: string, root = NT_SESSION_ROOT): string | null {
  const prefix = `/${root.replace(/^\/+|\/+$/g, "")}/`
  return topicName.startsWith(prefix) ? topicName.slice(prefix.length) : null
}

/**
 * Nombre de variable Java sugerido para una clave. "Arm/kP" -> "kP",
 * "drive speed" -> "driveSpeed". Nunca devuelve algo que empiece con dígito.
 */
export function suggestJavaName(key: string): string {
  const last = key.split("/").filter(Boolean).pop() ?? "value"
  const parts = last.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (parts.length === 0) return "value"

  const head = parts[0]
  const camel = head.charAt(0).toLowerCase() + head.slice(1)
    + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("")

  return /^[0-9]/.test(camel) ? `v${camel}` : camel
}

// --- Publicación ------------------------------------------------------------------

export interface PublishPayload {
  topicType: string
  /** Para un struct son los BYTES del struct, no sus componentes. */
  value: number | boolean | string | number[] | boolean[] | string[]
}

/**
 * Lo que hay que mandarle a `set_value` para este entry. Los ángulos se pasan
 * a radianes acá y en ningún otro lado.
 */
export function publishPayload(entry: NTSessionEntry): PublishPayload {
  const spec = kindSpec(entry.kind)

  if (spec.store === "booleans") {
    return entry.kind === "boolean"
      ? { topicType: "boolean", value: entry.booleans[0] ?? false }
      : { topicType: "boolean[]", value: [...entry.booleans] }
  }

  if (spec.store === "strings") {
    return entry.kind === "string"
      ? { topicType: "string", value: entry.strings[0] ?? "" }
      : { topicType: "string[]", value: [...entry.strings] }
  }

  if (entry.kind === "double") return { topicType: "double", value: entry.numbers[0] ?? 0 }
  if (entry.kind === "int") return { topicType: "int", value: Math.round(entry.numbers[0] ?? 0) }
  if (entry.kind === "double[]") return { topicType: "double[]", value: [...entry.numbers] }

  // Geometría: sale como un struct binario de WPILib, no como un arreglo de
  // números. Así el robot lo lee con `getStructTopic(name, Pose2d.struct)` en
  // vez de tener que rearmarlo componente por componente.
  return { topicType: spec.ntType, value: structBytes(entry.kind, entry.numbers) }
}

// --- Serialización de structs de WPILib ------------------------------------------
//
// El formato es una tirada de doubles little-endian, sin encabezado ni padding,
// en el orden en que WPILib declara los campos. Es exactamente el layout que la
// app ya usa para DECODIFICAR structs (ver STRUCT_DEFS en valueDecoding.ts); acá
// se recorre en el sentido contrario.

/**
 * Cuaternión de tres ángulos de Euler, en el mismo orden que
 * `new Rotation3d(roll, pitch, yaw)` de WPILib: R = Rz(yaw)·Ry(pitch)·Rx(roll).
 * Devuelve (w, x, y, z), que es el orden en que el struct los serializa.
 */
export function eulerToQuaternion(roll: number, pitch: number, yaw: number): [number, number, number, number] {
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2)
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2)

  return [
    cr * cp * cy + sr * sp * sy,   // w
    sr * cp * cy - cr * sp * sy,   // x
    cr * sp * cy + sr * cp * sy,   // y
    cr * cp * sy - sr * sp * cy,   // z
  ]
}

/** Los doubles que van al cable, en orden, ya en unidades de WPILib. */
export function structDoubles(kind: NTSessionKind, numbers: number[]): number[] {
  const at = (i: number) => numbers[i] ?? 0

  switch (kind) {
    case "Rotation2d": return [at(0) * DEG]
    case "Translation2d": return [at(0), at(1)]
    // Pose2d = Translation2d + Rotation2d, aplanado.
    case "Pose2d": return [at(0), at(1), at(2) * DEG]
    case "Translation3d": return [at(0), at(1), at(2)]
    case "Pose3d": {
      // Rotation3d serializa como cuaternión (w, x, y, z), no como roll/pitch/yaw.
      const [w, x, y, z] = eulerToQuaternion(at(3) * DEG, at(4) * DEG, at(5) * DEG)
      return [at(0), at(1), at(2), w, x, y, z]
    }
    case "ChassisSpeeds": return [at(0), at(1), at(2) * DEG]
    default: return []
  }
}

/** Los bytes del struct, listos para mandar por IPC como arreglo de números. */
export function structBytes(kind: NTSessionKind, numbers: number[]): number[] {
  const doubles = structDoubles(kind, numbers)
  const buffer = new ArrayBuffer(doubles.length * 8)
  const view = new DataView(buffer)
  // true = little endian, que es lo que fija el formato de struct de WPILib.
  doubles.forEach((value, i) => view.setFloat64(i * 8, value, true))
  return Array.from(new Uint8Array(buffer))
}

// --- Schemas ----------------------------------------------------------------------
//
// Un struct publicado sin su schema lo lee bien el robot (su clase Java ya sabe
// el layout) pero es opaco para cualquier consumidor dinámico — AdvantageScope,
// o la propia Dashboard de MARS ante un tipo que no tenga en su tabla. Los
// schemas son los mismos strings que publica WPILib.

const STRUCT_SCHEMAS: Record<string, string> = {
  Rotation2d: "double value",
  Translation2d: "double x;double y",
  Pose2d: "Translation2d translation;Rotation2d rotation",
  Translation3d: "double x;double y;double z",
  Quaternion: "double w;double x;double y;double z",
  Rotation3d: "Quaternion q",
  Pose3d: "Translation3d translation;Rotation3d rotation",
  ChassisSpeeds: "double vx;double vy;double omega",
}

/** De qué otros structs depende cada uno, para publicarlos también. */
const STRUCT_DEPENDENCIES: Record<string, string[]> = {
  Pose2d: ["Translation2d", "Rotation2d"],
  Rotation3d: ["Quaternion"],
  Pose3d: ["Translation3d", "Rotation3d"],
}

export interface SchemaPublication {
  /** Nombre completo del topic, tal cual lo espera NT4. */
  topicName: string
  topicType: string
  /** El texto del schema, ya en bytes. */
  value: number[]
}

/**
 * Los schemas que hay que publicar para que un struct sea legible por un
 * cliente que no lo conozca de antes, incluyendo los anidados y sin repetir.
 */
export function schemaPublications(structName: string): SchemaPublication[] {
  const pending = [structName]
  const seen = new Set<string>()
  const out: SchemaPublication[] = []

  while (pending.length > 0) {
    const name = pending.shift()!
    if (seen.has(name)) continue
    seen.add(name)

    const schema = STRUCT_SCHEMAS[name]
    if (schema === undefined) continue

    out.push({
      topicName: `/.schema/struct:${name}`,
      topicType: "structschema",
      value: Array.from(new TextEncoder().encode(schema)),
    })
    pending.push(...(STRUCT_DEPENDENCIES[name] ?? []))
  }

  return out
}

/** Todos los schemas que necesita un juego de entries, sin repetir. */
export function schemasForEntries(entries: NTSessionEntry[]): SchemaPublication[] {
  const seen = new Set<string>()
  const out: SchemaPublication[] = []

  entries.forEach(entry => {
    const structName = kindSpec(entry.kind).structName
    if (!structName) return
    schemaPublications(structName).forEach(publication => {
      if (seen.has(publication.topicName)) return
      seen.add(publication.topicName)
      out.push(publication)
    })
  })

  return out
}

// --- Java ---------------------------------------------------------------------------

/**
 * Java infiere `int` de un literal sin punto, así que `double x = 1` compila
 * pero `double[] a = {1}` no. Siempre se emite el punto para los double.
 */
export function javaNumber(value: number, integer = false): string {
  if (!isFinite(value)) return integer ? "0" : "0.0"
  if (integer) return String(Math.round(value))

  // toFixed(6) mata el ruido binario (0.30000000000000004) sin recortar
  // precisión útil; Number() vuelve a sacar los ceros que sobran.
  const trimmed = Number(value.toFixed(6)).toString()
  return /[.eE]/.test(trimmed) ? trimmed : `${trimmed}.0`
}

function javaString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Un ángulo editado en grados, escrito como radianes en el Java. */
function javaRadians(degrees: number): string {
  return `Math.toRadians(${javaNumber(degrees)})`
}

/** El valor solo, sin `Tipo nombre =` ni punto y coma. */
export function javaValueLiteral(entry: NTSessionEntry): string {
  const spec = kindSpec(entry.kind)
  const n = (i: number) => javaNumber(entry.numbers[i] ?? 0)

  switch (entry.kind) {
    case "double": return javaNumber(entry.numbers[0] ?? 0)
    case "int": return javaNumber(entry.numbers[0] ?? 0, true)
    case "boolean": return String(entry.booleans[0] ?? false)
    case "string": return javaString(entry.strings[0] ?? "")

    case "double[]": return `{ ${entry.numbers.map(v => javaNumber(v)).join(", ")} }`
    case "boolean[]": return `{ ${entry.booleans.map(String).join(", ")} }`
    case "string[]": return `{ ${entry.strings.map(javaString).join(", ")} }`

    case "Rotation2d": return `Rotation2d.fromDegrees(${javaNumber(entry.numbers[0] ?? 0)})`
    case "Translation2d": return `new Translation2d(${n(0)}, ${n(1)})`
    case "Pose2d":
      return `new Pose2d(${n(0)}, ${n(1)}, Rotation2d.fromDegrees(${javaNumber(entry.numbers[2] ?? 0)}))`
    case "Translation3d": return `new Translation3d(${n(0)}, ${n(1)}, ${n(2)})`
    case "Pose3d":
      return `new Pose3d(${n(0)}, ${n(1)}, ${n(2)}, new Rotation3d(`
        + `${javaRadians(entry.numbers[3] ?? 0)}, ${javaRadians(entry.numbers[4] ?? 0)}, ${javaRadians(entry.numbers[5] ?? 0)}))`
    case "ChassisSpeeds":
      return `new ChassisSpeeds(${n(0)}, ${n(1)}, ${javaRadians(entry.numbers[2] ?? 0)})`

    default: return spec.javaType
  }
}

/** `double kA = 0.3;` */
export function javaDeclaration(entry: NTSessionEntry): string {
  const spec = kindSpec(entry.kind)
  const name = entry.javaName || suggestJavaName(entry.key)
  const literal = javaValueLiteral(entry)

  // Los arreglos necesitan `new tipo[] { ... }` fuera de una declaración, pero
  // dentro alcanza con las llaves.
  return `${spec.javaType} ${name} = ${literal};`
}

/**
 * Lectura desde NetworkTables con el valor actual como default. Para la
 * geometría hacen falta dos líneas: NT no tiene un getter de Pose2d, así que
 * se lee el `double[]` y se reconstruye.
 */
export function javaGetter(entry: NTSessionEntry, root: string): string {
  const spec = kindSpec(entry.kind)
  const name = entry.javaName || suggestJavaName(entry.key)
  const cleanRoot = root.replace(/^\/+|\/+$/g, "")
  const cleanKey = entry.key.replace(/^\/+|\/+$/g, "")
  const table = `NetworkTableInstance.getDefault().getTable(${javaString(cleanRoot)}).getEntry(${javaString(cleanKey)})`

  switch (entry.kind) {
    case "double": return `double ${name} = ${table}.getDouble(${javaNumber(entry.numbers[0] ?? 0)});`
    case "int": return `int ${name} = (int) ${table}.getInteger(${javaNumber(entry.numbers[0] ?? 0, true)});`
    case "boolean": return `boolean ${name} = ${table}.getBoolean(${entry.booleans[0] ?? false});`
    case "string": return `String ${name} = ${table}.getString(${javaString(entry.strings[0] ?? "")});`

    case "double[]":
      return `double[] ${name} = ${table}.getDoubleArray(new double[] ${javaValueLiteral(entry)});`
    case "boolean[]":
      return `boolean[] ${name} = ${table}.getBooleanArray(new boolean[] ${javaValueLiteral(entry)});`
    case "string[]":
      return `String[] ${name} = ${table}.getStringArray(new String[] ${javaValueLiteral(entry)});`

    default: {
      // Geometría: se publica como struct, así que del lado del robot se lee
      // con un StructSubscriber tipado y no hay nada que rearmar a mano.
      const topic = javaString(fullTopicName(root, entry.key))
      const type = spec.javaType
      const subscribe = `NetworkTableInstance.getDefault().getStructTopic(${topic}, ${type}.struct)`
        + `.subscribe(${javaValueLiteral(entry)})`
      return `StructSubscriber<${type}> ${name}Sub = ${subscribe};\n${type} ${name} = ${name}Sub.get();`
    }
  }
}

/** El texto que va al portapapeles para un entry, según el modo elegido. */
export function javaSnippet(entry: NTSessionEntry, mode: NTSessionCopyMode, root: string): string {
  const body = mode === "value" ? javaValueLiteral(entry)
    : mode === "getter" ? javaGetter(entry, root)
    : javaDeclaration(entry)

  // La nota va como comentario, salvo en modo "value": ahí lo que se copia se
  // pega en medio de una expresión y un // rompería la línea.
  return entry.note.trim().length > 0 && mode !== "value"
    ? `// ${entry.note.trim()}\n${body}`
    : body
}

/**
 * Todos los entries juntos, con los imports que hagan falta arriba. Es lo que
 * se pega de una en un archivo de constantes.
 */
export function javaBlock(entries: NTSessionEntry[], mode: NTSessionCopyMode, root: string): string {
  if (entries.length === 0) return ""

  const imports = new Set<string>()
  entries.forEach(entry => {
    const spec = kindSpec(entry.kind)
    if (spec.javaImport) imports.add(spec.javaImport)
    // Un Pose2d se construye con un Rotation2d, así que arrastra su import.
    if (entry.kind === "Pose2d") imports.add("edu.wpi.first.math.geometry.Rotation2d")
    if (entry.kind === "Pose3d") imports.add("edu.wpi.first.math.geometry.Rotation3d")
  })
  if (mode === "getter") {
    imports.add("edu.wpi.first.networktables.NetworkTableInstance")
    // Los structs se leen con un subscriber tipado, que es otro import.
    if (entries.some(entry => kindSpec(entry.kind).structName)) {
      imports.add("edu.wpi.first.networktables.StructSubscriber")
    }
  }

  const header = [...imports].sort().map(i => `import ${i};`).join("\n")
  const body = entries.map(entry => javaSnippet(entry, mode, root)).join("\n")
  return header.length > 0 ? `${header}\n\n${body}` : body
}

// --- Creación y normalización ----------------------------------------------------

/** Entry nuevo, ya con la cantidad de componentes que su tipo necesita. */
export function makeEntry(id: string, key: string, kind: NTSessionKind): NTSessionEntry {
  return {
    id,
    key,
    kind,
    javaName: suggestJavaName(key),
    ...emptyValues(kind),
    min: 0,
    max: 1,
    step: 0.01,
    useSlider: kind === "double",
    note: "",
  }
}

function emptyValues(kind: NTSessionKind): Pick<NTSessionEntry, "numbers" | "booleans" | "strings"> {
  const spec = kindSpec(kind)
  const length = spec.components?.length ?? 1
  return {
    numbers: spec.store === "numbers" ? new Array(length).fill(0) : [],
    booleans: spec.store === "booleans" ? new Array(length).fill(false) : [],
    strings: spec.store === "strings" ? new Array(length).fill("") : [],
  }
}

/**
 * Ajusta los valores de un entry al cambiar de tipo, conservando lo que se
 * pueda: pasar de Translation2d a Pose2d no debería borrar la X y la Y que ya
 * estaban puestas.
 */
export function changeKind(entry: NTSessionEntry, kind: NTSessionKind): NTSessionEntry {
  const spec = kindSpec(kind)
  const length = spec.components?.length ?? Math.max(1, entry[spec.store].length)
  const empty = emptyValues(kind)

  const keep = <T,>(previous: T[], blank: T[]): T[] =>
    blank.map((fallback, i) => (previous[i] !== undefined ? previous[i] : fallback))

  return {
    ...entry,
    kind,
    numbers: spec.store === "numbers" ? keep(entry.numbers, new Array(length).fill(0)) : [],
    booleans: spec.store === "booleans" ? keep(entry.booleans, new Array(length).fill(false)) : [],
    strings: spec.store === "strings" ? keep(entry.strings, new Array(length).fill("")) : [],
    useSlider: spec.components !== null && spec.store === "numbers" ? entry.useSlider : false,
    ...(spec.store === "numbers" ? {} : { numbers: empty.numbers }),
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? value : fallback
}

export function normalizeEntry(raw: any): NTSessionEntry | null {
  if (!raw || typeof raw !== "object") return null
  if (typeof raw.id !== "string" || raw.id.length === 0) return null

  const kind: NTSessionKind = NT_SESSION_KIND_ORDER.includes(raw.kind) ? raw.kind : "double"
  const key = typeof raw.key === "string" ? raw.key : "value"
  const base = makeEntry(raw.id, key, kind)

  return {
    ...base,
    javaName: typeof raw.javaName === "string" && raw.javaName.length > 0 ? raw.javaName : base.javaName,
    numbers: Array.isArray(raw.numbers) ? raw.numbers.map((v: unknown) => num(v, 0)) : base.numbers,
    booleans: Array.isArray(raw.booleans) ? raw.booleans.map((v: unknown) => v === true) : base.booleans,
    strings: Array.isArray(raw.strings) ? raw.strings.map((v: unknown) => typeof v === "string" ? v : "") : base.strings,
    min: num(raw.min, base.min),
    max: num(raw.max, base.max),
    // Un step de 0 deja el slider clavado y el input sin poder cambiar nada.
    step: Math.abs(num(raw.step, base.step)) || base.step,
    useSlider: raw.useSlider === true,
    note: typeof raw.note === "string" ? raw.note : "",
  }
}

export function normalizeEntries(raw: unknown): NTSessionEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()

  return raw
    .map(normalizeEntry)
    .filter((entry): entry is NTSessionEntry => {
      if (entry === null || seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
}
