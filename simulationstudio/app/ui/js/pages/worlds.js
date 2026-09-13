// World Library: todos los .sdf de sim/worlds/, con lo que se pudo leer de
// cada uno y las acciones que operan sobre el seleccionado.
//
// La distinción que organiza la página es managed/external: un mundo creado
// aquí tiene su .studio.json al lado y se abre en el árbol de propiedades; uno
// escrito a mano solo se puede correr y editar como XML. Ver el tema de ayuda
// "worlds.managed" para por qué el editor se niega a regenerar el segundo.

import { bytes, el, estado, guardarPrefs, invoke, num, pintar, recargarBibliotecas } from "./../core.js";
import { navegar, refrescarPagina, reportar } from "./../shell.js";
import { aviso, boton, chip, confirmar, modal, panel, prop, propTexto, texto, vacio } from "./../ui.js";
import { elegirArchivo } from "./../browser.js";
import { PLANTILLAS, specDePlantilla } from "./../worldspec.js";

export function paginaWorlds() {
  let seleccionada = estado.prefs.mundoSeleccionado ?? estado.prefs.mundo ?? estado.mundos[0]?.ruta ?? null;
  if (!estado.mundos.some((m) => m.ruta === seleccionada)) seleccionada = estado.mundos[0]?.ruta ?? null;

  const detalle = el("div");
  const cuerpo = el("div.stack");

  function elegir(ruta) {
    seleccionada = ruta;
    guardarPrefs({ mundoSeleccionado: ruta });
    pintarTabla();
    pintarDetalle();
  }

  const tabla = el("tbody");

  function pintarTabla() {
    pintar(
      tabla,
      ...estado.mundos.map((m) =>
        el(
          "tr",
          { data: { selectable: "true", active: String(m.ruta === seleccionada) }, onclick: () => elegir(m.ruta) },
          el("td", el("span.row", el("img", { src: "icons/scene.svg", width: 14, height: 14, alt: "" }), m.archivo)),
          el("td", m.gestionado ? chip("managed", "accent") : chip("external")),
          el("td.mono", m.mundo || "—"),
          el("td.num", String(m.modelos)),
          el("td.num", String(m.plugins)),
          el("td.num", m.paso ? `${num(m.paso, 4)} s` : "—"),
          el("td.num.dim", bytes(m.bytes)),
          el("td", m.notas.length ? chip(`${m.notas.length} issue${m.notas.length > 1 ? "s" : ""}`, "warn") : chip("ok", "ok"))
        )
      )
    );
  }

  function pintarDetalle() {
    const m = estado.mundos.find((x) => x.ruta === seleccionada);
    if (!m) return pintar(detalle, vacio("Select a world above"));

    const esLanzable = estado.prefs.mundo === m.ruta;

    pintar(
      detalle,
      panel(
        m.archivo,
        {
          svg: "scene.svg",
          help: "worlds.library",
          acciones: m.gestionado ? chip("managed", "accent") : chip("external", "warn"),
        },
        el(
          "div",
          propTexto("Path", m.ruta),
          prop("World name", el("span.row", el("span.mono", m.mundo || "—"), m.mundo !== "mars" && chip("must be \"mars\"", "fail")), {
            help: "worlds.name-mars",
          }),
          m.descripcion ? propTexto("Description", m.descripcion) : null,
          propTexto("Models / includes / lights", `${m.modelos} / ${m.incluye} / ${m.luces}`),
          prop("Plugins", el("span.mono", String(m.plugins)), { help: "world.plugins" }),
          prop("Physics step", el("span.mono", m.paso ? `${m.paso} s  (${Math.round(1 / m.paso)} Hz)` : "—"), {
            help: "world.physics.step",
          }),
          prop("Real-time factor", el("span.mono", m.rtf ?? "—"), { help: "world.physics.rtf" }),
          propTexto("Size on disk", bytes(m.bytes))
        ),
        el(
          "div.row-wrap",
          { style: { marginTop: "10px" } },
          boton(m.gestionado ? "Open in editor" : "Open source", {
            svg: "grid.svg",
            variante: "primary",
            onclick: () => navegar("editor", { ruta: m.ruta }),
          }),
          boton(esLanzable ? "Selected for launch" : "Use for launch", {
            svg: "play.svg",
            disabled: esLanzable,
            onclick: () => {
              guardarPrefs({ mundo: m.ruta });
              navegar("launch");
            },
          }),
          boton("Duplicate", { svg: "duplicate.svg", onclick: () => duplicar(m) }),
          boton("Reveal in Explorer", { svg: "open-folder.svg", onclick: () => invoke("sim_revelar", { ruta: m.ruta }).catch(reportar) }),
          boton("Delete", { svg: "delete.svg", variante: "danger", onclick: () => borrar(m) })
        ),
        ...m.notas.map((n) => el("div", { style: { marginTop: "8px" } }, aviso(n, "warn")))
      )
    );
  }

  pintar(
    cuerpo,
    estado.mundos.length
      ? panel(
          "Worlds",
          { svg: "scene.svg", help: "worlds.library", flush: true },
          el(
            "div",
            { style: { maxHeight: "310px", overflowY: "auto" } },
            el(
              "table.grid",
              el(
                "thead",
                el(
                  "tr",
                  el("th", "File"),
                  el("th", "Kind"),
                  el("th", "World name"),
                  el("th.num", "Models"),
                  el("th.num", "Plugins"),
                  el("th.num", "Step"),
                  el("th.num", "Size"),
                  el("th", "Status")
                )
              ),
              tabla
            )
          )
        )
      : vacio("No worlds in sim/worlds/", "Create one with New world, or import an existing .sdf"),
    detalle
  );

  pintarTabla();
  pintarDetalle();

  return {
    titulo: "World Library",
    meta: `${estado.mundos.length} world${estado.mundos.length === 1 ? "" : "s"} in sim/worlds/`,
    help: "worlds.library",
    acciones: [
      boton("New world", { svg: "add.svg", sm: true, onclick: () => nuevoMundo() }),
      boton("Import", { svg: "import-model.svg", sm: true, onclick: () => importarMundo() }),
      boton("Reload", { svg: "republish.svg", sm: true, onclick: () => refrescarPagina() }),
    ],
    cuerpo,
  };
}

