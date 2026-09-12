// Los componentes del chrome, como funciones que devuelven nodos.
//
// Son los mismos que mars-desktop tiene en React (Panel, PropertyRow,
// AlertBanner, EmptyState, StatusBadge, ToolbarButton) con el mismo look, pero
// sin framework: esta app no lleva toolchain de node, así que un "componente"
// es una función y las "props" son argumentos.

import { el, icono } from "./core.js";
import { ayuda } from "./help.js";

// --- paneles -------------------------------------------------------------

/**
 * Panel acoplable estilo QDockWidget (los "Displays"/"Views" de RViz): barra
 * de título sólida y contenido debajo, todo dentro de un borde fino.
 *
 * `opciones.help` pone el "?" en la barra de título; `opciones.acciones` va a
 * su derecha; `flush` quita el padding del cuerpo (listas y tablas lo quieren
 * pegado al borde).
 */
export function panel(titulo, { svg, help, acciones, flush } = {}, ...hijos) {
  return el(
    "div.panel",
    el(
      "div.panel-title",
      svg && icono(svg),
      el("span.label", titulo),
      el("span.right", help && ayuda(help), acciones)
    ),
    el(flush ? "div.panel-body.flush" : "div.panel-body", ...hijos)
  );
}

/** Panel con relieve (QGroupBox clásico), para el portal y las guías. */
export function bevel(titulo, { svg, help, acciones } = {}, ...hijos) {
  return el(
    "div.bevel",
    el(
      "div.bevel-title",
      svg && icono(svg),
      el("span.label", titulo),
      el("span.right", help && ayuda(help), acciones)
    ),
    ...hijos
  );
}

// --- filas de propiedades ------------------------------------------------

/** Fila `nombre | control` de 24 px, como el árbol de propiedades de RViz. */
export function prop(nombre, control, { help, indent = 0, unidad } = {}) {
  return el(
    "div.prop",
    { data: { indent } },
    el("div.name", nombre, help && ayuda(help)),
    el("div.value", control, unidad && el("span.unit", unidad))
  );
}

/** Cabecera de un grupo de filas de propiedades. */
export function grupoProp(nombre, help) {
  return el("div.prop-group", nombre, help && ayuda(help));
}

/** Fila de solo lectura: valor en monoespaciada, sin control. */
export function propTexto(nombre, valor, opciones) {
  return prop(nombre, el("span.mono", valor ?? "—"), opciones);
}

// --- controles ligados ---------------------------------------------------

/**
 * `<input type=number>` ligado a `objeto[clave]`.
 *
 * Nunca escribe NaN: un campo vacío o a medio teclear deja el modelo como
 * estaba, en vez de meterle un NaN que sale al SDF y hace que el motor muera
 * al parsear.
 */
export function numero(objeto, clave, { step = 0.01, min, max, onchange } = {}) {
  return el("input", {
    type: "number",
    value: objeto[clave],
    step,
    min,
    max,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) {
        objeto[clave] = v;
        onchange?.(v);
      }
    },
  });
}

/** Igual, pero sobre `objeto[clave][i]` (poses, direcciones, tamaños). */
export function numeroEn(arreglo, i, { step = 0.01, onchange } = {}) {
  return el("input", {
    type: "number",
    value: arreglo[i],
    step,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) {
        arreglo[i] = v;
        onchange?.(v);
      }
    },
  });
}

export function texto(objeto, clave, { placeholder, onchange } = {}) {
  return el("input", {
    type: "text",
    value: objeto[clave] ?? "",
    placeholder,
    spellcheck: "false",
    oninput: (e) => {
      objeto[clave] = e.target.value;
      onchange?.(e.target.value);
    },
  });
}

export function casilla(objeto, clave, { etiqueta, onchange } = {}) {
  const input = el("input", {
    type: "checkbox",
    checked: Boolean(objeto[clave]),
    onchange: (e) => {
      objeto[clave] = e.target.checked;
      onchange?.(e.target.checked);
    },
  });
  return etiqueta
    ? el("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", cursor: "pointer" } }, input, etiqueta)
    : input;
}

export function opciones(objeto, clave, lista, { onchange } = {}) {
  return el(
    "select",
    {
      onchange: (e) => {
        objeto[clave] = e.target.value;
        onchange?.(e.target.value);
      },
    },
    ...lista.map(([valor, etiqueta]) =>
      el("option", { value: valor, selected: String(objeto[clave]) === String(valor) }, etiqueta ?? valor)
    )
  );
}

