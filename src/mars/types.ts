// The contract between the app and the block of features that depend on the
// MARS framework.
//
// It lives apart from the two implementations (`index.tsx` and
// `index.tools.tsx`) because the TYPES are common to both editions: what
// changes is what gets imported, not what shape it has.
//
// See `src/mars/README.md` for why this split exists.

import type { ReactNode } from "react"
import type { ConnectionState, LogSource, Page, TopicAnnounce } from "../store/appStore"

/** Pages that only exist when the MARS framework is present. */
export type MarsPage =
  | "creator"
  | "packages"
  | "variables"
  | "manifest"
  | "wizard"
  | "feature"
  | "subsystems"
  | "watchdog"

/** Everything any of the MARS pages needs in order to render. */
export interface MarsPageContext {
  projectName: string | null
  projectPath: string | null
  topics: Map<string, TopicAnnounce>
  connection: ConnectionState
  logSource: LogSource | null
}

/** One sidebar/menu entry contributed by the complete edition. */
export interface MarsNavItem {
  /** File in public/icons. */
  svg: string
  /** Tabler fallback while the SVG does not exist. */
  icon: string
  label: string
  page: Page
  /** Description for the welcome screen's list. */
  desc: string
}

/**
 * The surface each edition implements. The Tools one returns empty lists and
 * `null`; the bundler then drops everything that was only reachable from here.
 */
export interface MarsSurface {
  /** `false` in the Tools edition. It is a module constant, not a runtime flag. */
  MARS_ENABLED: boolean
  /** The sidebar's "Project" group and the File menu. */
  PROJECT_ITEMS: readonly MarsNavItem[]
  /** The "Modules" group (tables that read from the MARS project). */
  MODULE_ITEMS: readonly MarsNavItem[]
  /** The MARS entries of the "Config" group (subsystem status, watchdog). */
  CONFIG_ITEMS: readonly MarsNavItem[]
  /** `true` if this edition knows how to launch MARS Simulation Studio. */
  HAS_SIM_STUDIO: boolean
  /** Returns the page if it is a MARS page; `null` if it is not its turn. */
  renderMarsPage: (page: Page, ctx: MarsPageContext) => ReactNode | null
}
