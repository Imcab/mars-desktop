// Help Topics: el índice completo de la ayuda contextual.
//
// Los mismos textos que abren los "?" de toda la app, leíbles de corrido. Un
// sistema de ayuda que solo se puede consultar tocando el control correcto no
// se puede leer entero, y hay cosas aquí (los perfiles, el reloj, la inercia
// reflejada) que conviene leer antes de necesitarlas.

import { el, pintar } from "./../core.js";
import { HELP, pintarTema, temasPorGrupo } from "./../help.js";
import { boton } from "./../ui.js";

export function paginaHelp() {
  const grupos = temasPorGrupo();
  let actual = "app.overview";

  const indice = el("div", { style: { width: "268px", flexShrink: "0" } });
  const lector = el("div.panel", { style: { flex: "1", minWidth: "0" } });

  function pintarLector() {
    pintar(
      lector,
      el(
        "div.panel-title",
        el("img", { src: "icons/help.svg", width: 14, height: 14, alt: "" }),
        el("span.label", HELP[actual]?.titulo ?? actual),
        el("span.right", el("span.mono.dim", actual))
      ),
      el("div.panel-body", pintarTema(el("div"), actual))
    );
  }

  function pintarIndice() {
    pintar(
      indice,
      ...grupos.map((g) =>
        el(
          "div.bevel",
          { style: { marginBottom: "10px" } },
          el("div.bevel-title", el("span.label", g.nombre)),
          el(
            "div",
            ...g.temas.map((t) =>
              el(
                "div.list-row",
                {
                  data: { active: String(t.id === actual) },
                  onclick: () => {
                    actual = t.id;
                    pintarIndice();
                    pintarLector();
                  },
                },
                el("img", { src: "icons/help.svg", width: 14, height: 14, alt: "" }),
                el("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.titulo)
              )
            )
          )
        )
      )
    );
  }

  pintarIndice();
  pintarLector();

  return {
    titulo: "Help Topics",
    meta: `${Object.keys(HELP).length} topics`,
    acciones: [
      boton("Overview", {
        svg: "help.svg",
        sm: true,
        onclick: () => {
          actual = "app.overview";
          pintarIndice();
          pintarLector();
        },
      }),
    ],
    cuerpo: el("div", { style: { display: "flex", gap: "14px", alignItems: "flex-start" } }, indice, lector),
  };
}