/** Selector de color que habla en floats 0..1, como el SDF. */
export function color(arreglo, { onchange } = {}) {
  const hex = (c) => {
    const b = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
    return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
  };
  return el("input", {
    type: "color",
    value: hex(arreglo),
    oninput: (e) => {
      const n = parseInt(e.target.value.slice(1), 16);
      arreglo[0] = ((n >> 16) & 255) / 255;
      arreglo[1] = ((n >> 8) & 255) / 255;
      arreglo[2] = (n & 255) / 255;
      onchange?.();
    },
  });
}

// --- botones -------------------------------------------------------------

export function boton(etiqueta, { svg, onclick, variante, disabled, title, sm } = {}) {
  const clases = ["btn", variante && `btn-${variante}`, sm && "btn-sm"].filter(Boolean).join(".");
  return el(`button.${clases}`, { type: "button", onclick, disabled, title: title ?? etiqueta }, svg && icono(svg), etiqueta);
}

// --- avisos y vacíos -----------------------------------------------------

export function aviso(mensaje, variante = "error") {
  const svg = { ok: "status-ok.svg", warn: "status-warning.svg", info: "status-unknown.svg" }[variante] ?? "status-error.svg";
  return el("div.alert", { data: { variant: variante } }, icono(svg), el("span", mensaje));
}

export function vacio(mensaje, pista) {
  return el("div.empty-state", el("div", mensaje), pista && el("div.hint", pista));
}

export function chip(etiqueta, tono) {
  return el("span.chip", { data: tono ? { tone: tono } : {} }, etiqueta);
}

export function punto(tono) {
  return el("span.dot", { data: tono ? { tone: tono } : {} });
}

// --- pestañas ------------------------------------------------------------

/**
 * Barra de pestañas. `alCambiar(id)` se llama con el id elegido; el llamador
 * decide qué repintar.
 */
export function pestanas(items, activo, alCambiar) {
  return el(
    "div.tabs",
    ...items.map(([id, etiqueta, svg]) =>
      el(
        "div.tab",
        { data: { active: String(id === activo) }, onclick: () => alCambiar(id) },
        svg && icono(svg, 13),
        etiqueta
      )
    )
  );
}

// --- modal ---------------------------------------------------------------

/**
 * Diálogo modal. Devuelve `{ cerrar }`.
 *
 * `pie` recibe la función de cierre para que sus botones puedan cerrarlo, y
 * Escape cierra siempre: un modal del que no se sale con Escape es un modal
 * roto.
 */
export function modal({ titulo, svg, ancho, clase, cuerpo, pie, alCerrar }) {
  const caja = el(`div.modal${clase ? "." + clase : ""}`, ancho ? { style: { width: `${ancho}px` } } : {});
  const capa = el("div.overlay", { onmousedown: (e) => { if (e.target === capa) cerrar(); } }, caja);

  function cerrar() {
    capa.remove();
    document.removeEventListener("keydown", tecla);
    alCerrar?.();
  }
  function tecla(e) {
    if (e.key === "Escape") cerrar();
  }

  caja.append(
    el(
      "div.modal-title",
      svg && icono(svg),
      el("span", titulo),
      el("button.close", { type: "button", onclick: cerrar, title: "Close" }, "✕")
    ),
    cuerpo instanceof HTMLElement && cuerpo.classList.contains("modal-body") ? cuerpo : el("div.modal-body", cuerpo)
  );
  if (pie) caja.append(el("div.modal-footer", pie(cerrar)));

  document.addEventListener("keydown", tecla);
  document.body.appendChild(capa);
  return { cerrar, caja };
}

/** Confirmación destructiva. Nunca usa `window.confirm`: rompe el look. */
export function confirmar({ titulo, mensaje, etiquetaOk = "Delete", alAceptar }) {
  modal({
    titulo,
    svg: "status-warning.svg",
    ancho: 420,
    cuerpo: el("div.doc", el("p", mensaje)),
    pie: (cerrar) => [
      boton("Cancel", { onclick: cerrar }),
      boton(etiquetaOk, {
        variante: "stop",
        onclick: () => {
          cerrar();
          alAceptar();
        },
      }),
    ],
  });
}
