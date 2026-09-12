#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! MARS Installer — instala, actualiza y desinstala el ecosistema MARS.
//!
//! Es una aplicación de ventana, no un script: la instalación descarga decenas
//! de megas, puede fallar por el proxy de la escuela y tiene una decisión real
//! que tomar (Full o Tools). Una barra que avanza y un mensaje de error que se
//! puede leer valen más que cualquier automatización silenciosa.
//!
//! Cómo se reparte el trabajo:
//!
//! - `plataforma`  — qué cambia entre Windows, Linux y macOS.
//! - `manifiesto`  — de dónde salen los archivos (releases de GitHub).
//! - `descarga`    — bajarlos con progreso y verificar el sha256.
//! - `paquete`     — abrir el .zip / .tar.gz.
//! - `integracion` — accesos directos, lista de programas, WebView2.
//! - `instalacion` — el orden de todo eso y el registro de lo que se hizo.
//!
//! Este archivo solo expone esos módulos como comandos y arranca la ventana.

mod descarga;
mod instalacion;
mod integracion;
mod manifiesto;
mod paquete;
mod plataforma;

use instalacion::{Estado, Opciones, Progreso, Registro};
use serde::Serialize;
use tauri::{Emitter, Manager};

/// Nombre del evento con el que la ventana sigue el progreso.
const EVENTO_PROGRESO: &str = "instalador://progreso";

/// Cómo se abrió el instalador.
///
/// Windows llama al desinstalador con `--uninstall` desde "Aplicaciones
/// instaladas". Es el mismo ejecutable: lo único que cambia es la pantalla con
/// la que abre.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Modo {
    Instalar,
    Desinstalar,
}

struct Arranque(Modo);

#[tauri::command]
fn modo_inicial(estado: tauri::State<'_, Arranque>) -> Modo {
    estado.0
}

#[tauri::command]
fn estado_instalacion() -> Estado {
    instalacion::estado()
}

/// Consulta la última release sin descargar nada. La usa la pantalla de
/// selección para mostrar versión y tamaño antes de comprometerse.
#[tauri::command]
async fn consultar_release(edicion: plataforma::Edicion) -> Result<manifiesto::PlanDescarga, String> {
    let mut plan = manifiesto::consultar(edicion).await.map_err(descriptivo)?;
    // Comparar versiones es cosa de números, no de texto: "1.9" no es mayor
    // que "1.10" aunque lo parezca alfabéticamente.
    plan.mas_nueva = instalacion::leer_registro()
        .map(|r| manifiesto::es_mas_nueva(&plan.release.version, &r.version));
    Ok(plan)
}

#[tauri::command]
async fn instalar(app: tauri::AppHandle, opciones: Opciones) -> Result<Registro, String> {
    // El callback emite al front; si la ventana ya no está, emitir falla y se
    // ignora: la instalación en curso no se aborta porque nadie mire.
    let app2 = app.clone();
    instalacion::instalar(opciones, move |p: Progreso| {
        let _ = app2.emit(EVENTO_PROGRESO, p);
    })
    .await
    .map_err(descriptivo)
}

#[tauri::command]
fn desinstalar(borrar_datos: bool) -> Result<String, String> {
    instalacion::desinstalar(borrar_datos).map_err(descriptivo)
}

/// Abre una app recién instalada y cierra el instalador.
#[tauri::command]
fn abrir_instalado(app: tauri::AppHandle, componente: String) -> Result<(), String> {
    let reg = instalacion::leer_registro().ok_or("no hay ninguna instalación registrada")?;
    let comp = if componente == plataforma::Componente::SimulationStudio.id() {
        plataforma::Componente::SimulationStudio
    } else {
        plataforma::Componente::MarsDesktop
    };
    let exe = reg.carpeta.join(comp.archivo_exe());
    if !exe.is_file() {
        return Err(format!("no encontré {}", exe.display()));
    }
    std::process::Command::new(&exe)
        // Igual que hace mars-desktop con el Studio: el directorio de trabajo
        // se pone en el del ejecutable para que encuentre lo que viaja al lado.
        .current_dir(exe.parent().unwrap_or(&reg.carpeta))
        .spawn()
        .map_err(|e| format!("no pude abrir {}: {e}", comp.nombre()))?;

    // Se cierra sola: quedarse abierta detrás de la app que acaba de lanzar no
    // le sirve a nadie.
    app.exit(0);
    Ok(())
}

/// Abre la carpeta de instalación en el explorador del sistema.
#[tauri::command]
fn abrir_carpeta(ruta: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(ruta, None::<&str>).map_err(|e| e.to_string())
}

/// Abre un enlace en el navegador.
///
/// Solo se llama con la URL de la release que devolvió la API de GitHub, pero
/// igual se comprueba el esquema: un `file://` o un `javascript:` acá no
/// tendrían ningún sentido y sí consecuencias.
#[tauri::command]
fn abrir_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("no abro un enlace que no sea https: {url}"));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// anyhow encadena causas; sin esto el front muestra solo la última línea, que
/// suele ser la menos útil ("archivo no encontrado" sin decir cuál).
fn descriptivo(e: anyhow::Error) -> String {
    let mut texto = e.to_string();
    for causa in e.chain().skip(1) {
        texto.push_str(&format!("\n  causa: {causa}"));
    }
    texto
}

fn main() {
    let modo = if std::env::args().any(|a| a == "--uninstall" || a == "/uninstall") {
        Modo::Desinstalar
    } else {
        Modo::Instalar
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arranque(modo))
        .setup(|app| {
            // Restos de una instalación interrumpida: si quedaron, la próxima
            // descarga los encontraría a medio bajar.
            descarga::limpiar_temporal();
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            modo_inicial,
            estado_instalacion,
            consultar_release,
            instalar,
            desinstalar,
            abrir_instalado,
            abrir_carpeta,
            abrir_url
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar MARS Installer");
}
