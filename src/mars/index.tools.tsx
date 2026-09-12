// Edición TOOLS: la app sin el framework MARS.
//
// Pensada para equipos que quieren el dashboard —NetworkTables, visualizadores,
// gráficas, SysId— sin adoptar MARS. No es un interruptor que esconde botones:
// este módulo reemplaza a `index.tsx` vía el alias `@mars` de vite.config.ts,
// así que las páginas de proyecto, paquetes, manifiesto, wizard, features,
// subsistemas y watchdog NO ENTRAN AL BUNDLE. Tampoco su código Rust, que
// queda fuera por la feature `mars` de Cargo.
//
// Las listas vacías son a propósito: los grupos del sidebar y las secciones de
// menú que se quedan sin entradas no se pintan.

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
