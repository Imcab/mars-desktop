// World Editor: el árbol de propiedades que genera el SDF.
//
// Cuatro pestañas. **Properties** y **Props** editan el spec y regeneran el
// XML; **Source** edita el XML a mano; **Preview** enseña lo que saldría del
// spec sin escribir nada --- ver el XML antes de guardarlo es la diferencia
// entre confiar en el generador y comprobarlo.
//
// Un mundo EXTERNO (sin .studio.json al lado) abre directamente en Source, con
// el árbol deshabilitado. Regenerar un SDF escrito a mano a partir de lo poco
// que un regex puede sacar de él destruiría trabajo ajeno en silencio.

import { anotarReciente, el, estado, grados, guardarPrefs, invoke, pintar, radianes, recargarBibliotecas } from "./../core.js";
import { navegar, refrescarPagina, reportar } from "./../shell.js";
import {
  aviso, boton, casilla, chip, color, grupoProp, modal, numero, numeroEn,
  opciones, prop, propTexto, texto, vacio,
} from "./../ui.js";
import { PROPS_PREDEFINIDOS, nuevoProp, rejillaFuel } from "./../worldspec.js";
import { nuevoMundo } from "./worlds.js";

const MOTORES = [
  ["dart", "DART (default, verified)"],
  ["bullet-featherstone", "Bullet Featherstone"],
];

/**
 * Lo que el generador va a hacer con ese número, dicho ANTES de guardarlo: la
 * rejilla que sale y si hay que apilar. Sin esto, "60" y "600" se ven igual en
 * el editor, y la diferencia solo aparece cuando la ventana del mundo ya está
 * abierta y arrastrándose.
 */
function notaFuel(s) {
  if (!s.fuel) return "none";
  const { cols, filas, porCapa, capas } = rejillaFuel(s.fuel, s.fuel_area);
  const rejilla = `${cols} × ${filas} grid`;
  return capas > 1 ? `${rejilla}, ${capas} layers (${porCapa} per layer)` : rejilla;
}

const FORMAS = [
  ["box", "Box"],
  ["cylinder", "Cylinder"],
  ["sphere", "Sphere"],
  ["mesh", "Mesh"],
];

