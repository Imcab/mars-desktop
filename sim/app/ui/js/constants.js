// Constantes de la interfaz: lo que no viene del backend y se escribe en más
// de un sitio.
//
// Versión de MARS Simulation Studio
// --------------------------------
// Fuente única: de acá salen la línea "STUDIO x" del portal de bienvenida, la
// del About, la esquina de la barra de estado y la fila de Diagnostics. Antes
// cada una leía `sim_opciones().version` --- la versión del crate --- y caía a
// un "0.1.0" escrito a mano cuando el backend todavía no había respondido, así
// que el número del menú principal dependía de cuándo se pintara la pantalla.
//
// Si se toca, hay que tocar también sim/app/Cargo.toml y
// sim/app/tauri.conf.json: esos dos los lee el instalador, no la interfaz.

export const MSS_VERSION = "0.9.4"

/** Como se escribe cuando va sola, sin la palabra "version" al lado. */
export const MSS_VERSION_LABEL = `v${MSS_VERSION}`

/**
 * Versión del protocolo que hablan motor, puente y código del robot. Va aparte
 * de la de la app a propósito: la interfaz se mueve mucho más rápido que el
 * contrato de NT4, y mezclarlas haría creer que cada release lo rompe.
 */
export const MSS_PROTOCOL_VERSION = "0.1.0"
