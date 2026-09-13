// About: qué es esto, sobre qué corre, y de quién es cada parte.
//
// El crédito a Gazebo va aquí completo, no solo el logo de la barra de estado:
// toda la física de esta aplicación es Gazebo Jetty, consumido como
// dependencia de conda-forge y nunca clonado al repositorio.

import { MSS_PROTOCOL_VERSION, MSS_VERSION } from "./../constants.js";
import { el, estado } from "./../core.js";
import { navegar } from "./../shell.js";
import { boton, panel, propTexto } from "./../ui.js";
import { abrirBienvenida } from "./../welcome.js";

export function paginaAbout() {
  const cuerpo = el(
    "div.stack",

    el(
      "div.bevel",
      el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "18px",
            padding: "20px 22px",
            background: "linear-gradient(180deg, #3c3d44 0%, #2b2c31 100%)",
            borderBottom: "1px solid #14151a",
          },
        },
        el("img", { src: "mss.png", alt: "", "aria-hidden": true, style: { height: "56px" }, draggable: "false" }),
        el("div", { style: { width: "1px", height: "40px", background: "#55565e" } }),
        el(
          "div",
          el("div", { style: { fontSize: "15px", color: "#ececed", fontWeight: "600" } }, "MARS Simulation Studio"),
          el(
            "div",
            { style: { fontSize: "11px", color: "#a0a1a8", marginTop: "3px" } },
            "Physics simulation and world authoring for the MARS robot framework"
          ),
          el(
            "div",
            { style: { fontSize: "10px", color: "#a0a1a8", marginTop: "5px", fontFamily: "var(--font-mono)" } },
            `VERSION ${MSS_VERSION} · PROTOCOL ${MSS_PROTOCOL_VERSION}`
          )
        ),
        el(
          "div",
          { style: { marginLeft: "auto", textAlign: "right" } },
          el(
            "div",
            { style: { fontSize: "9px", letterSpacing: ".16em", color: "#a0a1a8", marginBottom: "6px" } },
            "POWERED BY"
          ),
          el("img", { src: "icons/gazebo-logo.svg", alt: "Gazebo", style: { width: "132px" }, draggable: "false" })
        )
      )
    ),

    panel(
      "What runs underneath",
      { svg: "packages.svg", help: "app.processes" },
      el("div.doc", {
        html: `
          <p>Every bit of physics in this application is <strong>Gazebo</strong> (Jetty release),
          consumed as a conda-forge dependency declared in <code>sim/environment.yml</code> and
          never vendored into the repository. The 3D world window is Gazebo's own GUI, running the
          MARS panel layout.</p>
          <p>Gazebo is developed by <strong>Open Robotics</strong> and released under the Apache 2.0
          licence. MARS uses it; MARS is not affiliated with it.</p>
          <table>
            <tr><th>Component</th><th>What it is</th></tr>
            <tr><td>gz-sim, gz-physics (DART)</td><td>The simulation engine and its solver</td></tr>
            <tr><td>gz-gui, gz-rendering (OGRE2)</td><td>The world window and its renderer</td></tr>
            <tr><td>gz-transport, gz-msgs</td><td>The protobuf bus between engine and bridge</td></tr>
            <tr><td>Tauri + Rust</td><td>This application and the bridge</td></tr>
            <tr><td>WPILib NetworkTables 4</td><td>Telemetry out to MARS Desktop</td></tr>
          </table>`,
      })
    ),

    panel(
      "This installation",
      { svg: "settings.svg" },
      el(
        "div",
        propTexto("sim/ directory", estado.opciones?.sim_dir ?? "—"),
        propTexto("Conda environment", estado.opciones?.conda_dir ?? "—"),
        propTexto("Worlds", String(estado.mundos.length)),
        propTexto("Robot maps", String(estado.robots.length))
      )
    ),

    panel(
      "MARS",
      { svg: "samples.svg" },
      el("div.doc", {
        html: `
          <p><strong>MARS</strong> — Modular Architecture for Robot Systems — is the framework and
          dashboard this simulation feeds. MARS Desktop receives poses and telemetry over NT4 from
          this simulation exactly as it would from a real robot, which is the whole point: nothing
          in the dashboard has a "simulation mode".</p>
          <p>Built by STZ Robotics. Source and documentation:
          <code class="selectable">github.com/STZ-Robotics</code></p>
          <p>Gazebo documentation: <code class="selectable">gazebosim.org/docs</code> ·
          SDF format reference: <code class="selectable">sdformat.org</code></p>`,
      }),
      el(
        "div.row-wrap",
        { style: { marginTop: "10px" } },
        boton("Welcome screen", { svg: "home.svg", onclick: () => abrirBienvenida({ forzado: true }) }),
        boton("Help topics", { svg: "help.svg", onclick: () => navegar("help") }),
        boton("Import guide", { svg: "import-model.svg", onclick: () => navegar("guide") })
      )
    )
  );

  return { titulo: "About", meta: "MARS Simulation Studio", ancho: "narrow", cuerpo };
}
