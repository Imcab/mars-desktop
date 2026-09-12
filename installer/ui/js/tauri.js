// Bridge to Rust.
//
// The app is built with `withGlobalTauri`, so there are no `@tauri-apps/api`
// imports and no bundler: everything hangs off `window.__TAURI__`. Wrapping it
// here avoids repeating the long path at every call and leaves one place to
// look if the API changes shape.

const T = window.__TAURI__ ?? {}

export const invoke = (cmd, args) => {
  if (!T.core?.invoke) {
    return Promise.reject(new Error("The installer was opened outside its own window (no Tauri API)."))
  }
  return T.core.invoke(cmd, args)
}

export const listen = (event, fn) => T.event.listen(event, fn)

/** Native folder picker. Returns `null` if it was cancelled. */
export const pickFolder = async (initial) => {
  const r = await T.dialog.open({ directory: true, multiple: false, defaultPath: initial })
  return typeof r === "string" ? r : null
}

export const confirm = (message, title) =>
  T.dialog.confirm(message, { title, kind: "warning" })

export const close = () => T.window.getCurrentWindow().close()