// --- acciones ------------------------------------------------------------

function duplicar(m) {
  const modelo = { nombre: `${m.archivo.replace(/\.sdf$/, "")}-copy` };
  modal({
    titulo: "Duplicate world",
    svg: "duplicate.svg",
    ancho: 430,
    cuerpo: el(
      "div",
      el("label.field-label", "New file name"),
      el("div.row", texto(modelo, "nombre", { placeholder: "my-world" }), el("span.unit", ".sdf")),
      el("p.dim", { style: { marginTop: "8px", fontSize: "11px" } }, "Letters, digits, dash and underscore only.")
    ),
    pie: (cerrar) => [
      boton("Cancel", { onclick: cerrar }),
      boton("Duplicate", {
        variante: "primary",
        onclick: async () => {
          try {
            const ruta = await invoke("sim_duplicar_mundo", { ruta: m.ruta, nombre: modelo.nombre.trim() });
            cerrar();
            await recargarBibliotecas();
            guardarPrefs({ mundoSeleccionado: ruta });
            refrescarPagina();
          } catch (e) {
            reportar(e);
          }
        },
      }),
    ],
  });
}

function borrar(m) {
  confirmar({
    titulo: "Delete world",
    mensaje: `Delete ${m.archivo} from sim/worlds/? ${
      m.gestionado ? "Its .studio.json goes with it. " : ""
    }This cannot be undone from inside the app.`,
    alAceptar: async () => {
      try {
        await invoke("sim_borrar_mundo", { ruta: m.ruta });
        await recargarBibliotecas();
        if (estado.prefs.mundo === m.ruta) guardarPrefs({ mundo: estado.mundos[0]?.ruta ?? "" });
        refrescarPagina();
      } catch (e) {
        reportar(e);
      }
    },
  });
}

