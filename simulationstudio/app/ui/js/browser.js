// El selector de archivos.
//
// La app no lleva `tauri-plugin-dialog`: una dependencia más para abrir un
// cuadro de "elegí un .sdf", que es su único uso del disco. Se hace con
// `std::fs` del lado de Rust (`estudio::explorar`) y con este diálogo del
// lado de la UI, que además encaja con el resto del chrome --- un selector
// nativo de Windows 11, con sus esquinas redondeadas, se vería como una
// ventana de otro programa.

import { bytes, el, icono, invoke, pintar } from "./core.js";
import { aviso, boton, modal, vacio } from "./ui.js";

/**
 * Abre el selector. `filtro` son extensiones sin punto, en minúscula
 * (`["sdf"]`); vacío muestra todos los archivos.
 *
 * Llama a `alElegir(rutaAbsoluta)` y cierra.
 */
export function elegirArchivo({ titulo = "Open file", filtro = [], inicio = null, alElegir }) {
  let dir = inicio;
  let seleccion = null;

  const rutaTexto = el("span.p");
  const lista = el("div.browser-list");
  const lateral = el("div.browser-side");
  const error = el("div", { style: { padding: "0 12px" } });
  const btnArriba = boton("Up", { svg: "open-folder.svg", sm: true, onclick: () => subir() });

  const cuerpo = el(
    "div.modal-body",
    { style: { padding: "0", display: "flex", flexDirection: "column", minHeight: "0", flex: "1" } },
    el("div.browser-path", btnArriba, rutaTexto),
    error,
    el("div.browser-body", lateral, lista)
  );

  let padre = null;
  const abrir = modal({
    titulo,
    svg: "open-folder.svg",
    clase: "browser",
    cuerpo,
    pie: (cerrar) => [
      el("span.left", el("span.mono.dim", { id: "browser-sel" }, "No file selected")),
      boton("Cancel", { onclick: cerrar }),
      boton("Open", {
        variante: "primary",
        onclick: () => {
          if (!seleccion) return;
          cerrar();
          alElegir(seleccion);
        },
      }),
    ],
  });

  const etiquetaSel = abrir.caja.querySelector("#browser-sel");
  const btnAbrir = abrir.caja.querySelector(".modal-footer .btn-primary");
  btnAbrir.disabled = true;

  function subir() {
    if (padre) cargar(padre);
  }

  async function cargar(destino) {
    try {
      const r = await invoke("sim_explorar", { dir: destino, filtro });
      dir = r.dir;
      padre = r.padre;
      seleccion = null;
      etiquetaSel.textContent = "No file selected";
      btnAbrir.disabled = true;
      btnArriba.disabled = !padre;
      rutaTexto.textContent = r.dir;
      pintar(error);

      pintar(
        lateral,
        ...r.atajos.map((a) =>
          el("div.tree-row", { onclick: () => cargar(a.ruta), title: a.ruta }, icono("open-folder.svg"), a.nombre)
        )
      );

      if (!r.entradas.length) {
        pintar(lista, vacio("This folder is empty", filtro.length ? `filter: *.${filtro.join(", *.")}` : null));
        return;
      }

      pintar(
        lista,
        ...r.entradas.map((e) => {
          const fila = el(
            "div.list-row",
            {
              title: e.ruta,
              // Doble click entra en la carpeta o confirma el archivo: es lo
              // que hace cualquier selector y lo que la mano espera.
              ondblclick: () => {
                if (e.carpeta) cargar(e.ruta);
                else {
                  abrir.cerrar();
                  alElegir(e.ruta);
                }
              },
              onclick: () => {
                if (e.carpeta) return cargar(e.ruta);
                seleccion = e.ruta;
                etiquetaSel.textContent = e.nombre;
                btnAbrir.disabled = false;
                lista.querySelectorAll(".list-row").forEach((f) => f.removeAttribute("data-active"));
                fila.dataset.active = "true";
              },
            },
            icono(e.carpeta ? "open-folder.svg" : "model-file.svg"),
            el("span", e.nombre),
            !e.carpeta && el("span.desc", bytes(e.bytes))
          );
          return fila;
        })
      );
    } catch (e) {
      pintar(error, aviso(e.message));
    }
  }

  cargar(dir);
}
