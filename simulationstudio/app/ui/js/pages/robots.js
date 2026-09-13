// Robot Library: los robot-map.json de sim/models/, leídos como tablas.
//
// Un robot-map es JSON y se puede abrir en cualquier editor, pero hay dos
// cosas que solo se ven mirándolo entero: si el ORDEN de los actuadores es el
// que espera el SDF (ese orden es el índice dentro de gz.msgs.Actuators), y si
// cada actuador declara el modo de control que le corresponde. Las dos se
// pintan aquí con su número de índice a la vista.

import { el, estado, guardarPrefs, invoke, num, pintar } from "./../core.js";
import { navegar, refrescarPagina, reportar } from "./../shell.js";
import { aviso, boton, chip, panel, prop, propTexto, vacio } from "./../ui.js";

export function paginaRobots() {
  let seleccionado = estado.prefs.robotSeleccionado ?? estado.prefs.robot ?? estado.robots[0]?.ruta ?? null;
  if (!estado.robots.some((r) => r.ruta === seleccionado)) seleccionado = estado.robots[0]?.ruta ?? null;

  const detalle = el("div");
  const cuerpo = el("div.stack");

  if (!estado.robots.length) {
    return {
      titulo: "Robot Library",
      help: "robots.map",
      acciones: [boton("Import guide", { svg: "import-model.svg", sm: true, onclick: () => navegar("guide") })],
      cuerpo: vacio("No robot maps in sim/models/", "Each robot is a folder with a robot-map.json inside"),
    };
  }

  function pintarDetalle() {
    const r = estado.robots.find((x) => x.ruta === seleccionado);
    if (!r) return pintar(detalle, vacio("Select a robot"));

    const json = el("div", el("div.empty-state", "Reading robot-map.json…"));
    invoke("sim_leer_texto", { ruta: r.ruta })
      .then((t) => pintar(json, tablas(t)))
      .catch((e) => pintar(json, aviso(e.message)));

    pintar(
      detalle,
      panel(
        r.carpeta,
        {
          svg: "robot.svg",
          help: "robots.map",
          acciones: chip(r.perfil || "no profile", r.perfil === "vendor" ? "accent" : r.perfil ? "ok" : "warn"),
        },
        el(
          "div",
          propTexto("Path", r.ruta),
          propTexto("Robot", r.robot),
          prop("Profile", el("span.mono", r.perfil || "—"), { help: "robots.profiles" }),
          propTexto("World / model", `${r.mundo || "—"} / ${r.modelo || "—"}`),
          prop("Implements SDF", el("span.mono", r.sdf ?? "—"), { help: "robots.actuators" }),
          prop("Actuators", el("span.mono", String(r.actuadores)), { help: "robots.actuators" }),
          prop("Encoders", el("span.mono", String(r.encoders)), { help: "robots.encoders" }),
          prop("IMU", el("span.mono", r.imu ? "declared" : "none"), { help: "robots.imu" })
        ),
        el(
          "div.row-wrap",
          { style: { marginTop: "10px" } },
          boton("Use for launch", {
            svg: "play.svg",
            variante: "primary",
            disabled: estado.prefs.robot === r.ruta,
            onclick: () => {
              guardarPrefs({ robot: r.ruta });
              navegar("launch");
            },
          }),
          boton("Reveal in Explorer", {
            svg: "open-folder.svg",
            onclick: () => invoke("sim_revelar", { ruta: r.ruta }).catch(reportar),
          }),
          boton("Import guide", { svg: "import-model.svg", onclick: () => navegar("guide") })
        ),
        ...r.notas.map((n) => el("div", { style: { marginTop: "8px" } }, aviso(n, "warn")))
      ),
      json
    );
  }

  pintar(
    cuerpo,
    panel(
      "Robots",
      { svg: "robot.svg", help: "robots.map", flush: true },
      el(
        "div",
        ...estado.robots.map((r) =>
          el(
            "div.list-row",
            {
              data: { active: String(r.ruta === seleccionado) },
              onclick: () => {
                seleccionado = r.ruta;
                guardarPrefs({ robotSeleccionado: r.ruta });
                refrescarPagina();
              },
            },
            el("img", { src: "icons/robot.svg", width: 15, height: 15, alt: "" }),
            el("span", r.carpeta),
            el("span.desc", `${r.perfil || "?"} · ${r.actuadores} actuators · ${r.encoders} encoders`)
          )
        )
      )
    ),
    detalle
  );
  pintarDetalle();

  return {
    titulo: "Robot Library",
    meta: `${estado.robots.length} robot map${estado.robots.length === 1 ? "" : "s"}`,
    help: "robots.map",
    acciones: [
      boton("Import guide", { svg: "import-model.svg", sm: true, onclick: () => navegar("guide") }),
      boton("Reload", { svg: "republish.svg", sm: true, onclick: () => refrescarPagina() }),
    ],
    cuerpo,
  };
}

