// Puente con Rust.
//
// La app se construye con `withGlobalTauri`, así que no hay imports de
// `@tauri-apps/api` ni bundler: todo cuelga de `window.__TAURI__`. Envolverlo
// acá evita repetir la ruta larga en cada llamada y deja un solo lugar donde
// mirar si la API cambia de forma.

const T = window.__TAURI__ ?? {}

export const invoke = (cmd, args) => {
  if (!T.core?.invoke) {
    return Promise.reject(new Error("El instalador se abrió fuera de su ventana (no hay API de Tauri)."))
  }
  return T.core.invoke(cmd, args)
}

export const escuchar = (evento, fn) => T.event.listen(evento, fn)

/** Diálogo nativo de carpeta. Devuelve `null` si lo cancelaron. */
export const elegirCarpeta = async (inicial) => {
  const r = await T.dialog.open({ directory: true, multiple: false, defaultPath: inicial })
  return typeof r === "string" ? r : null
}

export const confirmar = (mensaje, titulo) =>
  T.dialog.confirm(mensaje, { title: titulo, kind: "warning" })

export const cerrar = () => T.window.getCurrentWindow().close()
