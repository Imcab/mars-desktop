// La pantalla de carga.
//
// La versión anterior era una barra indeterminada y una línea de texto: decía
// "está haciendo algo", que es justo lo que no hace falta saber. Esta enumera
// los pasos REALES del arranque, marca cada uno cuando termina y mueve la
// barra con ellos, así que cuando algo tarda o falla se ve exactamente qué.
//
// Los pasos no son decorativos: cada uno es una llamada al backend, y el que
// falla se queda marcado en rojo con su error debajo. Antes, cualquier fallo
// daba el mismo mensaje genérico para los cinco.

const $ = (id) => document.getElementById(id);

/** Los pasos, en el orden en que ocurren. `clave` la usa `Progreso`. */
export const PASOS = [
  ["puente", "Connect to the application process"],
  ["opciones", "Locate sim/ and the conda environment"],
  ["prefs", "Read preferences"],
  ["mundos", "Scan worlds"],
  ["robots", "Scan robot maps"],
  ["campos", "Scan field models"],
  ["chequeos", "Check the installation"],
  ["ui", "Build the interface"],
];

export class Progreso {
  constructor() {
    this.hecho = 0;
    this.filas = new Map();

    const lista = $("splash-steps");
    if (!lista) return;
    lista.replaceChildren();
    for (const [clave, etiqueta] of PASOS) {
      const marca = document.createElement("span");
      marca.className = "mark";
      marca.textContent = "·";
      const texto = document.createElement("span");
      texto.textContent = etiqueta;
      const nota = document.createElement("em");

      const li = document.createElement("li");
      li.dataset.state = "pending";
      li.append(marca, texto, nota);
      lista.appendChild(li);
      this.filas.set(clave, { li, marca, nota });
    }
  }

  /** Marca el paso como en curso y lo pone en la línea de estado. */
  empezar(clave) {
    const f = this.filas.get(clave);
    const etiqueta = PASOS.find((p) => p[0] === clave)?.[1] ?? clave;
    if (f) {
      f.li.dataset.state = "running";
      f.marca.textContent = "›";
    }
    const paso = $("splash-step");
    if (paso) paso.textContent = `${etiqueta}…`;
  }

  /** Lo cierra en verde. `detalle` es el resumen corto de lo que encontró. */
  terminar(clave, detalle) {
    const f = this.filas.get(clave);
    if (f) {
      f.li.dataset.state = "ok";
      f.marca.textContent = "✓";
      if (detalle) f.nota.textContent = detalle;
    }
    this.hecho += 1;
    const pct = Math.round((this.hecho / PASOS.length) * 100);
    const fill = $("splash-fill");
    if (fill) fill.style.width = `${pct}%`;
    const etiqueta = $("splash-pct");
    if (etiqueta) etiqueta.textContent = `${pct}%`;
  }

  /**
   * Lo cierra en rojo y deja el error a la vista.
   *
   * No cierra la ventana ni sigue: si el paso 2 falla, los siguientes no
   * pueden funcionar y fingir lo contrario solo produce un segundo error más
   * confuso que el primero.
   */
  fallar(clave, error) {
    const f = this.filas.get(clave);
    if (f) {
      f.li.dataset.state = "fail";
      f.marca.textContent = "✕";
    }
    const paso = $("splash-step");
    if (paso) paso.textContent = "Startup failed";
    const barra = $("splash-fill");
    if (barra) barra.style.background = "var(--status-error)";

    const caja = $("splash-error");
    if (caja) {
      caja.textContent = error?.message ?? String(error);
      caja.style.display = "block";
    }
  }

  /**
   * Corre un paso: lo marca, espera, y lo cierra en verde o en rojo.
   * Devuelve lo que devolvió `fn`, o `null` si falló.
   */
  async correr(clave, fn, resumen) {
    this.empezar(clave);
    try {
      const r = await fn();
      this.terminar(clave, resumen ? resumen(r) : undefined);
      return r;
    } catch (e) {
      this.fallar(clave, e);
      throw e;
    }
  }
}

/** Funde la pantalla de carga y la quita del DOM. */
export function cerrarSplash() {
  const s = $("splash");
  if (!s) return;
  s.classList.add("out");
  setTimeout(() => s.remove(), 300);
}