/** Las tres tablas del mapa: actuadores, encoders, IMU. */
function tablas(textoJson) {
  let j;
  try {
    j = JSON.parse(textoJson);
  } catch (e) {
    return aviso(`robot-map.json is not valid JSON: ${e.message}`);
  }

  const act = j.actuators ?? [];
  const enc = j.encoders ?? [];

  return el(
    "div.stack",
    panel(
      "Actuators",
      {
        svg: "joint.svg",
        help: "robots.actuators",
        flush: true,
        acciones: el("span.dim", { style: { fontSize: "10.5px" } }, "index = position in gz.msgs.Actuators"),
      },
      act.length
        ? el(
            "table.grid",
            el(
              "thead",
              el(
                "tr",
                el("th.num", "#"),
                el("th", "Name"),
                el("th", "Joint"),
                el("th", "Motor"),
                el("th.num", "Gear"),
                el("th", "Control"),
                el("th", "Inverted"),
                el("th", "HAL")
              )
            ),
            el(
              "tbody",
              ...act.map((a, i) =>
                el(
                  "tr",
                  el("td.num.mono", String(i)),
                  el("td", a.name ?? "—"),
                  el("td.mono", a.joint ?? "—"),
                  el("td.mono", a.motor ?? "—"),
                  el("td.num.mono", { title: String(a.gearRatio ?? "") }, a.gearRatio == null ? "—" : num(a.gearRatio, 4)),
                  el("td", chip(a.control ?? "duty", a.control === "position" ? "accent" : null)),
                  el("td.dim", a.inverted ? "yes" : "no"),
                  el("td.mono.dim", a.hal ? `${a.hal.kind} ${a.hal.channel ?? a.hal.index ?? ""}` : "—")
                )
              )
            )
          )
        : el("div", { style: { padding: "10px" } }, aviso("No actuators declared.", "warn"))
    ),

    panel(
      "Encoders",
      { svg: "measure.svg", help: "robots.encoders", flush: true },
      enc.length
        ? el(
            "table.grid",
            el("thead", el("tr", el("th.num", "#"), el("th", "Name"), el("th", "Joint"), el("th.num", "Counts/rev"), el("th", "HAL"))),
            el(
              "tbody",
              ...enc.map((e, i) =>
                el(
                  "tr",
                  el("td.num.mono", String(i)),
                  el("td", e.name ?? "—"),
                  el("td.mono", e.joint ?? "—"),
                  el("td.num.mono", e.countsPerRevolution ?? "—"),
                  el("td.mono.dim", e.hal ? `${e.hal.kind} ${e.hal.index ?? ""}` : "—")
                )
              )
            )
          )
        : el("div", { style: { padding: "10px" } }, aviso("No encoders declared. The robot will report no joint state.", "warn"))
    ),

    panel(
      "IMU",
      { svg: "axes.svg", help: "robots.imu" },
      j.imu
        ? el(
            "div",
            ...Object.entries(j.imu).map(([k, v]) => propTexto(k, typeof v === "object" ? JSON.stringify(v) : String(v)))
          )
        : el(
            "div.doc",
            {
              html: `<p>No IMU declared. That is fine for a mechanism, but a drivetrain without a gyro
                     has no heading — and the dashboard cannot tell "no gyro" from "a robot that never
                     turns".</p>
                     <p>An IMU needs two things to line up: a <code>&lt;sensor type="imu"&gt;</code> on the
                     chassis link in the SDF, and the IMU system plugin enabled on the world.</p>`,
            }
          )
    ),

    panel(
      "Raw file",
      { svg: "model-file.svg" },
      el("pre.log", { style: { height: "260px" } }, textoJson)
    )
  );
}