/** Diálogo "New world": nombre, descripción y plantilla. */
export function nuevoMundo() {
  const modelo = { nombre: "new-world", descripcion: "" };
  let plantilla = "frc";

  const lista = el("div.bevel");
  const pintarLista = () =>
    pintar(
      lista,
      el("div.bevel-title", el("span.label", "Template")),
      ...PLANTILLAS.map((p) =>
        el(
          "div.list-row",
          {
            data: { active: String(plantilla === p.id) },
            onclick: () => {
              plantilla = p.id;
              pintarLista();
            },
          },
          el("img", { src: `icons/${p.svg}`, width: 15, height: 15, alt: "" }),
          el("span", p.nombre),
          el(
            "span.desc",
            p.pideCampo && !(estado.campos ?? []).some((c) => c.instalado)
              ? "No field installed — install one in Field Library first"
              : p.resumen
          )
        )
      )
    );
  pintarLista();

  modal({
    titulo: "New world",
    svg: "add.svg",
    ancho: 620,
    cuerpo: el(
      "div.stack",
      el(
        "div",
        el("label.field-label", "File name"),
        el("div.row", texto(modelo, "nombre", { placeholder: "my-world" }), el("span.unit", ".sdf"))
      ),
      el(
        "div",
        el("label.field-label", "Description (optional)"),
        texto(modelo, "descripcion", { placeholder: "What this world is for" })
      ),
      lista,
      el("div.doc", {
        html: `<p class="note">Every world generated here declares <code>&lt;world name="mars"&gt;</code>,
               the physics system and the scene broadcaster. Those three are what the rest of the
               simulation assumes exists.</p>`,
      })
    ),
    pie: (cerrar) => [
      boton("Cancel", { onclick: cerrar }),
      boton("Create and edit", {
        variante: "primary",
        svg: "add.svg",
        onclick: async () => {
          const nombre = modelo.nombre.trim();
          const spec = specDePlantilla(plantilla, nombre, (estado.campos ?? []).find((c) => c.instalado)?.ruta ?? "");
          spec.descripcion = modelo.descripcion.trim();
          try {
            const ruta = await invoke("sim_guardar_mundo", { spec });
            cerrar();
            await recargarBibliotecas();
            guardarPrefs({ mundoSeleccionado: ruta });
            navegar("editor", { ruta });
          } catch (e) {
            reportar(e);
          }
        },
      }),
    ],
  });
}

/** Importa un .sdf de cualquier parte del disco: elegir archivo, luego nombre. */
export function importarMundo() {
  elegirArchivo({
    titulo: "Import world — pick an .sdf",
    filtro: ["sdf", "world"],
    alElegir: (origen) => {
      const sugerido = (origen.split(/[\\/]/).pop() ?? "world")
        .replace(/\.(sdf|world)$/i, "")
        .replace(/[^A-Za-z0-9_-]/g, "-");
      const modelo = { nombre: sugerido };

      modal({
        titulo: "Import world",
        svg: "import-model.svg",
        ancho: 520,
        cuerpo: el(
          "div.stack",
          el("div", el("label.field-label", "Source"), el("div.mono.selectable", { style: { wordBreak: "break-all" } }, origen)),
          el(
            "div",
            el("label.field-label", "Copy into sim/worlds/ as"),
            el("div.row", texto(modelo, "nombre"), el("span.unit", ".sdf"))
          ),
          el("div.doc", {
            html: `<p>Any <code>meshes/</code>, <code>materials/</code> or <code>models/</code> folder
                   sitting next to the source is copied too — a world whose meshes arrive without
                   their files opens grey, and the only trace is in stderr.</p>
                   <p class="warn">After importing, check that the world declares
                   <code>&lt;world name="mars"&gt;</code> and carries the physics and scene-broadcaster
                   plugins. The library flags both for you.</p>`,
          })
        ),
        pie: (cerrar) => [
          boton("Cancel", { onclick: cerrar }),
          boton("Import", {
            variante: "primary",
            svg: "import-model.svg",
            onclick: async () => {
              try {
                const ruta = await invoke("sim_importar_mundo", { origen, nombre: modelo.nombre.trim() });
                cerrar();
                await recargarBibliotecas();
                guardarPrefs({ mundoSeleccionado: ruta });
                navegar("worlds");
              } catch (e) {
                reportar(e);
              }
            },
          }),
        ],
      });
    },
  });
}
