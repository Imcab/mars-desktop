import { invoke } from "@tauri-apps/api/core"
import {
  WorkspaceTab, ToolKind, DashboardWidget, FunctionSeriesConfig,
  SwerveSourceConfig, defaultSwerveSettings, SwerveSettings,
  Swerve3dSettings, defaultSwerve3dSettings, defaultSwerve3dModules, Swerve3dModulePlacement,
  FunctionSettings, defaultFunctionSettings,
  MechanismSourceConfig, defaultMechanismSettings, MechanismSettings,
  NTSessionSettings, defaultNTSessionSettings,
  EquationVariable, EquationConfig,
} from "./appStore"
import { normalizeFieldObjects, normalizeFieldSettings } from "../utils/field/fieldObjects"
import { normalizeField3dObjects, normalizeField3dSettings } from "../utils/field3d/objects"
import {
  normalizeParts as normalizeMechanism3dParts,
  normalizeSettings as normalizeMechanism3dSettings,
} from "../utils/mechanism/mechanism3d"
import { normalizeEntries as normalizeNTSessionEntries } from "../utils/nt/ntSession"
import { TimelineMarker } from "./markerStore"
import { SysIdConfig, normalizeSysIdConfig } from "./sysidStore"

// Sube SOLO si un layout viejo deja de poder migrarse con normalizeTab.
// Mientras los campos nuevos tengan default, no hace falta tocarlo.
const LAYOUT_VERSION = 1

const KNOWN_KINDS: ToolKind[] = [
  "visualizer", "field3d", "swerve", "swerve3d", "mechanism", "mechanism3d", "ntsession", "telemetry", "display", "functions", "equations",
]

export interface WorkspaceLayout {
  version: number
  openTabs: WorkspaceTab[]
  activeTabId: string | null
  /** Riel de solo iconos en vez del árbol completo. */
  sidebarCollapsed: boolean
  markers: TimelineMarker[]
  sysid: SysIdConfig
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

// Un layout guardado por una versión anterior no tiene los campos que se
// agregaron después (mechanismSources es el caso más reciente). Rellenar acá
// es lo que evita que agregar una herramienta nueva invalide los layouts que
// la gente ya tenía guardados.
function normalizeTab(raw: any): WorkspaceTab | null {
  if (!raw || typeof raw !== "object") return null
  if (!KNOWN_KINDS.includes(raw.kind)) return null
  if (typeof raw.id !== "string" || raw.id.length === 0) return null

  return {
    id: raw.id,
    kind: raw.kind as ToolKind,
    title: typeof raw.title === "string" ? raw.title : raw.kind,
    widgets: asArray<DashboardWidget>(raw.widgets),
    functionSeries: asArray<FunctionSeriesConfig>(raw.functionSeries),
    functionSettings: { ...defaultFunctionSettings, ...(raw.functionSettings as FunctionSettings) },
    // Los objetos y los ajustes de la cancha se dibujan directo como
    // geometría: un largo de chasis en NaN o un tipo de objeto inventado dejan
    // el visualizador en blanco sin ningun error visible.
    fieldObjects: normalizeFieldObjects(raw.fieldObjects),
    fieldSettings: normalizeFieldSettings(raw.fieldSettings),
    field3dObjects: normalizeField3dObjects(raw.field3dObjects),
    field3dSettings: normalizeField3dSettings(raw.field3dSettings),
    swerveSources: asArray<SwerveSourceConfig>(raw.swerveSources),
    swerveSettings: { ...defaultSwerveSettings, ...(raw.swerveSettings as SwerveSettings) },
    swerve3dSettings: normalizeSwerve3d(raw.swerve3dSettings),
    mechanismSources: asArray<MechanismSourceConfig>(raw.mechanismSources),
    mechanismSettings: { ...defaultMechanismSettings, ...(raw.mechanismSettings as MechanismSettings) },
    // El árbol de piezas del Mechanism 3D se dibuja directo como geometría: un
    // NaN o un enum inventado ahí deja la escena vacía sin ningún error
    // visible, así que se sanea con el mismo normalizador que usa el import.
    mechanism3dParts: normalizeMechanism3dParts(raw.mechanism3dParts),
    mechanism3dSettings: normalizeMechanism3dSettings(raw.mechanism3dSettings),
    ntSessionEntries: normalizeNTSessionEntries(raw.ntSessionEntries),
    ntSessionSettings: {
      ...defaultNTSessionSettings,
      ...(raw.ntSessionSettings as NTSessionSettings),
    },
    equationVars: asArray<EquationVariable>(raw.equationVars),
    equations: asArray<EquationConfig>(raw.equations),
  }
}

// Las cuatro posiciones de modulo son lo unico del layout que se dibuja
// directo como geometria: un NaN colado ahi (por editar el campo a mano y
// dejarlo vacio) deja las mallas en una matriz invalida y la escena entera
// desaparece sin error visible.
function normalizeSwerve3d(raw: any): Swerve3dSettings {
  const merged = { ...defaultSwerve3dSettings, ...(raw as Swerve3dSettings) }
  const modules = asArray<any>(raw?.modules)
    .slice(0, 4)
    .map((m, i): Swerve3dModulePlacement => ({
      x: finite(m?.x, defaultSwerve3dModules[i].x),
      y: finite(m?.y, defaultSwerve3dModules[i].y),
      z: finite(m?.z, defaultSwerve3dModules[i].z),
    }))

  return {
    ...merged,
    modules: modules.length === 4 ? modules : defaultSwerve3dModules,
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? value : fallback
}

export function normalizeLayout(raw: any): WorkspaceLayout | null {
  if (!raw || typeof raw !== "object") return null
  const openTabs = asArray<any>(raw.openTabs)
    .map(normalizeTab)
    .filter((t): t is WorkspaceTab => t !== null)

  // Un activeTabId que apunta a una pestaña que ya no existe dejaría la app
  // mostrando una pantalla vacía sin forma de volver.
  const activeTabId = openTabs.some(t => t.id === raw.activeTabId) ? raw.activeTabId : null

  return {
    version: LAYOUT_VERSION,
    openTabs,
    activeTabId,
    sidebarCollapsed: raw.sidebarCollapsed === true,
    markers: normalizeMarkers(raw.markers),
    sysid: normalizeSysIdConfig(raw.sysid),
  }
}

// Una marca con un tiempo inválido dibujaría una bandera en NaN píxeles y
// rompería el salto entre marcas.
function normalizeMarkers(raw: unknown): TimelineMarker[] {
  return asArray<any>(raw)
    .filter(m => m && typeof m.id === "string" && typeof m.timeUs === "number" && isFinite(m.timeUs))
    .map(m => ({
      id: m.id,
      timeUs: Math.round(m.timeUs),
      label: typeof m.label === "string" && m.label.length > 0 ? m.label : "Marker",
      color: typeof m.color === "string" ? m.color : "#d63b3b",
    }))
    .sort((a, b) => a.timeUs - b.timeUs)
}

/** `path` vacío = slot de autoguardado en la carpeta de config de MARS. */
export async function saveLayout(layout: Omit<WorkspaceLayout, "version">, path?: string): Promise<string> {
  return invoke<string>("save_workspace", {
    layout: { version: LAYOUT_VERSION, ...layout },
    path: path ?? null,
  })
}

export async function loadLayout(path?: string): Promise<WorkspaceLayout | null> {
  const raw = await invoke<any | null>("load_workspace", { path: path ?? null })
  return raw === null ? null : normalizeLayout(raw)
}
