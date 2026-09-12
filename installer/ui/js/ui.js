// Painting helpers. No framework: there are five screens.

export const $ = (id) => document.getElementById(id)

/** Creates an element with a class and text in one line. */
export function el(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

/**
 * A key/value table.
 *
 * `textContent` rather than innerHTML on purpose: what goes in here is paths and
 * release notes, which are text from elsewhere. A `<` in a note has no business
 * being able to break the screen.
 */
export function summary(container, rows) {
  container.replaceChildren()
  const box = el("div", "summary")
  for (const [k, v] of rows) {
    if (v === null || v === undefined || v === "") continue
    const row = el("div", "row")
    row.append(el("div", "k", k), el("div", "v", String(v)))
    box.appendChild(row)
  }
  container.appendChild(box)
}

export function notice(container, kind, text) {
  container.replaceChildren()
  if (!text) return
  container.appendChild(el("div", `${kind}-box`, text))
}

/** Shows exactly one screen of the wizard. */
export function showStep(id) {
  for (const s of document.querySelectorAll(".step")) {
    s.classList.toggle("active", s.id === `step-${id}`)
  }
  // Every screen starts at the top; otherwise it inherits the previous one's
  // scroll position and the heading is out of sight.
  document.querySelector(".body").scrollTop = 0
}

/** Configures the four footer buttons in one go. */
export function footer({ back, next, cancel, uninstall }) {
  const set = (button, options) => {
    if (!options) {
      button.style.display = "none"
      return
    }
    button.style.display = ""
    button.textContent = options.text ?? button.textContent
    button.disabled = !!options.disabled
    button.onclick = options.on ?? null
  }
  set($("btn-back"), back)
  set($("btn-next"), next)
  set($("btn-cancel"), cancel)
  set($("btn-uninstall"), uninstall)
}

export function log(text, className) {
  const box = $("log")
  box.appendChild(el("div", className, text))
  // It only auto-scrolls if it was already at the bottom: if somebody scrolled
  // up to read a warning, jumping to the end snatches it away from them.
  const pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  if (pinned) box.scrollTop = box.scrollHeight
}

export function progress(pct, phase) {
  $("bar-fill").style.width = `${pct}%`
  $("progress-pct").textContent = `${pct}%`
  if (phase) $("progress-phase").textContent = phase
}

/** Bytes into something readable at a glance. */
export function mb(bytes) {
  if (!bytes) return null
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function date(epochSeconds) {
  const n = Number(epochSeconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toLocaleString()
}
