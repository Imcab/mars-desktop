// Console: los tres logs, a tamaño completo.
//
// La app vieja tenía dos paneles de log recortados a 40 líneas. Aquí hay tres
// (falta el de la ventana del mundo, que es donde aparece el fallo de OGRE
// que deja la escena gris), con filtro, control de cuántas líneas se traen y
// la opción de congelar la vista para poder leer.

import { el, estado, invoke, pintar } from "./../core.js";
import { reportar } from "./../shell.js";
import { boton, casilla, panel } from "./../ui.js";

const FUENTES = [
  ["motor", "Engine", "mars-sim-server — physics"],
  ["mundo", "World window", "mars-sim-gui — the 3D view"],
  ["bridge", "Bridge", "mars-bridge — gz-transport ⇄ NT4"],
];

export function paginaConsole() {
  const cfg = estado.prefs.consola ?? (estado.prefs.consola = { lineas: 120, filtro: "", congelado: false });

  const paneles = {};
  const cuerpo = el("div.stack");

  const inFiltro = el("input", {
    type: "text",
    value: cfg.filtro,
    placeholder: "Filter lines (plain text, case-insensitive)",
    spellcheck: "false",
    oninput: (e) => {
      cfg.filtro = e.target.value;
      repintar();
    },
  });

  const selLineas = el(
    "select",
    {
      style: { width: "90px" },
      onchange: (e) => {
        cfg.lineas = parseInt(e.target.value, 10);
      },
    },
    ...[60, 120, 250, 500].map((n) => el("option", { value: n, selected: cfg.lineas === n }, `${n} lines`))
  );

  let ultimo = { motor: "", mundo: "", bridge: "" };

  function repintar() {
    for (const [clave] of FUENTES) escribir(paneles[clave], ultimo[clave] ?? "");
  }

  function escribir(pre, texto) {
    const lineas = texto.split("\n");
    const f = cfg.filtro.trim().toLowerCase();
    const vistas = f ? lineas.filter((l) => l.toLowerCase().includes(f)) : lineas;
    const limpio = vistas.join("\n").replace(/^\s+|\s+$/g, "");
    if (pre.textContent === limpio) return;

    // Seguir la cola solo si el usuario ya estaba al final: si está leyendo más
    // arriba, saltarle el scroll es de las cosas más molestas que puede hacer
    // un panel de logs.
    const abajo = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.textContent = limpio || (f ? "(no lines match the filter)" : "(empty)");
    if (abajo) pre.scrollTop = pre.scrollHeight;
  }

  pintar(
    cuerpo,
    panel(
      "View",
      { svg: "console.svg", help: "console.logs" },
      el(
        "div.row",
        el("span", { style: { flex: "1" } }, inFiltro),
        selLineas,
        casilla(cfg, "congelado", { etiqueta: "Freeze" }),
        boton("Copy all", {
          svg: "copy-value.svg",
          sm: true,
          onclick: () => {
            const todo = FUENTES.map(([k, n]) => `=== ${n} ===\n${ultimo[k] ?? ""}`).join("\n\n");
            navigator.clipboard?.writeText(todo).catch(reportar);
          },
        }),
        boton("Reveal log folder", {
          svg: "open-folder.svg",
          sm: true,
          onclick: () => invoke("sim_revelar", { ruta: "build" }).catch(reportar),
        })
      )
    ),
    ...FUENTES.map(([clave, titulo, sub]) => {
      const pre = el("pre.log", { style: { height: "220px" } }, "(empty)");
      paneles[clave] = pre;
      return panel(titulo, { svg: "console.svg", acciones: el("span.mono.dim", sub) }, pre);
    })
  );

  const tick = async () => {
    if (cfg.congelado) return;
    try {
      const l = await invoke("sim_logs", { lineas: cfg.lineas });
      ultimo = l;
      repintar();
    } catch (e) {
      // Un fallo leyendo logs no debe empapelar la página cada 700 ms.
      console.warn(e);
    }
  };

  return {
    titulo: "Console",
    meta: "Engine, world window and bridge output",
    help: "console.logs",
    cuerpo,
    tick,
  };
}