export function paginaEditor(params) {
  const ruta = params?.ruta ?? estado.mundoAbierto ?? estado.prefs.mundoSeleccionado ?? estado.prefs.mundo;
  const info = estado.mundos.find((m) => m.ruta === ruta);

  if (!ruta || !info) {
    return {
      titulo: "World Editor",
      cuerpo: vacio(
        "No world open",
        "Pick one in World Library, or create a new one"
      ),
      acciones: [
        boton("New world", { svg: "add.svg", sm: true, onclick: () => nuevoMundo() }),
        boton("World Library", { svg: "scene.svg", sm: true, onclick: () => navegar("worlds") }),
      ],
    };
  }

  estado.mundoAbierto = ruta;
  anotarReciente(ruta);
  const cuerpo = el("div.stack");

  let spec = null;
  let sucio = false;
  let pestana = estado.prefs.editorTab ?? "props";

  // El manifiesto del generador, si este mundo lo tiene, y lo que el usuario
  // lleva elegido. `null` mientras no se ha preguntado; `false` si no hay.
  let generador = null;
  let valores = {};
  let salidaGen = "";

  const marcarSucio = () => {
    if (sucio) return;
    sucio = true;
    pintarTodo();
  };

  // --- guardar ----------------------------------------------------------

  async function guardar() {
    try {
      await invoke("sim_guardar_mundo", { spec });
      sucio = false;
      await recargarBibliotecas();
      pintarTodo();
    } catch (e) {
      reportar(e);
    }
  }

  // --- carga ------------------------------------------------------------

  (async () => {
    try {
      spec = await invoke("sim_mundo_spec", { ruta });
    } catch (e) {
      reportar(e);
    }
    try {
      generador = (await invoke("sim_generador", { ruta })) ?? false;
      if (generador) {
        for (const o of generador.opciones) valores[o.nombre] = o.defecto;
        // Un mundo generado no se edita con el arbol: su pestana util es esta.
        if (!spec) pestana = "generator";
      }
    } catch (e) {
      generador = false;
      reportar(e);
    }
    if (!spec && !generador) pestana = "source";
    pintarTodo();
  })();

  pintar(cuerpo, el("div.empty-state", "Loading world…"));

  // --- pintado ----------------------------------------------------------

  function pintarTodo() {
    const externo = !spec;
    // La pestaña elegida se recuerda entre mundos, y "generator" solo existe en
    // los que tienen script: sin esto, abrir un mundo normal después de uno
    // generado deja el editor en una pestaña que no está.
    if (pestana === "generator" && !generador) pestana = externo ? "source" : "props";
    const tabs = el(
      "div.tabs",
      ...[
        ["props", "Properties", "settings.svg", !externo],
        ["objects", "Props & objects", "game-piece.svg", !externo],
        ["generator", "Generator", "wizard.svg", Boolean(generador)],
        ["source", "Source (SDF)", "model-file.svg", true],
        ["preview", "Preview", "visible.svg", !externo],
      ]
        .filter(([, , , visible]) => visible)
        .map(([id, etiqueta, svg]) =>
          el(
            "div.tab",
            {
              data: { active: String(pestana === id) },
              onclick: () => {
                pestana = id;
                guardarPrefs({ editorTab: id });
                pintarTodo();
              },
            },
            el("img", { src: `icons/${svg}`, width: 13, height: 13, alt: "" }),
            etiqueta
          )
        )
    );

    const contenido =
      pestana === "generator" && generador ? vistaGenerador()
      : externo ? vistaFuente(ruta, true)
      : pestana === "props" ? vistaPropiedades()
      : pestana === "objects" ? vistaObjetos()
      : pestana === "source" ? vistaFuente(ruta, false)
      : vistaPreview();

    pintar(
      cuerpo,
      externo && generador
        ? aviso(
            `This world is written by ${generador.script}. Change it from the Generator tab and press Generate — editing the XML by hand works, but the next Generate overwrites it.`,
            "info"
          )
        : externo
        ? aviso(
            "This is an external world: there is no .studio.json beside it, so the property tree cannot rewrite it. Edit the XML directly below — everything else about it works normally.",
            "warn"
          )
        : null,
      sucio ? aviso("Unsaved changes. The .sdf on disk still holds the previous version.", "warn") : null,
      ...info.notas.map((n) => aviso(n, "warn")),
      el("div", { style: { border: "1px solid var(--border-main)" } }, tabs, el("div", { style: { padding: "0" } }, contenido))
    );
  }

  // --- pestaña: propiedades ---------------------------------------------

  function vistaPropiedades() {
    const s = spec;
    const alCambiar = () => marcarSucio();

    // Los ángulos se editan en grados aunque el SDF los guarde en radianes: un
    // heading de spawn es algo que se piensa en grados. La conversión pasa
    // aquí y en ningún otro sitio.
    const anguloPose = (arr, i) =>
      el("input", {
        type: "number",
        step: 1,
        value: Number(grados(arr[i]).toFixed(2)),
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) {
            arr[i] = radianes(v);
            marcarSucio();
          }
        },
      });

    // El árbol solo se repinta la PRIMERA vez que se ensucia: repintarlo en
    // cada tecla le robaría el foco al campo que se está escribiendo. Pero la
    // cuenta de FUEL tiene que seguir al número --- si no, dice "8 × 3" al lado
    // de un 200 --- así que esta parte se refresca a mano y en su propio nodo.
    const notaFuelNodo = el("span", notaFuel(s));
    const filasFuel = el("div");

    const camposFuel = () =>
      s.fuel > 0
        ? [
            prop(
              "Staging zone",
              el(
                "div.row",
                numeroEn(s.fuel_area, 0, { onchange: alCambiarFuel }),
                numeroEn(s.fuel_area, 1, { onchange: alCambiarFuel })
              ),
              { help: "world.fuel.zone", indent: 1, unidad: "m  ·  x y" }
            ),
            prop(
              "Zone centre",
              el(
                "div.row",
                numeroEn(s.fuel_centro, 0, { onchange: alCambiar }),
                numeroEn(s.fuel_centro, 1, { onchange: alCambiar })
              ),
              { help: "world.fuel.zone", indent: 1, unidad: "m" }
            ),
            prop("Drop height", numero(s, "fuel_altura", { step: 0.05, min: 0, onchange: alCambiar }), {
              help: "world.fuel.zone",
              indent: 1,
              unidad: "m above the floor",
            }),
            s.fuel > 60
              ? aviso(
                  `${s.fuel} FUEL is a lot of dynamic bodies. Watch the real-time factor: below ~0.95 the loop stops being representative, and this is the cheapest thing to cut.`,
                  "warn"
                )
              : null,
          ]
        : [];

    // La zona cambia la rejilla pero no qué campos hay: repintar el contenedor
    // entero mientras se escribe dentro de él se llevaría el foco.
    function alCambiarFuel() {
      pintar(notaFuelNodo, notaFuel(s));
      marcarSucio();
    }
    function refrescarFuel() {
      pintar(notaFuelNodo, notaFuel(s));
      pintar(filasFuel, ...camposFuel());
    }
    pintar(filasFuel, ...camposFuel());

    return el(
      "div",
      grupoProp("World", "worlds.managed"),
      propTexto("File", `worlds/${s.archivo}.sdf`),
      prop("World name", el("span.row", el("span.mono", "mars"), chip("fixed")), { help: "worlds.name-mars" }),
      prop("Description", texto(s, "descripcion", { placeholder: "What this world is for", onchange: alCambiar })),

      grupoProp("Physics", "world.physics.step"),
      prop("Step size", numero(s, "paso", { step: 0.001, min: 0.0001, max: 0.1, onchange: alCambiar }), {
        help: "world.physics.step",
        unidad: `s  ·  ${s.paso > 0 ? Math.round(1 / s.paso) : 0} Hz`,
      }),
      prop("Real-time factor", numero(s, "rtf", { step: 0.05, min: 0, onchange: alCambiar }), { help: "world.physics.rtf" }),
      prop("Engine", opciones(s, "motor_fisica", MOTORES, { onchange: alCambiar }), { help: "world.physics.engine" }),
      prop("Gravity Z", numero(s, "gravedad", { step: 0.1, onchange: alCambiar }), { help: "world.gravity", unidad: "m/s²" }),

      grupoProp("Ground", "world.ground"),
      prop("Ground plane", casilla(s, "suelo", { onchange: alCambiar }), { help: "world.ground" }),
      prop("Friction μ", numero(s, "friccion", { step: 0.05, min: 0, onchange: alCambiar }), { help: "world.friction", indent: 1 }),
      prop("Friction μ2", numero(s, "friccion2", { step: 0.05, min: 0, onchange: alCambiar }), { help: "world.friction", indent: 1 }),
      prop("Field length (X)", numero(s, "cancha_largo", { step: 0.1, min: 0.1, onchange: alCambiar }), {
        help: "world.field-size",
        indent: 1,
        unidad: "m",
      }),
      prop("Field width (Y)", numero(s, "cancha_ancho", { step: 0.1, min: 0.1, onchange: alCambiar }), {
        help: "world.field-size",
        indent: 1,
        unidad: "m",
      }),
      prop("Ground colour", color(s.color_suelo, { onchange: alCambiar }), { indent: 1 }),

      grupoProp("FRC field model", "world.field"),
      prop(
        "Field mesh",
        opciones(
          s,
          "campo",
          [
            ["", "None"],
            ...(estado.campos ?? []).filter((c) => c.instalado).map((c) => [c.ruta, c.nombre]),
          ],
          { onchange: alCambiar }
        ),
        { help: "world.field" }
      ),
      // Lo que el usuario necesita saber al ver el robot en el centro: no es un
      // error, es que el marco de Gazebo es el del CENTRO y quien traslada al
      // origen de esquina de WPILib es el bridge.
      prop(
        "Origin",
        el(
          "span.row",
          el("span.mono", "Gazebo (0, 0)"),
          el("span.dim", "="),
          el(
            "span.mono",
            `WPILib (${(s.cancha_largo / 2).toFixed(2)}, ${(s.cancha_ancho / 2).toFixed(2)})`
          )
        ),
        { help: "world.field.origin", indent: 1 }
      ),
      s.campo
        ? prop(
            "Mesh position",
            el(
              "div.row",
              numeroEn(s.campo_pose, 0, { onchange: alCambiar }),
              numeroEn(s.campo_pose, 1, { onchange: alCambiar }),
              numeroEn(s.campo_pose, 2, { onchange: alCambiar })
            ),
            { help: "world.field.origin", indent: 1, unidad: "m" }
          )
        : null,
      s.campo
        ? prop(
            "Mesh rotation",
            el("div.row", anguloPose(s.campo_pose, 3), anguloPose(s.campo_pose, 4), anguloPose(s.campo_pose, 5)),
            { help: "world.field", indent: 1, unidad: "deg" }
          )
        : null,
      s.campo
        ? prop("Mesh scale", numero(s, "campo_escala", { step: 0.01, min: 0.01, onchange: alCambiar }), {
            help: "world.field",
            indent: 1,
          })
        : null,

      grupoProp("FUEL (game pieces)", "world.fuel"),
      prop("Count", numero(s, "fuel", { step: 1, min: 0, max: 456, onchange: () => { refrescarFuel(); alCambiar(); } }), {
        help: "world.fuel",
        unidad: notaFuelNodo,
      }),
      filasFuel,

      grupoProp("Perimeter walls", "world.walls"),
      prop("Walls", casilla(s, "muros", { onchange: alCambiar }), { help: "world.walls" }),
      prop("Height", numero(s, "muro_alto", { step: 0.05, min: 0.01, onchange: alCambiar }), { indent: 1, unidad: "m" }),
      prop("Thickness", numero(s, "muro_grosor", { step: 0.01, min: 0.01, onchange: alCambiar }), { indent: 1, unidad: "m" }),

      grupoProp("Lighting and scene", "world.lighting"),
      prop("Sun", casilla(s, "sol", { onchange: alCambiar }), { help: "world.lighting" }),
      prop("Cast shadows", casilla(s, "sombras", { onchange: alCambiar }), { indent: 1 }),
      prop("Intensity", numero(s, "sol_intensidad", { step: 0.05, min: 0, max: 2, onchange: alCambiar }), { indent: 1 }),
      prop(
        "Direction",
        el(
          "div.row",
          numeroEn(s.sol_direccion, 0, { step: 0.1, onchange: alCambiar }),
          numeroEn(s.sol_direccion, 1, { step: 0.1, onchange: alCambiar }),
          numeroEn(s.sol_direccion, 2, { step: 0.1, onchange: alCambiar })
        ),
        { indent: 1, unidad: "x y z" }
      ),
      prop("Ambient light", numero(s, "ambiente", { step: 0.05, min: 0, max: 1, onchange: alCambiar }), { help: "world.scene" }),
      prop("Background", color(s.fondo, { onchange: alCambiar }), { help: "world.scene" }),

      grupoProp("Systems", "world.plugins"),
      prop("Physics", el("span.row", chip("always on", "ok"), el("span.dim", "gz-sim-physics-system")), { help: "world.plugins" }),
      prop("Scene broadcaster", el("span.row", chip("always on", "ok"), el("span.dim", "gz-sim-scene-broadcaster-system")), {
        help: "world.plugins",
      }),
      prop("User commands", casilla(s, "comandos_usuario", { onchange: alCambiar }), { help: "world.plugins" }),
      prop("Sensors (rendering)", casilla(s, "sensores", { onchange: alCambiar }), { help: "world.sensors" }),
      prop("IMU", casilla(s, "imu_system", { onchange: alCambiar }), { help: "robots.imu" }),
      prop(
        "Extra plugins",
        el("textarea", {
          rows: 2,
          placeholder: "One plugin filename per line",
          value: (s.plugins_extra ?? []).join("\n"),
          oninput: (e) => {
            s.plugins_extra = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
            marcarSucio();
          },
        }),
        { help: "world.plugins" }
      ),

      grupoProp("Robot", "world.robot-include"),
      prop("Include URI", texto(s, "robot_uri", { placeholder: "model://my-robot   (empty = robot defined inside the world)", onchange: alCambiar }), {
        help: "world.robot-include",
      }),
      prop(
        "Spawn position",
        el(
          "div.row",
          numeroEn(s.robot_pose, 0, { onchange: alCambiar }),
          numeroEn(s.robot_pose, 1, { onchange: alCambiar }),
          numeroEn(s.robot_pose, 2, { onchange: alCambiar })
        ),
        { help: "world.pose", indent: 1, unidad: "m" }
      ),
      prop(
        "Spawn rotation",
        el("div.row", anguloPose(s.robot_pose, 3), anguloPose(s.robot_pose, 4), anguloPose(s.robot_pose, 5)),
        { help: "world.pose", indent: 1, unidad: "deg" }
      )
    );
  }

  // --- pestaña: props ----------------------------------------------------

  function vistaObjetos() {
    const s = spec;

    const agregar = () => {
      // El modal se construye antes de existir, asi que la funcion de cierre
      // se captura por referencia: sin esto la fila elegida no tendria forma
      // de cerrar el dialogo que la contiene.
      const dialogo = {};
      const elegir = (base) => {
        s.props.push(nuevoProp(base, s.props.length + 1));
        sucio = true;
        dialogo.cerrar?.();
        pintarTodo();
      };
      Object.assign(
        dialogo,
        modal({
          titulo: "Add prop",
          svg: "game-piece.svg",
          ancho: 460,
          cuerpo: el(
            "div",
            el("div.doc", {
              html: `<p>Loose objects in the world: game pieces, obstacles, ramps, a wall to drive into.
                     A <strong>static</strong> one is scenery and costs the solver nothing; a dynamic
                     one takes part in the physics and needs a sensible mass.</p>`,
            }),
            el(
              "div.bevel",
              { style: { marginTop: "10px" } },
              el("div.bevel-title", el("span.label", "Shape")),
              ...PROPS_PREDEFINIDOS.map((base) =>
                el(
                  "div.list-row",
                  { onclick: () => elegir(base) },
                  el("img", { src: "icons/game-piece.svg", width: 15, height: 15, alt: "" }),
                  el("span", base.etiqueta),
                  el("span.desc", base.forma)
                )
              )
            )
          ),
          pie: (cerrar) => [boton("Cancel", { onclick: cerrar })],
        })
      );
    };

    if (!s.props.length) {
      return el(
        "div",
        { style: { padding: "14px" } },
        el(
          "div.row",
          { style: { marginBottom: "12px" } },
          boton("Add prop", { svg: "add-part.svg", variante: "primary", onclick: agregar })
        ),
        vacio("No props in this world", "Game pieces, obstacles and scenery go here")
      );
    }

    return el(
      "div",
      el(
        "div.row",
        { style: { padding: "10px 12px", borderBottom: "1px solid var(--border-main)", background: "var(--bg-panel)" } },
        boton("Add prop", { svg: "add-part.svg", variante: "primary", onclick: agregar }),
        el("span.dim", { style: { marginLeft: "auto", fontSize: "11px" } }, `${s.props.length} object${s.props.length === 1 ? "" : "s"}`)
      ),
      ...s.props.map((p, i) => filaProp(p, i, s, marcarSucio, pintarTodo))
    );
  }

  // --- pestaña: generador ------------------------------------------------
  //
  // El panel NO conoce ninguna opción: las pinta desde lo que el script declara
  // en su `--opciones`. Añadir una opción al generador la hace aparecer aquí
  // sola, que es la única forma de que la ventana y la terminal no se
  // desincronicen.

  function vistaGenerador() {
    // Los helpers ligan el control al objeto: escriben en `valores[nombre]`
    // ellos solos, asi que aqui no hace falta ningun onchange.
    const control = (o) =>
      o.tipo === "bool" ? casilla(valores, o.nombre)
      : o.tipo === "opcion" ? opciones(valores, o.nombre, o.opciones)
      : numero(valores, o.nombre, { step: 1, min: o.min, max: o.max });

    // La ayuda de cada opcion va DEBAJO de su fila y no en un tooltip: es la
    // diferencia entre "FUEL: 408" y "408 son todas y el mundo va a medio
    // tiempo real", que es justo lo que hay que saber antes de elegir.
    const fila = (o) => [
      prop(o.etiqueta ?? o.nombre, control(o), { unidad: o.unidad }),
      o.ayuda
        ? el("div", { style: { padding: "0 12px 10px 12px", marginTop: "-6px" } },
            el("span.dim", { style: { fontSize: "11px" } }, o.ayuda))
        : null,
    ];

    const salida = el("pre.log", { style: { height: "150px", border: "none", borderRadius: "0" } },
      salidaGen || "Nothing generated yet in this session.");

    const generar = async () => {
      try {
        salidaGen = await invoke("sim_generar_mundo", { ruta, valores });
        // El .sdf de disco cambió: la biblioteca lo relee y el editor con ella.
        await recargarBibliotecas();
        pintarTodo();
      } catch (e) {
        salidaGen = String(e.message ?? e);
        pintarTodo();
        reportar(e);
      }
    };

    return el(
      "div",
      el(
        "div.row",
        { style: { padding: "10px 12px", borderBottom: "1px solid var(--border-main)", background: "var(--bg-panel)" } },
        boton("Generate", { svg: "publish.svg", variante: "primary", onclick: generar }),
        boton("Defaults", {
          svg: "republish.svg",
          onclick: () => {
            for (const o of generador.opciones) valores[o.nombre] = o.defecto;
            pintarTodo();
          },
        }),
        el("span.dim", { style: { marginLeft: "auto", fontSize: "11px" } },
          `${generador.script}  ·  writes ${(generador.genera ?? []).join(", ")}`)
      ),
      el(
        "div",
        grupoProp("Options", "worlds.generator"),
        ...generador.opciones.flatMap(fila),
        el("div", { style: { padding: "10px 12px 0 12px" } },
          el("span.dim", { style: { fontSize: "11px" } }, "Output")),
        salida
      )
    );
  }

  // --- pestaña: fuente ---------------------------------------------------

  function vistaFuente(ruta, externo) {
    const area = el("textarea", { rows: 26, spellcheck: "false", style: { border: "none", borderRadius: "0" } }, "Loading…");
    let original = "";

    invoke("sim_leer_texto", { ruta })
      .then((t) => {
        original = t;
        area.value = t;
      })
      .catch((e) => {
        area.value = `Could not read ${ruta}:\n${e.message}`;
      });

    return el(
      "div",
      el(
        "div.row",
        { style: { padding: "10px 12px", borderBottom: "1px solid var(--border-main)", background: "var(--bg-panel)" } },
        boton("Save SDF", {
          svg: "publish.svg",
          variante: "primary",
          onclick: async () => {
            try {
              await invoke("sim_escribir_texto", { ruta, contenido: area.value });
              original = area.value;
              await recargarBibliotecas();
              refrescarPagina();
            } catch (e) {
              reportar(e);
            }
          },
        }),
        boton("Revert", { svg: "republish.svg", onclick: () => (area.value = original) }),
        el(
          "span.dim",
          { style: { marginLeft: "auto", fontSize: "11px" } },
          externo ? "External world — this is the only editor for it" : "Hand edits are overwritten if you save from Properties"
        )
      ),
      area
    );
  }

  // --- pestaña: preview --------------------------------------------------

  function vistaPreview() {
    const pre = el("pre.log", { style: { height: "520px", border: "none", borderRadius: "0" } }, "Generating…");
    invoke("sim_previsualizar_mundo", { spec })
      .then((sdf) => (pre.textContent = sdf))
      .catch((e) => (pre.textContent = e.message));
    return el(
      "div",
      el(
        "div.row",
        { style: { padding: "10px 12px", borderBottom: "1px solid var(--border-main)", background: "var(--bg-panel)" } },
        el("span.dim", { style: { fontSize: "11px" } }, "What Save would write. Nothing on disk has changed."),
        boton("Copy", {
          svg: "copy-value.svg",
          sm: true,
          onclick: () => navigator.clipboard?.writeText(pre.textContent).catch(reportar),
          title: "Copy XML",
        })
      ),
      pre
    );
  }

  return {
    titulo: `World Editor — ${info.archivo}`,
    meta: spec === null && info.gestionado ? "" : info.gestionado ? "managed" : "external",
    help: "worlds.managed",
    acciones: [
      boton("Save", {
        svg: "publish.svg",
        variante: "primary",
        sm: true,
        onclick: () => (spec ? guardar() : null),
        title: "Write the .sdf and its .studio.json",
      }),
      boton("Run this world", {
        svg: "play.svg",
        sm: true,
        onclick: () => {
          guardarPrefs({ mundo: ruta });
          navegar("launch");
        },
      }),
      boton("Library", { svg: "scene.svg", sm: true, onclick: () => navegar("worlds") }),
    ],
    cuerpo,
  };
}

