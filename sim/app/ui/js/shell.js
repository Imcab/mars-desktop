// El marco de la ventana: barra de menú, sidebar, cabecera de página y barra
// de estado. Es el equivalente de App.tsx + MenuBar + Sidebar + StatusBar de
// mars-desktop, con el mismo reparto de responsabilidades.

import { MSS_VERSION } from "./constants.js";
import { el, estado, guardarPrefs, icono, invoke, pintar, recargarBibliotecas } from "./core.js";
import { abrirAyuda, cerrarAyuda } from "./help.js";
import { aviso, boton } from "./ui.js";

import { paginaLaunch } from "./pages/launch.js";
import { paginaConsole } from "./pages/console.js";
import { paginaDiagnostics } from "./pages/diagnostics.js";
import { paginaWorlds } from "./pages/worlds.js";
import { paginaEditor } from "./pages/editor.js";
import { paginaFields } from "./pages/fields.js";
import { paginaRobots } from "./pages/robots.js";
import { paginaGuide } from "./pages/guide.js";
import { paginaProtocol } from "./pages/protocol.js";
import { paginaHelp } from "./pages/helptopics.js";
import { paginaAbout } from "./pages/about.js";
import { abrirBienvenida } from "./welcome.js";
import { nuevoMundo, importarMundo } from "./pages/worlds.js";

// --- registro de páginas -------------------------------------------------

// El orden de este objeto ES el orden del sidebar. Los grupos se dibujan en el
// orden en que aparecen por primera vez.
export const PAGINAS = {
  launch: { grupo: "Simulation", titulo: "Launch", svg: "play.svg", pagina: paginaLaunch },
  console: { grupo: "Simulation", titulo: "Console", svg: "console.svg", pagina: paginaConsole },
  diagnostics: { grupo: "Simulation", titulo: "Diagnostics", svg: "watchdog.svg", pagina: paginaDiagnostics },

  worlds: { grupo: "World", titulo: "World Library", svg: "scene.svg", pagina: paginaWorlds },
  editor: { grupo: "World", titulo: "World Editor", svg: "grid.svg", pagina: paginaEditor },
  fields: { grupo: "World", titulo: "Field Library", svg: "field3d.svg", pagina: paginaFields },

  robots: { grupo: "Robot", titulo: "Robot Library", svg: "robot.svg", pagina: paginaRobots },
  guide: { grupo: "Robot", titulo: "Import Guide", svg: "import-model.svg", pagina: paginaGuide },

  protocol: { grupo: "Reference", titulo: "Protocol", svg: "network.svg", pagina: paginaProtocol },
  help: { grupo: "Reference", titulo: "Help Topics", svg: "help.svg", pagina: paginaHelp },
  about: { grupo: "Reference", titulo: "About", svg: "samples.svg", pagina: paginaAbout },
};

const ICONO_GRUPO = { Simulation: "play.svg", World: "scene.svg", Robot: "robot.svg", Reference: "packages.svg" };

// --- nodos vivos ---------------------------------------------------------

const nodos = {};

/** Repinta la página actual. Se llama tras cualquier cambio en el disco. */
export function refrescarPagina() {
  navegar(estado.pagina, estado.params, true);
}

/**
 * Cambia de página. `params` viaja al render de la página (el editor lo usa
 * para saber qué mundo abrir).
 */
export function navegar(id, params = null, silencioso = false) {
  if (!PAGINAS[id]) return;
  cerrarAyuda();
  estado.pagina = id;
  estado.params = params;
  if (!silencioso) guardarPrefs({ ultimaPagina: id });

  pintarSidebar();

  let vista;
  try {
    vista = PAGINAS[id].pagina(params);
  } catch (e) {
    console.error(e);
    vista = { titulo: PAGINAS[id].titulo, cuerpo: aviso(`This page failed to render: ${e.message}`) };
  }

  pintar(
    nodos.header,
    el("span.title", vista.titulo ?? PAGINAS[id].titulo),
    vista.meta ? el("span.meta", vista.meta) : null,
    el("span.actions", ...(vista.acciones ?? []), vista.help ? botonAyudaGrande(vista.help) : null)
  );
  pintar(nodos.page, vista.cuerpo);
  // Las páginas que muestran datos vivos (estado de procesos, logs) devuelven
  // un `tick`. El bucle de sondeo llama solo al de la página montada: sondear
  // para una página que ya no se ve es trabajo tirado.
  estado.tick = vista.tick ?? null;
  nodos.page.scrollTop = 0;
  nodos.page.className = vista.ancho === "narrow" ? "page page-narrow" : "page";
}

