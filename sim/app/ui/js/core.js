// Lo que usa todo lo demás: hablar con el backend, construir nodos y guardar
// el estado de la sesión.
//
// La app no lleva bundler ni framework a propósito (ver app/README.md), así
// que "componente" aquí es una función que devuelve un HTMLElement. Es
// suficiente: las páginas se repintan enteras cuando su modelo cambia, y lo
// único que se refresca a 700 ms son tres campos de estado y los logs, que se
// actualizan por nodo y no por página.

// --- puente con el proceso de la app ------------------------------------

// `withGlobalTauri: true` en tauri.conf.json es lo que inyecta esto. Sin
// bundler no hay otra forma de llegar a los comandos.
export const tauriListo = Boolean(window.__TAURI__);
const rawInvoke = tauriListo ? window.__TAURI__.core.invoke : null;

/**
 * Llama a un comando del backend.
 *
 * Los comandos devuelven `Err(String)` y Tauri lo convierte en un reject con
 * un string: se re-lanza como Error para que un `catch` normal encuentre
 * `.message` donde lo espera.
 */
export async function invoke(cmd, args) {
  if (!rawInvoke) throw new Error("The app process is not reachable (withGlobalTauri is off).");
  try {
    return await rawInvoke(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e?.message ?? String(e));
  }
}

// --- estado de la sesión -------------------------------------------------

export const estado = {
  opciones: null,       // { mundos, robots, sim_dir, conda_dir, version }
  mundos: [],           // MundoInfo[]
  robots: [],           // RobotInfo[]
  campos: [],           // CampoInfo[]
  prefs: {},            // lo que se guarda en build/studio-prefs.json
  sim: null,            // último Estado del supervisor
  pagina: "launch",
  mundoAbierto: null,   // ruta relativa del mundo abierto en el editor
};

/** Recarga las bibliotecas de mundos y robots desde el disco. */
export async function recargarBibliotecas() {
  const [mundos, robots, campos] = await Promise.all([
    invoke("sim_mundos_detalle"),
    invoke("sim_robots_detalle"),
    invoke("sim_campos"),
  ]);
  estado.mundos = mundos;
  estado.robots = robots;
  estado.campos = campos;
}

/**
 * Guarda las preferencias. Se llama en cada cambio (son cuatro campos y un
 * archivo diminuto), pero se agrupan por si algo dispara varios seguidos.
 */
let pendiente = null;
export function guardarPrefs(cambios) {
  Object.assign(estado.prefs, cambios);
  clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    invoke("sim_guardar_prefs", { prefs: estado.prefs }).catch(() => {
      // Perder una preferencia no justifica interrumpir al usuario.
    });
  }, 180);
}

/**
 * Anota un mundo como recién usado, para la lista del portal de bienvenida.
 * Se guarda la ruta, no el objeto: el mundo puede haberse borrado entre
 * sesiones y la lista lo comprueba al pintarse.
 */
export function anotarReciente(ruta) {
  if (!ruta) return;
  const previos = (estado.prefs.recientes ?? []).filter((r) => r !== ruta);
  guardarPrefs({ recientes: [ruta, ...previos].slice(0, 6) });
}

// --- construcción de nodos ----------------------------------------------

/**
 * `el("div.panel", { onclick }, hijo, "texto")`.
 *
 * El selector admite `tag.clase.clase#id`. Las claves del objeto que empiezan
 * por `on` son listeners, `data` y `style` son objetos, y el resto son
 * atributos. Un valor `null`/`undefined`/`false` omite el atributo, que es lo
 * que permite escribir `disabled: cond` sin ramas.
 */
export function el(selector, props, ...hijos) {
  const [tagYClases, id] = selector.split("#");
  const partes = tagYClases.split(".");
  const nodo = document.createElement(partes[0] || "div");
  for (const c of partes.slice(1)) nodo.classList.add(c);
  if (id) nodo.id = id;

  // El segundo argumento es props solo si es un objeto plano. Sin esta
  // comprobacion, `el("span", 1)` trata el 1 como props, `Object.entries(1)`
  // no da nada y el numero desaparece: una fila que dice "Real-time factor"
  // con el valor en blanco, sin ningun error.
  const esProps =
    props !== null && props !== undefined &&
    typeof props === "object" && !props.nodeType && !Array.isArray(props);
  if (!esProps) {
    hijos.unshift(props);
    props = null;
  }

  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") nodo.addEventListener(k.slice(2), v);
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) nodo.dataset[dk] = dv;
    else if (k === "style") Object.assign(nodo.style, v);
    else if (k === "html") nodo.innerHTML = v;
    else if (k === "value") nodo.value = v;
    else if (k === "checked") nodo.checked = Boolean(v);
    else nodo.setAttribute(k, v === true ? "" : v);
  }

  agregar(nodo, hijos);
  return nodo;
}

function agregar(nodo, hijos) {
  for (const h of hijos.flat(4)) {
    if (h === null || h === undefined || h === false || h === true) continue;
    nodo.appendChild(h.nodeType ? h : document.createTextNode(String(h)));
  }
}

/** Vacía un nodo y le pone hijos nuevos. */
export function pintar(nodo, ...hijos) {
  nodo.replaceChildren();
  agregar(nodo, hijos);
  return nodo;
}

/** `<img>` de `ui/icons/`. Los iconos son los mismos SVG que mars-desktop. */
export function icono(nombre, tam = 14) {
  return el("img", { src: `icons/${nombre}`, alt: "", "aria-hidden": true, width: tam, height: tam, draggable: "false" });
}

// --- formato -------------------------------------------------------------

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function num(v, decimales = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(decimales).replace(/\.?0+$/, "") || "0";
}

export const grados = (rad) => (rad * 180) / Math.PI;
export const radianes = (deg) => (deg * Math.PI) / 180;

/** `[0.35, 0.35, 0.38]` (0..1, como en SDF) <-> `#5a5a61`. */
export function rgbAHex(c) {
  const b = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}
export function hexARgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Escapa texto que va a `innerHTML`. Los logs y los SDF traen `<` y `&`. */
export function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
