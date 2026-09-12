// Utilidades de pintado. Nada de framework: son cinco pantallas.

export const $ = (id) => document.getElementById(id)

/** Crea un elemento con clase y texto en una línea. */
export function el(tag, clase, texto) {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto !== undefined) n.textContent = texto
  return n
}

/**
 * Tabla de pares clave/valor.
 *
 * `textContent` en vez de innerHTML a propósito: acá entran rutas y notas de
 * release, que son texto de afuera. Un `<` en una nota no tiene por qué poder
 * romper la pantalla.
 */
export function resumen(contenedor, filas) {
  contenedor.replaceChildren()
  const caja = el("div", "resumen")
  for (const [k, v] of filas) {
    if (v === null || v === undefined || v === "") continue
    const fila = el("div", "fila")
    fila.append(el("div", "k", k), el("div", "v", String(v)))
    caja.appendChild(fila)
  }
  contenedor.appendChild(caja)
}

export function caja(contenedor, tipo, texto) {
  contenedor.replaceChildren()
  if (!texto) return
  contenedor.appendChild(el("div", `${tipo}-caja`, texto))
}

/** Muestra una sola pantalla del asistente. */
export function mostrarPaso(id) {
  for (const s of document.querySelectorAll(".paso")) {
    s.classList.toggle("activo", s.id === `paso-${id}`)
  }
  // Cada pantalla empieza desde arriba; si no, se hereda el scroll de la
  // anterior y el título queda fuera de vista.
  document.querySelector(".cuerpo").scrollTop = 0
}

/** Configura los cuatro botones del pie de una sola vez. */
export function pie({ atras, siguiente, cancelar, desinstalar }) {
  const cfg = (boton, opciones) => {
    if (!opciones) {
      boton.style.display = "none"
      return
    }
    boton.style.display = ""
    boton.textContent = opciones.texto ?? boton.textContent
    boton.disabled = !!opciones.deshabilitado
    boton.onclick = opciones.al ?? null
  }
  cfg($("btn-atras"), atras)
  cfg($("btn-siguiente"), siguiente)
  cfg($("btn-cancelar"), cancelar)
  cfg($("btn-desinstalar"), desinstalar)
}

export function bitacora(texto, clase) {
  const caja = $("bitacora")
  const linea = el("div", clase, texto)
  caja.appendChild(linea)
  // Solo se autodesplaza si ya estaba abajo: si alguien subió a leer un aviso,
  // saltar al final le arrebata la lectura.
  const pegado = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40
  if (pegado) caja.scrollTop = caja.scrollHeight
}

export function progreso(pct, fase) {
  $("barra-relleno").style.width = `${pct}%`
  $("progreso-pct").textContent = `${pct}%`
  if (fase) $("progreso-fase").textContent = fase
}

/** Bytes a algo que se pueda leer de un vistazo. */
export function mb(bytes) {
  if (!bytes) return null
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function fecha(epochSegundos) {
  const n = Number(epochSegundos)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toLocaleString()
}