// --- una tarjeta de prop --------------------------------------------------

function filaProp(p, i, spec, marcarSucio, repintar) {
  const dims =
    p.forma === "sphere"
      ? [["Radius", 0]]
      : p.forma === "cylinder"
      ? [["Radius", 0], ["Length", 1]]
      : [["Size X", 0], ["Size Y", 1], ["Size Z", 2]];

  const angulo = (idx) =>
    el("input", {
      type: "number",
      step: 5,
      value: Number(grados(p.pose[idx]).toFixed(2)),
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) {
          p.pose[idx] = radianes(v);
          marcarSucio();
        }
      },
    });

  return el(
    "div",
    { style: { borderBottom: "1px solid var(--border-main)" } },
    el(
      "div.prop-group",
      { style: { background: "var(--bg-panel-header)" } },
      el("img", { src: "icons/game-piece.svg", width: 12, height: 12, alt: "" }),
      p.nombre || `prop ${i + 1}`,
      el(
        "span",
        { style: { marginLeft: "auto", display: "flex", gap: "5px" } },
        boton("Duplicate", {
          svg: "duplicate.svg",
          sm: true,
          onclick: () => {
            spec.props.splice(i + 1, 0, { ...structuredClone(p), nombre: `${p.nombre}_copy` });
            marcarSucio();
            repintar();
          },
        }),
        boton("Remove", {
          svg: "delete.svg",
          sm: true,
          onclick: () => {
            spec.props.splice(i, 1);
            marcarSucio();
            repintar();
          },
        })
      )
    ),
    prop("Name", texto(p, "nombre", { onchange: marcarSucio }), { help: "world.props", indent: 1 }),
    prop(
      "Shape",
      opciones(p, "forma", FORMAS, {
        onchange: () => {
          marcarSucio();
          repintar();
        },
      }),
      { indent: 1 }
    ),
    p.forma === "mesh"
      ? prop("Mesh URI", texto(p, "malla", { placeholder: "model://my-model/meshes/part.dae", onchange: marcarSucio }), {
          help: "guide.sdf-model",
          indent: 1,
        })
      : null,
    ...dims.map(([etiqueta, idx]) =>
      prop(p.forma === "mesh" ? `Scale ${["X", "Y", "Z"][idx]}` : etiqueta, numeroEn(p.tamano, idx, { onchange: marcarSucio }), {
        indent: 2,
        unidad: p.forma === "mesh" ? "×" : "m",
      })
    ),
    prop("Static", casilla(p, "estatico", { onchange: marcarSucio }), { help: "world.props", indent: 1 }),
    p.estatico ? null : prop("Mass", numero(p, "masa", { step: 0.1, min: 0.001, onchange: marcarSucio }), { help: "world.props.mass", indent: 1, unidad: "kg" }),
    prop(
      "Position",
      el(
        "div.row",
        numeroEn(p.pose, 0, { onchange: marcarSucio }),
        numeroEn(p.pose, 1, { onchange: marcarSucio }),
        numeroEn(p.pose, 2, { onchange: marcarSucio })
      ),
      { help: "world.pose", indent: 1, unidad: "m" }
    ),
    prop("Rotation", el("div.row", angulo(3), angulo(4), angulo(5)), { help: "world.pose", indent: 1, unidad: "deg" }),
    prop("Colour", color(p.color, { onchange: marcarSucio }), { indent: 1 })
  );
}