function botonAyudaGrande(id) {
  return boton("Help", { svg: "help.svg", sm: true, onclick: (e) => abrirAyuda(id, e.currentTarget ?? e.target) });
}

// --- barra de menú -------------------------------------------------------

const MENUS = () => [
  [
    "File",
    [
      ["New world…", () => nuevoMundo()],
      ["Import world…", () => importarMundo()],
      ["separator"],
      ["Reveal sim folder", () => invoke("sim_revelar", { ruta: "worlds" }).catch(reportar)],
      ["Reload libraries", async () => { await recargarBibliotecas(); refrescarPagina(); }],
      ["separator"],
      ["Exit", () => window.close()],
    ],
  ],
  [
    "Simulation",
    [
      ["Launch panel", () => navegar("launch")],
      ["Console", () => navegar("console")],
      ["Diagnostics", () => navegar("diagnostics")],
      ["separator"],
      ["Stop simulation", () => invoke("sim_detener").catch(reportar), () => !estado.sim?.corriendo],
    ],
  ],
  [
    "World",
    [
      ["World Library", () => navegar("worlds")],
      ["World Editor", () => navegar("editor", { ruta: estado.mundoAbierto })],
      ["Field Library", () => navegar("fields")],
      ["separator"],
      ["New world…", () => nuevoMundo()],
      ["Import world…", () => importarMundo()],
    ],
  ],
  [
    "Robot",
    [
      ["Robot Library", () => navegar("robots")],
      ["Model import guide", () => navegar("guide")],
    ],
  ],
  [
    "Help",
    [
      ["Welcome screen", () => abrirBienvenida({ forzado: true })],
      ["Help topics", () => navegar("help")],
      ["Protocol reference", () => navegar("protocol")],
      ["separator"],
      ["About MARS Simulation Studio", () => navegar("about")],
    ],
  ],
];

function pintarMenubar() {
  const barra = nodos.menubar;
  let abierto = null;

  const cerrar = () => {
    barra.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
    abierto = null;
  };

  const menus = MENUS().map(([titulo, items]) => {
    const popup = el(
      "div.menu-popup",
      ...items.map(([etiqueta, accion, deshabilitado]) =>
        etiqueta === "separator"
          ? el("div.menu-divider")
          : el(
              "div.menu-item",
              {
                data: { disabled: String(Boolean(deshabilitado?.())) },
                onclick: () => {
                  cerrar();
                  accion();
                },
              },
              etiqueta
            )
      )
    );

    const nodo = el(
      "div.menu",
      el("div.menu-label", {
        onclick: (e) => {
          e.stopPropagation();
          const yaAbierto = nodo.classList.contains("open");
          cerrar();
          if (!yaAbierto) {
            // Los deshabilitados se recalculan al abrir: el estado de la
            // simulación cambia mientras el menú está cerrado.
            popup.querySelectorAll(".menu-item").forEach((item, i) => {
              const d = items.filter((x) => x[0] !== "separator")[i]?.[2];
              if (d) item.dataset.disabled = String(Boolean(d()));
            });
            nodo.classList.add("open");
            abierto = nodo;
          }
        },
        // Con un menú ya abierto, pasar el ratón cambia de menú sin volver a
        // hacer click: el comportamiento clásico de una barra de menús.
        onmouseenter: () => {
          if (abierto && abierto !== nodo) {
            cerrar();
            nodo.classList.add("open");
            abierto = nodo;
          }
        },
      }, titulo),
      popup
    );
    return nodo;
  });

  pintar(
    barra,
    el(
      "div.menubar-logo",
      el("img", { src: "mss.png", alt: "", "aria-hidden": true, draggable: "false" }),
      el("span", "MARS Simulation Studio")
    ),
    el("div.menubar-sep"),
    ...menus,
    // Zona de arrastre: ocupa el hueco sobrante para poder mover la ventana
    // agarrando la barra, sin robarle clicks a los menús.
    el("div.menubar-drag", { "data-tauri-drag-region": true }),
    el(
      "div.menubar-right",
      nodos.rutaSim,
      nodos.puntoConexion
    )
  );

  document.addEventListener("click", cerrar);
}

