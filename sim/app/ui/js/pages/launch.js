// Launch: elegir qué correr y correrlo.
//
// Es la página que hereda de la app vieja entera, y sigue siendo la primera
// que se abre. Lo que se le añadió es contexto: qué mundo es el elegido y qué
// le pasa, qué robot, y un vistazo a los logs sin tener que ir a Console.

import { el, estado, guardarPrefs, invoke, pintar } from "./../core.js";
import { navegar, refrescarPagina, reportar } from "./../shell.js";
import { aviso, boton, chip, panel, prop, propTexto, vacio } from "./../ui.js";

export function paginaLaunch() {
  const prefs = estado.prefs;
  prefs.ntHost ??= "127.0.0.1";
  prefs.ntPort ??= 5810;

  // Preselección: el swerve es el robot del equipo, así que si está, arrancar
  // es un solo click en el caso normal.
  if (!prefs.robot || !estado.robots.some((r) => r.ruta === prefs.robot)) {
    const swerve = estado.robots.find((r) => r.ruta.includes("swerve")) ?? estado.robots[0];
    prefs.robot = swerve?.ruta ?? "";
  }
  if (!prefs.mundo || !estado.mundos.some((m) => m.ruta === prefs.mundo)) {
    const suyo = estado.mundos.find((m) => prefs.robot && m.ruta.includes(nombreCorto(prefs.robot)));
    prefs.mundo = (suyo ?? estado.mundos[0])?.ruta ?? "";
  }

  const nodos = {
    luz: el("span.dot"),
    texto: el("span", "Stopped"),
    detalle: el("span.mono.dim"),
    motorPid: el("span.mono", "—"),
    mundoPid: el("span.mono", "—"),
    bridgePid: el("span.mono", "—"),
    caida: el("div"),
    logMotor: el("pre.log", { style: { height: "150px" } }),
    logBridge: el("pre.log", { style: { height: "150px" } }),
  };

  const btnArrancar = boton("Start simulation", { svg: "play.svg", variante: "go", onclick: arrancar });
  const btnParar = boton("Stop", { svg: "stop.svg", variante: "stop", onclick: parar, disabled: true });

  const selectores = [];
  const selMundo = selector(estado.mundos.map((m) => [m.ruta, m.archivo]), prefs.mundo, (v) => {
    guardarPrefs({ mundo: v });
    refrescarPagina();
  });
  const selRobot = selector(
    estado.robots.map((r) => [r.ruta, `${r.carpeta} — ${r.actuadores} actuators, ${r.perfil || "?"} profile`]),
    prefs.robot,
    (v) => {
      guardarPrefs({ robot: v });
      refrescarPagina();
    }
  );
  const inHost = el("input", {
    type: "text",
    value: prefs.ntHost,
    spellcheck: "false",
    oninput: (e) => guardarPrefs({ ntHost: e.target.value }),
  });
  const inPuerto = el("input", {
    type: "number",
    value: prefs.ntPort,
    min: 1,
    max: 65535,
    oninput: (e) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) guardarPrefs({ ntPort: v });
    },
  });
  selectores.push(selMundo, selRobot, inHost, inPuerto);

  const mundo = estado.mundos.find((m) => m.ruta === prefs.mundo) ?? null;
  const robot = estado.robots.find((r) => r.ruta === prefs.robot) ?? null;

  function bloquear(activo) {
    for (const s of selectores) s.disabled = activo;
    btnArrancar.disabled = activo;
    btnParar.disabled = !activo;
  }

  async function arrancar() {
    pintar(nodos.caida);
    bloquear(true);
    try {
      await invoke("sim_arrancar", {
        cfg: {
          world: prefs.mundo,
          robot_map: prefs.robot,
          nt_host: (prefs.ntHost || "127.0.0.1").trim(),
          nt_port: prefs.ntPort || 5810,
        },
      });
    } catch (e) {
      pintar(nodos.caida, aviso(e.message));
      bloquear(false);
    }
  }

  async function parar() {
    try {
      await invoke("sim_detener");
    } catch (e) {
      reportar(e);
    }
    bloquear(false);
  }

  const sinNada = !estado.mundos.length || !estado.robots.length;

  const cuerpo = el(
    "div.stack",
    sinNada
      ? aviso(
          !estado.mundos.length
            ? "No worlds found in sim/worlds/. Create one from World Library, or import an existing .sdf."
            : "No robot maps found in sim/models/. See the Import Guide for how to add one.",
          "warn"
        )
      : null,

    panel(
      "Run configuration",
      { svg: "settings.svg", help: "launch.world" },
      el(
        "div",
        prop("World", selMundo, { help: "launch.world" }),
        prop("Robot map", selRobot, { help: "launch.robot" }),
        prop("NT4 host", inHost, { help: "launch.nt" }),
        prop("NT4 port", inPuerto, { help: "launch.nt" })
      ),
      el(
        "div.row",
        { style: { marginTop: "10px" } },
        btnArrancar,
        btnParar,
        el("span", { style: { marginLeft: "auto" } }),
        boton("Edit world", {
          svg: "grid.svg",
          sm: true,
          disabled: !mundo,
          onclick: () => navegar("editor", { ruta: prefs.mundo }),
        }),
        boton("Diagnostics", { svg: "watchdog.svg", sm: true, onclick: () => navegar("diagnostics") })
      ),
      nodos.caida
    ),

    el(
      "div.grid-2",
      panel(
        "Selected world",
        { svg: "scene.svg", help: "worlds.library" },
        mundo
          ? el(
              "div",
              propTexto("File", mundo.archivo),
              prop(
                "World name",
                el(
                  "span.row",
                  el("span.mono", mundo.mundo || "—"),
                  mundo.mundo === "mars" ? chip("ok", "ok") : chip("wrong", "fail")
                ),
                { help: "worlds.name-mars" }
              ),
              propTexto("Models / includes", `${mundo.modelos} / ${mundo.incluye}`),
              propTexto("Plugins / lights", `${mundo.plugins} / ${mundo.luces}`),
              prop(
                "Physics step",
                el("span.mono", mundo.paso ? `${mundo.paso} s  (${Math.round(1 / mundo.paso)} Hz)` : "—"),
                { help: "world.physics.step" }
              ),
              prop("Real-time factor", el("span.mono", mundo.rtf ?? "—"), { help: "world.physics.rtf" }),
              prop(
                "Editable",
                mundo.gestionado ? chip("managed", "accent") : chip("external", "warn"),
                { help: "worlds.managed" }
              ),
              ...mundo.notas.map((n) => el("div", { style: { padding: "8px 0 0" } }, aviso(n, "warn")))
            )
          : vacio("No world selected")
      ),

      panel(
        "Selected robot",
        { svg: "robot.svg", help: "robots.map" },
        robot
          ? el(
              "div",
              propTexto("Folder", robot.carpeta),
              propTexto("Robot", robot.robot),
              prop("Profile", chip(robot.perfil || "unknown", robot.perfil === "vendor" ? "accent" : null), {
                help: "robots.profiles",
              }),
              propTexto("Implements", robot.sdf ?? "—"),
              prop("Actuators", el("span.mono", String(robot.actuadores)), { help: "robots.actuators" }),
              prop("Encoders", el("span.mono", String(robot.encoders)), { help: "robots.encoders" }),
              prop("IMU", el("span.mono", robot.imu ? "declared" : "none"), { help: "robots.imu" }),
              ...robot.notas.map((n) => el("div", { style: { padding: "8px 0 0" } }, aviso(n, "warn")))
            )
          : vacio("No robot map selected")
      )
    ),

    panel(
      "Status",
      { svg: "watchdog.svg", help: "launch.status" },
      el(
        "div",
        prop("State", el("span.row", nodos.luz, nodos.texto, nodos.detalle), { help: "launch.status" }),
        prop("Engine (mars-sim-server)", nodos.motorPid, { help: "app.processes" }),
        prop("World window (mars-sim-gui)", nodos.mundoPid, { help: "app.world-window" }),
        prop("Bridge (mars-bridge)", nodos.bridgePid, { help: "app.processes" })
      )
    ),

    panel(
      "Recent output",
      {
        svg: "console.svg",
        help: "console.logs",
        acciones: boton("Open console", { sm: true, onclick: () => navegar("console") }),
      },
      el(
        "div.grid-2",
        el("div", el("div.field-label", "Engine"), nodos.logMotor),
        el("div", el("div.field-label", "Bridge"), nodos.logBridge)
      )
    )
  );

  // El tick lo llama el bucle de sondeo mientras esta página esté montada.
  const tick = async (s) => {
    const corriendo = Boolean(s?.corriendo);
    nodos.luz.dataset.tone = corriendo ? "ok" : s?.caido ? "fail" : "";
    nodos.texto.textContent = corriendo ? "Running" : s?.caido ? "Crashed" : "Stopped";
    nodos.detalle.textContent = corriendo ? `${s.segundos}s` : "";
    nodos.motorPid.textContent = s?.motor_pid ? `pid ${s.motor_pid}` : "—";
    nodos.mundoPid.textContent = s?.mundo_pid ? `pid ${s.mundo_pid}` : "—";
    nodos.bridgePid.textContent = s?.bridge_pid ? `pid ${s.bridge_pid}` : "—";

    // Un proceso que se muere solo tiene que verse aquí, no solo en el log:
    // sin esto la UI diría "Running" para siempre después de un crash.
    if (s?.caido && !nodos.caida.firstChild) {
      pintar(nodos.caida, el("div", { style: { paddingTop: "10px" } }, aviso(s.caido)));
      bloquear(false);
    }
    if (btnParar.disabled === corriendo) bloquear(corriendo);

    try {
      const l = await invoke("sim_logs", { lineas: 14 });
      colaDeLog(nodos.logMotor, l.motor);
      colaDeLog(nodos.logBridge, l.bridge);
    } catch {
      // El log es un extra en esta página; Console es donde importa.
    }
  };

  return {
    titulo: "Launch",
    meta: `${estado.mundos.length} worlds · ${estado.robots.length} robot maps`,
    help: "app.overview",
    acciones: [boton("Reload", { svg: "republish.svg", sm: true, onclick: () => refrescarPagina() })],
    cuerpo,
    tick,
  };
}

function nombreCorto(rutaRobot) {
  return rutaRobot.replace(/^models\//, "").replace(/\/robot-map\.json$/, "");
}

function selector(items, valor, alCambiar) {
  return el(
    "select",
    { onchange: (e) => alCambiar(e.target.value) },
    ...items.map(([v, etiqueta]) => el("option", { value: v, selected: v === valor }, etiqueta))
  );
}

/** Escribe el log solo si cambió, y sigue la cola sin robar el scroll. */
export function colaDeLog(pre, texto) {
  const limpio = (texto ?? "").replace(/^\s+|\s+$/g, "");
  if (pre.textContent === limpio) return;
  const abajo = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
  pre.textContent = limpio;
  if (abajo) pre.scrollTop = pre.scrollHeight;
}
