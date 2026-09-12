// Diagnostics: todo lo que hace falta para que "Start" funcione, comprobado
// una cosa a la vez.
//
// Existe porque casi todos los fallos de esta app son de instalación y ninguno
// se explica solo: el motor muere con un error de Windows que no nombra la DLL
// que falta, y la ventana 3D abre gris dejando el motivo en un stderr que
// nadie mira.

import { MSS_VERSION_LABEL } from "./../constants.js";
import { el, estado, invoke, pintar } from "./../core.js";
import { navegar } from "./../shell.js";
import { aviso, boton, chip, panel, prop, propTexto } from "./../ui.js";

export function paginaDiagnostics() {
  const cuerpo = el("div.stack", el("div.empty-state", "Running checks…"));

  const entorno = panel(
    "Environment",
    { svg: "settings.svg", help: "app.processes" },
    el(
      "div",
      propTexto("sim/ directory", estado.opciones?.sim_dir ?? "—"),
      propTexto("Conda environment", estado.opciones?.conda_dir ?? "—"),
      propTexto("Studio version", MSS_VERSION_LABEL),
      propTexto("Worlds / robot maps", `${estado.mundos.length} / ${estado.robots.length}`)
    )
  );

  async function cargar() {
    try {
      const chequeos = await invoke("sim_diagnostico");
      const fallos = chequeos.filter((c) => c.estado === "fail").length;
      const avisos = chequeos.filter((c) => c.estado === "warn").length;

      pintar(
        cuerpo,
        fallos
          ? aviso(
              `${fallos} check${fallos > 1 ? "s" : ""} failed. The simulation will not start until ${
                fallos > 1 ? "they are" : "it is"
              } fixed.`
            )
          : avisos
          ? aviso(`All required checks pass. ${avisos} optional item${avisos > 1 ? "s are" : " is"} missing.`, "warn")
          : aviso("Everything checks out. The simulation is ready to run.", "ok"),

        panel(
          "Checks",
          {
            svg: "watchdog.svg",
            help: "diagnostics",
            flush: true,
            acciones: boton("Re-run", { svg: "republish.svg", sm: true, onclick: cargar }),
          },
          el(
            "div",
            ...chequeos.map((c) =>
              el(
                "div",
                { style: { borderBottom: "1px solid var(--border-light)" } },
                prop(
                  c.nombre,
                  el(
                    "span.row",
                    { style: { minWidth: "0" } },
                    chip(c.estado, c.estado === "ok" ? "ok" : c.estado === "warn" ? "warn" : "fail"),
                    el("span.mono.dim", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: c.detalle }, c.detalle)
                  )
                ),
                c.arreglo
                  ? el(
                      "div",
                      {
                        style: {
                          padding: "5px 10px 8px 46px",
                          fontSize: "11px",
                          color: c.estado === "warn" ? "var(--status-warning)" : "var(--status-error)",
                        },
                      },
                      `→ ${c.arreglo}`
                    )
                  : null
              )
            )
          )
        ),

        entorno,

        panel(
          "If something still fails",
          { svg: "help.svg", help: "console.logs" },
          el("div.doc", {
            html: `
              <p>Build everything from the repository root:</p>
              <pre><code>conda env create -f sim/environment.yml     # once
conda activate mars-sim
sim\\build.ps1                              # engine, world window, MarsLink
cargo build --manifest-path sim/bridge/Cargo.toml
cargo build --manifest-path sim/app/Cargo.toml</code></pre>
              <p><code>sim\\verify.ps1</code> runs all seven verification layers end to end:
              contract, engine, bridge, physics, NT4, the hardware loop, and swerve under position
              control. If that passes and this page still complains, the app is looking at the
              wrong <code>sim/</code> — set <code>MARS_SIM_DIR</code>.</p>`,
          })
        )
      );
    } catch (e) {
      pintar(cuerpo, aviso(e.message));
    }
  }

  cargar();

  return {
    titulo: "Diagnostics",
    meta: "Prerequisites for running a simulation",
    help: "diagnostics",
    acciones: [boton("Console", { svg: "console.svg", sm: true, onclick: () => navegar("console") })],
    cuerpo,
  };
}
