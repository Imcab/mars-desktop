// Contrato entre la app y el bloque de funciones que dependen del framework
// MARS. Vive aparte de las dos implementaciones (`index.tsx` y
// `index.tools.tsx`) porque los TIPOS sí son comunes a las dos ediciones: lo
// que cambia es qué se importa, no qué forma tiene.
//
// Ver `src/mars/README.md` para por qué existe esta división.

import type { ReactNode } from "react"
import type { ConnectionState, LogSource, Page, TopicAnnounce } from "../store/appStore"

/** Páginas que solo existen si el framework MARS está presente. */
export type MarsPage =
  | "creator"
  | "packages"
  | "variables"
  | "manifest"
  | "wizard"
  | "feature"
  | "subsystems"
  | "watchdog"

/** Todo lo que necesita cualquiera de las páginas MARS para pintarse. */
export interface MarsPageContext {
  projectName: string | null
  projectPath: string | null
  topics: Map<string, TopicAnnounce>
  connection: ConnectionState
  logSource: LogSource | null
}

/** Una entrada de menú/sidebar aportada por la edición completa. */
export interface MarsNavItem {
  /** Archivo en public/icons. */
  svg: string
  /** Respaldo tabler mientras el SVG no exista. */
  icon: string
  label: string
  page: Page
  /** Descripción para la lista de la pantalla de inicio. */
  desc: string
}

/**
 * Superficie que cada edición implementa. La de tools devuelve listas vacías y
 * `null`; el bundler se lleva por delante todo lo que solo se alcanzaba desde
 * aquí.
 */
export interface MarsSurface {
  /** `false` en la edición Tools. Es una constante de módulo, no un flag de runtime. */
  MARS_ENABLED: boolean
  /** Grupo "Project" del sidebar y el menú File. */
  PROJECT_ITEMS: readonly MarsNavItem[]
  /** Grupo "Modules" (tablas que leen del proyecto MARS). */
  MODULE_ITEMS: readonly MarsNavItem[]
  /** Entradas MARS del grupo "Config" (estado de subsistemas, watchdog). */
  CONFIG_ITEMS: readonly MarsNavItem[]
  /** `true` si esta edición sabe lanzar MARS Simulation Studio. */
  HAS_SIM_STUDIO: boolean
  /** Devuelve la página si es una página MARS; `null` si no le toca. */
  renderMarsPage: (page: Page, ctx: MarsPageContext) => ReactNode | null
}
