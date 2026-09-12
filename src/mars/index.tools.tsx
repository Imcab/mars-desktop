// The TOOLS edition: the app without the MARS framework.
//
// Meant for teams who want the dashboard — NetworkTables, visualisers, plots,
// SysId — without adopting MARS. This is not a switch that hides buttons: this
// module replaces `index.tsx` through the `@mars` alias in vite.config.ts, so
// the project, packages, manifest, wizard, features, subsystems and watchdog
// pages NEVER REACH THE BUNDLE. Neither does their Rust code, which is left out
// by cargo's `mars` feature.
//
// The empty lists are deliberate: sidebar groups and menu sections that end up
// with no entries are not painted at all.

import type { MarsNavItem, MarsPageContext, MarsSurface } from "./types"
import type { Page } from "../store/appStore"

export const MARS_ENABLED = false
export const HAS_SIM_STUDIO = false

export const PROJECT_ITEMS: readonly MarsNavItem[] = []
export const MODULE_ITEMS: readonly MarsNavItem[] = []
export const CONFIG_ITEMS: readonly MarsNavItem[] = []

export function renderMarsPage(_page: Page, _ctx: MarsPageContext) {
  return null
}

const _surface: MarsSurface = { MARS_ENABLED, HAS_SIM_STUDIO, PROJECT_ITEMS, MODULE_ITEMS, CONFIG_ITEMS, renderMarsPage }
void _surface
