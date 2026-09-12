// Versión de MARS Desktop.
//
// Fuente única: de acá sale la que muestra la pantalla de carga (vite la
// inyecta en index.html al construir, ver el plugin `marsVersion` de
// vite.config.ts) y la que use cualquier pantalla de "About" más adelante.
// Si se toca, hay que tocar también package.json, src-tauri/Cargo.toml y
// src-tauri/tauri.conf.json: esos tres los lee el instalador, no el bundle.
//
// `scripts/sync-version.mjs` verifica que los cuatro coincidan, y el workflow
// de release lo corre antes de empaquetar: una versión desalineada rompe el
// build en vez de llegar a una release publicada.
//
// Este archivo lo importa vite.config.ts, que corre en Node: no puede depender
// de nada del bundle. La edición compilada vive en `edition.ts`.

export const MARS_VERSION = "1.1.3"

/** Como se escribe en pantalla. */
export const MARS_VERSION_LABEL = `v${MARS_VERSION}`
