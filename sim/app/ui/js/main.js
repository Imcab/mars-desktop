// Arranque.
//
// Orden importante: primero el manejador de errores, después todo lo demás.
// La primera versión de esta app moría al leer `window.__TAURI__` --- estaba
// apagado en tauri.conf.json --- y como el manejador se instalaba más abajo,
// la ventana se quedaba en "buscando la simulación" sin decir absolutamente
// nada. Una UI muerta que no explica por qué es peor que una que no abre.

import { estado, invoke, tauriListo } from "./core.js";
import { montar, navegar, ponerRutaSim, refrescarEstado } from "./shell.js";
import { Progreso, cerrarSplash } from "./splash.js";
import { abrirBienvenida } from "./welcome.js";

window.addEventListener("error", (e) => {
  console.error(e.error ?? e.message);
  const caja = document.getElementById("splash-error");
  if (caja && !document.querySelector(".app-root")) {
    caja.textContent = `The interface failed to start: ${e.message}`;
    caja.style.display = "block";
  }
});
window.addEventListener("unhandledrejection", (e) => console.error(e.reason));

async function arrancar() {
  const p = new Progreso();

  try {
    // El primer paso es comprobar el puente, no usarlo: si `withGlobalTauri`
    // está apagado, todos los demás fallarían con el mismo error inútil.
    await p.correr("puente", async () => {
      if (!tauriListo) {
        throw new Error(
          "window.__TAURI__ is undefined — withGlobalTauri must be true in tauri.conf.json."
        );
      }
    });

    estado.opciones = await p.correr(
      "opciones",
      () => invoke("sim_opciones"),
      (o) => o.sim_dir
    );

    estado.prefs = await p.correr(
      "prefs",
      async () => (await invoke("sim_prefs")) ?? {},
      (prefs) => (Object.keys(prefs).length ? "restored" : "first run")
    );

    estado.mundos = await p.correr(
      "mundos",
      () => invoke("sim_mundos_detalle"),
      (m) => `${m.length} found`
    );

    estado.robots = await p.correr(
      "robots",
      () => invoke("sim_robots_detalle"),
      (r) => `${r.length} found`
    );

    // Las canchas se cargan al arrancar y no solo al abrir su página: el
    // editor de mundos necesita la lista para poder ofrecerlas.
    estado.campos = await p.correr(
      "campos",
      () => invoke("sim_campos"),
      (c) => {
        const puestos = c.filter((x) => x.instalado).length;
        return puestos ? `${puestos} installed` : `${c.length} available`;
      }
    );

    // Los chequeos no bloquean el arranque: la app abre igual con la
    // instalación rota, porque la página Diagnostics es justamente donde se
    // arregla. Pero conviene saberlo antes de darle a Start, así que el
    // resultado se resume aquí.
    const chequeos = await p.correr(
      "chequeos",
      () => invoke("sim_diagnostico"),
      (c) => {
        const mal = c.filter((x) => x.estado === "fail").length;
        return mal ? `${mal} problem${mal > 1 ? "s" : ""}` : "all good";
      }
    );
    estado.chequeos = chequeos;

    await p.correr("ui", async () => {
      montar();
      // Después de montar y no antes: `ponerRutaSim` escribe en un nodo de la
      // barra de menú, y esa barra no existe hasta aquí.
      ponerRutaSim(estado.opciones.sim_dir);
      navegar(estado.prefs.ultimaPagina ?? "launch", null, true);
    });
  } catch {
    // `Progreso` ya dejó el paso marcado en rojo con su motivo. Quedarse en la
    // pantalla de carga es deliberado: es donde está la explicación.
    return;
  }

  // El sondeo es lo único que corre solo: estado de los procesos a 700 ms, que
  // es rápido para notar una caída y lento para no costar nada.
  const sondear = async () => {
    try {
      const s = await invoke("sim_estado");
      refrescarEstado(s);
      await estado.tick?.(s);
    } catch (e) {
      console.warn(e);
    }
  };
  await sondear();
  setInterval(sondear, 700);

  cerrarSplash();

  // El portal se abre después del splash, no encima: dos capas a la vez sobre
  // una ventana que todavía no se ha visto es desconcertante.
  setTimeout(() => abrirBienvenida(), 360);
}

arrancar();