// --- sidebar -------------------------------------------------------------

function pintarSidebar() {
  const hijos = [];
  let grupoActual = null;
  for (const [id, p] of Object.entries(PAGINAS)) {
    if (p.grupo !== grupoActual) {
      grupoActual = p.grupo;
      hijos.push(el("div.sidebar-group", icono(ICONO_GRUPO[grupoActual] ?? "packages.svg", 12), grupoActual));
    }
    hijos.push(
      el(
        "div.tree-row",
        { data: { active: String(estado.pagina === id) }, onclick: () => navegar(id), title: p.titulo },
        icono(p.svg),
        el("span", p.titulo),
        insignia(id)
      )
    );
  }
  pintar(nodos.sidebar, ...hijos);
}

/** El contador que llevan algunas filas (mundos, robots, fallos). */
function insignia(id) {
  if (id === "worlds" && estado.mundos.length) return el("span.badge", String(estado.mundos.length));
  if (id === "robots" && estado.robots.length) return el("span.badge", String(estado.robots.length));
  return null;
}

// --- barra de estado -----------------------------------------------------

function campo(clave, ...valor) {
  return el("div.status-field", el("span.k", `${clave}:`), el("span.v", ...valor));
}

function pintarStatusbar() {
  const s = estado.sim;
  const corriendo = Boolean(s?.corriendo);
  const tono = corriendo ? "ok" : s?.caido ? "fail" : null;
  const etiqueta = corriendo ? "Running" : s?.caido ? "Crashed" : "Stopped";

  pintar(
    nodos.statusbar,
    campo("Simulation", el("span.dot", { data: tono ? { tone: tono } : {} }), etiqueta),
    campo("World", (estado.prefs.mundo ?? "—").replace(/^worlds\//, "")),
    campo("Robot", (estado.prefs.robot ?? "—").replace(/^models\//, "").replace(/\/robot-map\.json$/, "")),
    campo("NT4", `${estado.prefs.ntHost ?? "127.0.0.1"}:5810`),
    campo("Uptime", corriendo ? `${s.segundos}s` : "—"),
    el("span.spacer"),
    el(
      "span.powered",
      { title: "This simulation runs on Gazebo (Jetty), from conda-forge" },
      "POWERED BY",
      icono("gazebo-logo.svg", 42)
    ),
    el("span.version", `Studio ${MSS_VERSION}`)
  );
}

// --- montaje -------------------------------------------------------------

export function montar() {
  nodos.rutaSim = el("span.path");
  nodos.puntoConexion = el("span.dot");
  nodos.menubar = el("div.menubar");
  nodos.sidebar = el("div.sidebar");
  nodos.header = el("div.panel-header");
  nodos.page = el("div.page");
  nodos.statusbar = el("div.statusbar");

  const raiz = el(
    "div.app-root",
    nodos.menubar,
    el("div.body", nodos.sidebar, el("div.content", nodos.header, nodos.page)),
    nodos.statusbar
  );
  document.body.appendChild(raiz);

  pintarMenubar();
  pintarSidebar();
  pintarStatusbar();
  return nodos;
}

/** Refresca lo que depende del estado del supervisor (barra y punto). */
export function refrescarEstado(s) {
  estado.sim = s;
  pintarStatusbar();
  const tono = s?.corriendo ? "var(--status-sim)" : s?.caido ? "var(--status-error)" : "var(--text-menubar-dim)";
  nodos.puntoConexion.style.background = tono;
  nodos.puntoConexion.style.boxShadow = s?.corriendo ? `0 0 5px ${tono}` : "none";
  nodos.puntoConexion.title = s?.corriendo ? "Simulation running" : s?.caido ? s.caido : "Simulation stopped";
}

export function ponerRutaSim(texto) {
  nodos.rutaSim.textContent = texto;
  nodos.rutaSim.title = texto;
}

/** Un error que no tiene dónde vivir. Se muestra encima de la página actual. */
export function reportar(e) {
  const mensaje = e?.message ?? String(e);
  console.error(e);
  const banda = el("div", { style: { marginBottom: "12px" } }, aviso(mensaje));
  nodos.page?.prepend(banda);
  setTimeout(() => banda.remove(), 9000);
}
