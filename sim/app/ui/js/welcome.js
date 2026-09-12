// El portal de bienvenida.
//
// Un diálogo de arranque como los de las suites de escritorio de hace veinte
// años: banda de marca a la izquierda, listas densas de accesos a la derecha,
// y un "Show this window at startup" abajo del todo que de verdad se recuerda.
// Nada de hero a pantalla completa ni tarjetas grandes --- esto es el índice
// de una herramienta, no la landing de un producto, y el resto de la app
// (igual que mars-desktop) ya habla ese idioma.

import { MSS_PROTOCOL_VERSION, MSS_VERSION } from "./constants.js";
import { el, estado, guardarPrefs, icono } from "./core.js";
import { navegar } from "./shell.js";
import { boton, modal } from "./ui.js";
import { importarMundo, nuevoMundo } from "./pages/worlds.js";

let abierta = false;

/**
 * Abre el portal. `forzado` lo abre aunque el usuario haya desmarcado la
 * casilla --- es como se llega desde el menú Help.
 */
export function abrirBienvenida({ forzado = false } = {}) {
  if (abierta) return;
  if (!forzado && estado.prefs.mostrarBienvenida === false) return;
  abierta = true;

  const cerrarY = (accion) => () => {
    dialogo.cerrar?.();
    accion();
  };

  const recientes = (estado.prefs.recientes ?? [])
    .map((ruta) => estado.mundos.find((m) => m.ruta === ruta))
    .filter(Boolean)
    .slice(0, 5);

  const listas = el(
    "div.welcome-lists",

    seccion("Start", "play.svg", [
      ["add.svg", "New world", "Create one from a template", cerrarY(() => nuevoMundo())],
      ["import-model.svg", "Import world", "Copy an existing .sdf into the project", cerrarY(() => importarMundo())],
      ["scene.svg", "World Library", `${estado.mundos.length} world${estado.mundos.length === 1 ? "" : "s"} in this project`, cerrarY(() => navegar("worlds"))],
      ["robot.svg", "Robot Library", `${estado.robots.length} robot map${estado.robots.length === 1 ? "" : "s"}`, cerrarY(() => navegar("robots"))],
      ["play.svg", "Launch simulation", "Pick a world and a robot, then start", cerrarY(() => navegar("launch"))],
    ]),

    recientes.length
      ? seccion(
          "Recent worlds",
          "open-folder.svg",
          recientes.map((m) => [
            "scene.svg",
            m.archivo,
            m.gestionado ? "managed" : "external",
            cerrarY(() => navegar("editor", { ruta: m.ruta })),
          ])
        )
      : null,

    seccion("Learn", "help.svg", [
      ["import-model.svg", "Model import guide", "Bring your own SDF model into the simulation", cerrarY(() => navegar("guide"))],
      ["network.svg", "Protocol reference", "How engine, bridge and robot code talk", cerrarY(() => navegar("protocol"))],
      ["help.svg", "Help topics", "Every explanation in the app, in one place", cerrarY(() => navegar("help"))],
      ["watchdog.svg", "Diagnostics", "Check that everything needed to run is installed", cerrarY(() => navegar("diagnostics"))],
      ["samples.svg", "About", "Versions, credits and what runs underneath", cerrarY(() => navegar("about"))],
    ])
  );

  const casilla = el("input", {
    type: "checkbox",
    checked: estado.prefs.mostrarBienvenida !== false,
    onchange: (e) => guardarPrefs({ mostrarBienvenida: e.target.checked }),
  });

  const cuerpo = el(
    "div.modal-body",
    { style: { padding: "0", display: "flex", flexDirection: "column", minHeight: "0" } },
    el(
      "div.welcome-split",
      el(
        "div.welcome-brand",
        el(
          "div.brand-mark",
          el("img", { src: "mss.png", alt: "", "aria-hidden": true, draggable: "false" }),
          el("div", el("b", "MARS"), el("span", "Simulation Studio"))
        ),
        el("div.tagline", "Physics simulation and world authoring for the MARS robot framework."),
        el("div.build", `STUDIO ${MSS_VERSION} · PROTOCOL ${MSS_PROTOCOL_VERSION}`),
        // Tres líneas de qué hay dentro. La banda de marca quedaba con un hueco
        // grande entre la versión y el crédito de Gazebo, y un vacío en una
        // pantalla de bienvenida se lee como una pantalla sin terminar.
        el(
          "div.brand-facts",
          ...[
            ["scene.svg", "Author worlds", "Physics, ground, walls, lighting and props — no XML required."],
            ["import-model.svg", "Import anything", "Bring in an existing .sdf, meshes and all."],
            ["robot.svg", "Run and watch", "Supervises the engine, the 3D window and the NT4 bridge."],
          ].map(([svg, titulo, texto]) =>
            el("div.fact", icono(svg, 15), el("div", el("b", titulo), el("span", texto)))
          )
        ),
        el(
          "div.gz",
          el("div.powered", "Powered by"),
          el("img", { src: "icons/gazebo-logo.svg", alt: "Gazebo", draggable: "false" }),
          el(
            "div",
            { style: { fontSize: "9.5px", color: "var(--text-menubar-dim)", lineHeight: "1.5" } },
            "Gazebo Jetty, by Open Robotics. All physics and the 3D world window come from it."
          )
        )
      ),
      el(
        "div.welcome-main",
        el(
          "div.intro",
          el("h2", "Welcome to MARS Simulation Studio"),
          el(
            "p",
            "Run your robot against real physics before it exists, and build the worlds you run it in. " +
              "If you are here for the first time, start with the model import guide — it covers the things " +
              "that are not obvious and that cost a day each when you find them yourself."
          )
        ),
        listas
      )
    ),
    el(
      "div.welcome-foot",
      el("label", casilla, "Show this window at startup"),
      boton("Get started", { variante: "primary", svg: "play.svg", onclick: () => dialogo.cerrar() })
    )
  );

  const dialogo = modal({
    titulo: "Welcome — MARS Simulation Studio",
    svg: "home.svg",
    clase: "welcome",
    cuerpo,
    alCerrar: () => {
      abierta = false;
    },
  });
}

function seccion(titulo, svg, filas) {
  return el(
    "div.bevel",
    el("div.bevel-title", icono(svg), el("span.label", titulo)),
    el(
      "div",
      ...filas.map(([icon, nombre, desc, accion]) =>
        el("div.list-row", { onclick: accion }, icono(icon, 15), el("span", nombre), el("span.desc", desc))
      )
    )
  );
}
