// Field Library: las canchas 3D disponibles y las que ya están en el proyecto.
//
// El formato es el de AdvantageScope --- carpeta con `config.json` y
// `model.glb` --- que es el mismo que ya consume el Field 3D de mars-desktop.
// Reusarlo significa que una cancha descargada allí sirve aquí sin convertir
// nada, y que esta página encuentre sola lo que el dashboard tenga instalado.

import { bytes, el, estado, invoke, num, pintar } from "./../core.js";
import { navegar, refrescarPagina, reportar } from "./../shell.js";
import { aviso, boton, chip, modal, panel, texto } from "./../ui.js";

export function paginaFields() {
  const cuerpo = el("div.stack", el("div.empty-state", "Looking for fields…"));

  async function cargar() {
    let campos;
    try {
      campos = await invoke("sim_campos");
    } catch (e) {
      return pintar(cuerpo, aviso(e.message));
    }
    estado.campos = campos;

    const enProyecto = campos.filter((c) => c.instalado);
    const disponibles = campos.filter((c) => !c.instalado);

    pintar(
      cuerpo,
      enProyecto.length
        ? panel(
            "In this project",
            { svg: "scene.svg", help: "world.field", flush: true },
            el(
              "table.grid",
              el(
                "thead",
                el(
                  "tr",
                  el("th", "Field"),
                  el("th", "Path"),
                  el("th.num", "Play area"),
                  el("th", "Origin"),
                  el("th.num", "Size"),
                  el("th", "")
                )
              ),
              el("tbody", ...enProyecto.map((c) => fila(c, true)))
            )
          )
        : aviso(
            "No field is installed in this project yet. Install one below, then pick it in the World Editor.",
            "info"
          ),

      disponibles.length
        ? panel(
            "Available from MARS Desktop",
            {
              svg: "packages.svg",
              help: "world.field.install",
              flush: true,
              acciones: el("span.dim", { style: { fontSize: "10.5px" } }, "%APPDATA%/MARS/assets3d"),
            },
            el(
              "table.grid",
              el(
                "thead",
                el(
                  "tr",
                  el("th", "Field"),
                  el("th", "Source"),
                  el("th.num", "Play area"),
                  el("th", "Origin"),
                  el("th.num", "Size"),
                  el("th", "")
                )
              ),
              el("tbody", ...disponibles.map((c) => fila(c, false)))
            )
          )
        : null,

      panel(
        "Where fields come from",
        { svg: "help.svg", help: "world.field" },
        el("div.doc", {
          html: `
            <p>A field is an <strong>AdvantageScope field asset</strong>: a folder holding
            <code>config.json</code> and <code>model.glb</code>. MARS Desktop downloads them in its
            Field 3D tab, and this page picks up whatever it has installed.</p>
            <p>Installing copies the folder into <code>sim/fields/</code> so the world does not
            depend on a path under <code>%APPDATA%</code> — a world that did would not open on
            anybody else's machine, and worlds are part of the repository.</p>
            <p class="note">The copy is also <strong>prepared for Gazebo</strong>. The official
            models declare nearly every material as fully metallic, and a metallic surface under a
            PBR renderer with no environment map reflects nothing but black — the field loads, the
            physics runs, and the screen shows a field-shaped black blob. Installing turns the
            metallic factor off, which is the same fix AdvantageScope applies by forcing
            <code>MeshPhongMaterial</code>.</p>
            <p class="warn">The 2026 field is about 2.9 M triangles. It goes into the world as a
            <strong>visual only</strong> — collision stays on the ground plane and the walls — so
            the physics and the real-time factor are unaffected, but the 3D window takes around
            half a minute to open with it.</p>`,
        })
      )
    );
  }

  function fila(c, instalado) {
    return el(
      "tr",
      el("td", el("span.row", el("img", { src: "icons/scene.svg", width: 14, height: 14, alt: "" }), c.nombre)),
      el("td.mono.dim", { title: instalado ? c.ruta : c.origen }, instalado ? c.ruta : c.fuente),
      el(
        "td.num.mono",
        c.largo_m > 0 ? `${num(c.largo_m, 2)} × ${num(c.ancho_m, 2)} m` : "—"
      ),
      el("td", chip(c.sistema)),
      el("td.num.dim", bytes(c.bytes)),
      el(
        "td",
        instalado
          ? boton("Use in a world", {
              sm: true,
              svg: "grid.svg",
              onclick: () => navegar("editor", { ruta: estado.prefs.mundoSeleccionado ?? estado.prefs.mundo }),
            })
          : boton("Install", { sm: true, variante: "primary", svg: "import-model.svg", onclick: () => instalar(c) })
      )
    );
  }

  function instalar(c) {
    const modelo = {
      nombre: c.nombre
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "field",
    };
    modal({
      titulo: "Install field",
      svg: "import-model.svg",
      ancho: 520,
      cuerpo: el(
        "div.stack",
        el("div", el("label.field-label", "Source"), el("div.mono.selectable", { style: { wordBreak: "break-all" } }, c.origen)),
        el(
          "div",
          el("label.field-label", "Copy into sim/fields/ as"),
          texto(modelo, "nombre")
        ),
        el("div.doc", {
          html: `<p>Copies ${bytes(c.bytes)} and prepares the mesh so Gazebo can render it. Takes a
                 few seconds.</p>`,
        })
      ),
      pie: (cerrar) => [
        boton("Cancel", { onclick: cerrar }),
        boton("Install", {
          variante: "primary",
          onclick: async () => {
            try {
              await invoke("sim_instalar_campo", { origen: c.origen, nombre: modelo.nombre.trim() });
              cerrar();
              await cargar();
            } catch (e) {
              reportar(e);
            }
          },
        }),
      ],
    });
  }

  cargar();

  return {
    titulo: "Field Library",
    meta: "FRC field models for the 3D world",
    help: "world.field",
    acciones: [boton("Reload", { svg: "republish.svg", sm: true, onclick: () => refrescarPagina() })],
    cuerpo,
  };
}
