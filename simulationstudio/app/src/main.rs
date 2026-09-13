//! MARS Simulation Studio: la aplicación de simulación.
//!
//! Es un proceso APARTE de mars-desktop, a propósito. mars-desktop es el
//! dashboard y solo lleva un botón que lanza esta app; todo lo de Gazebo vive
//! aquí. Así la simulación puede reiniciarse, colgarse o actualizarse sin
//! tocar la app que el equipo usa en competencia, y las dependencias pesadas
//! (el entorno conda entero) no entran en el bundle del dashboard.
//!
//! Esta app NO dibuja el robot: eso ya lo hace mars-desktop, que recibe las
//! poses por NT4 igual que de un robot real, y lo hace la ventana de Gazebo,
//! que es la que muestra la física. Lo que sí hace es todo lo demás: arrancar
//! y supervisar la simulación, y ser el editor de los mundos y de los mapas de
//! robot que la alimentan.
//!
//! Las responsabilidades están partidas en dos módulos porque son dos riesgos
//! distintos: `supervisor` lanza y mata procesos, `estudio` escribe archivos.
//! Un fallo en el editor no tiene por qué poder tocar el código que mata.
//!
//! Uso:
//!   mars-sim-app                          abre la ventana
//!   mars-sim-app --headless [segundos]    arranca, espera y para (para CI)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod estudio;
mod supervisor;

use std::sync::Mutex;

use estudio::{CampoInfo, Explorador, MundoInfo, MundoSpec, RobotInfo};
use supervisor::{Chequeo, Config, Estado, Supervisor};
use tauri::{Manager, State};

struct Estados(Mutex<Supervisor>);

/// Toma el supervisor y saca de él el `sim/`, que es lo que necesita casi todo
/// `estudio`. El lock se suelta antes de tocar el disco: leer veinte SDFs con
/// el supervisor bloqueado congelaría el sondeo de estado de la UI.
macro_rules! sim_dir {
    ($estado:expr) => {{
        let s = $estado.0.lock().map_err(|e| e.to_string())?;
        s.sim_dir().to_path_buf()
    }};
}

/// El python del entorno conda y el `sim/`, que es lo que necesitan los
/// generadores. El python es el del entorno y no el del sistema a proposito:
/// los scripts usan tomllib y lo que traiga el entorno, no lo que el usuario
/// tenga instalado por su cuenta.
fn python_y_sim(estado: &State<Estados>) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    let s = estado.0.lock().map_err(|e| e.to_string())?;
    Ok((s.sim_dir().to_path_buf(), s.conda_env().join("python.exe")))
}

/// `anyhow::Error` -> el string que ve la UI, con la cadena de contextos.
fn ay<T>(r: anyhow::Result<T>) -> Result<T, String> {
    r.map_err(|e| format!("{e:#}"))
}

// --- comandos: arrancar y parar ----------------------------------------

#[derive(serde::Serialize)]
struct Opciones {
    mundos: Vec<String>,
    robots: Vec<String>,
    sim_dir: String,
    conda_dir: Option<String>,
    /// La del crate. La que la interfaz escribe en pantalla es
    /// MSS_VERSION (ui/js/constants.js): esta viaja igual para que un
    /// reporte de fallo pueda decir que binario estaba corriendo.
    version: String,
}

#[tauri::command]
fn sim_opciones(estado: State<Estados>) -> Result<Opciones, String> {
    let s = estado.0.lock().map_err(|e| e.to_string())?;
    Ok(Opciones {
        mundos: s.mundos(),
        robots: s.robots(),
        sim_dir: s.sim_dir().display().to_string(),
        conda_dir: Some(s.conda_env().display().to_string()),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
fn sim_arrancar(cfg: Config, estado: State<Estados>) -> Result<(), String> {
    let mut s = estado.0.lock().map_err(|e| e.to_string())?;
    ay(s.arrancar(&cfg))
}

#[tauri::command]
fn sim_detener(estado: State<Estados>) -> Result<(), String> {
    let mut s = estado.0.lock().map_err(|e| e.to_string())?;
    s.detener();
    Ok(())
}

#[tauri::command]
fn sim_estado(estado: State<Estados>) -> Result<Estado, String> {
    let mut s = estado.0.lock().map_err(|e| e.to_string())?;
    Ok(s.estado())
}

#[derive(serde::Serialize)]
struct Logs {
    motor: String,
    mundo: String,
    bridge: String,
}

#[tauri::command]
fn sim_logs(lineas: Option<usize>, estado: State<Estados>) -> Result<Logs, String> {
    let s = estado.0.lock().map_err(|e| e.to_string())?;
    let n = lineas.unwrap_or(40).clamp(10, 500);
    // El .err es donde cada proceso escribe lo que importa cuando algo falla;
    // el .log lleva el arranque normal. Se concatenan para no obligar a la UI a
    // tener dos paneles por proceso.
    let par = |base: &str| format!("{}\n{}", s.log(&format!("{base}.log"), n), s.log(&format!("{base}.err"), n));
    Ok(Logs {
        motor: par("app-motor"),
        mundo: par("app-mundo"),
        bridge: par("app-bridge"),
    })
}

#[tauri::command]
fn sim_diagnostico(estado: State<Estados>) -> Result<Vec<Chequeo>, String> {
    let s = estado.0.lock().map_err(|e| e.to_string())?;
    Ok(s.diagnostico())
}

// --- comandos: biblioteca de mundos y robots ---------------------------

#[tauri::command]
fn sim_mundos_detalle(estado: State<Estados>) -> Result<Vec<MundoInfo>, String> {
    Ok(estudio::mundos_detalle(&sim_dir!(estado)))
}

#[tauri::command]
fn sim_robots_detalle(estado: State<Estados>) -> Result<Vec<RobotInfo>, String> {
    Ok(estudio::robots_detalle(&sim_dir!(estado)))
}

#[tauri::command]
fn sim_mundo_spec(ruta: String, estado: State<Estados>) -> Result<Option<MundoSpec>, String> {
    ay(estudio::leer_spec(&sim_dir!(estado), &ruta))
}

#[tauri::command]
fn sim_guardar_mundo(spec: MundoSpec, estado: State<Estados>) -> Result<String, String> {
    ay(estudio::guardar_mundo(&sim_dir!(estado), &spec))
}

/// El SDF que saldría de un spec, sin escribir nada. Es lo que alimenta la
/// pestaña de vista previa del editor: ver el XML antes de guardarlo es la
/// diferencia entre confiar en el generador y comprobarlo.
#[tauri::command]
fn sim_previsualizar_mundo(spec: MundoSpec) -> Result<String, String> {
    Ok(estudio::generar_sdf(&spec))
}

/// Lo que el generador de este mundo declara que se le puede tocar, o `null`
/// si el mundo no lo tiene. El panel de opciones sale de aqui.
#[tauri::command]
fn sim_generador(ruta: String, estado: State<Estados>) -> Result<Option<serde_json::Value>, String> {
    let (dir, python) = python_y_sim(&estado)?;
    ay(estudio::opciones_generador(&dir, &python, &ruta))
}

/// Regenera el mundo con esos valores y devuelve lo que imprimio el script.
#[tauri::command]
fn sim_generar_mundo(
    ruta: String,
    valores: serde_json::Value,
    estado: State<Estados>,
) -> Result<String, String> {
    let (dir, python) = python_y_sim(&estado)?;
    ay(estudio::generar_mundo(&dir, &python, &ruta, &valores))
}

#[tauri::command]
fn sim_duplicar_mundo(ruta: String, nombre: String, estado: State<Estados>) -> Result<String, String> {
    ay(estudio::duplicar_mundo(&sim_dir!(estado), &ruta, &nombre))
}

#[tauri::command]
fn sim_borrar_mundo(ruta: String, estado: State<Estados>) -> Result<(), String> {
    ay(estudio::borrar_mundo(&sim_dir!(estado), &ruta))
}

#[tauri::command]
fn sim_importar_mundo(
    origen: String,
    nombre: Option<String>,
    estado: State<Estados>,
) -> Result<String, String> {
    ay(estudio::importar_mundo(
        &sim_dir!(estado),
        &origen,
        nombre.as_deref().filter(|n| !n.is_empty()),
    ))
}

// --- comandos: canchas -------------------------------------------------

#[tauri::command]
fn sim_campos(estado: State<Estados>) -> Result<Vec<CampoInfo>, String> {
    Ok(estudio::campos(&sim_dir!(estado)))
}

#[tauri::command]
fn sim_instalar_campo(
    origen: String,
    nombre: String,
    estado: State<Estados>,
) -> Result<String, String> {
    ay(estudio::instalar_campo(&sim_dir!(estado), &origen, &nombre))
}

// --- comandos: archivos ------------------------------------------------

#[tauri::command]
fn sim_leer_texto(ruta: String, estado: State<Estados>) -> Result<String, String> {
    ay(estudio::leer_texto(&sim_dir!(estado), &ruta))
}

#[tauri::command]
fn sim_escribir_texto(
    ruta: String,
    contenido: String,
    estado: State<Estados>,
) -> Result<(), String> {
    ay(estudio::escribir_texto(&sim_dir!(estado), &ruta, &contenido))
}

#[tauri::command]
fn sim_explorar(dir: Option<String>, filtro: Option<Vec<String>>) -> Result<Explorador, String> {
    ay(estudio::explorar(dir.as_deref(), &filtro.unwrap_or_default()))
}

#[tauri::command]
fn sim_revelar(ruta: String, estado: State<Estados>) -> Result<(), String> {
    ay(estudio::revelar(&sim_dir!(estado), &ruta))
}

// --- comandos: preferencias --------------------------------------------

#[tauri::command]
fn sim_prefs(estado: State<Estados>) -> Result<serde_json::Value, String> {
    Ok(estudio::prefs(&sim_dir!(estado)))
}

#[tauri::command]
fn sim_guardar_prefs(prefs: serde_json::Value, estado: State<Estados>) -> Result<(), String> {
    ay(estudio::guardar_prefs(&sim_dir!(estado), &prefs))
}

// --- modo sin ventana ----------------------------------------------------

/// Arranca, espera y para. Existe para que el supervisor sea verificable en CI,
/// donde no hay pantalla: sin esto la única forma de probarlo sería a mano.
fn headless(segundos: u64) -> Result<(), String> {
    let mut s = Supervisor::descubrir().map_err(|e| format!("{e:#}"))?;
    // Sin ventana por defecto: en CI no hay pantalla. Con MARS_CON_VENTANA=1 se
    // incluye, que es la forma de probar el camino COMPLETO del botón Start sin
    // tener que darle a un botón.
    s.sin_ventana(std::env::var("MARS_CON_VENTANA").is_err());
    println!("[app] sim at {}", s.sim_dir().display());

    let mundos = s.mundos();
    let robots = s.robots();
    println!("[app] {} worlds, {} robot maps", mundos.len(), robots.len());

    // El swerve si está, que es el robot del equipo; si no, el primero.
    let robot = robots
        .iter()
        .find(|r| r.contains("swerve"))
        .or_else(|| robots.first())
        .ok_or("there is no robot map at all")?
        .clone();
    let mundo = if robot.contains("swerve") {
        "worlds/swerve.sdf".to_string()
    } else {
        "worlds/testbot.sdf".to_string()
    };

    let cfg = Config {
        world: mundo.clone(),
        robot_map: robot.clone(),
        nt_host: "127.0.0.1".into(),
        nt_port: 5810,
    };
    println!("[app] starting {mundo} with {robot}");
    s.arrancar(&cfg).map_err(|e| format!("{e:#}"))?;

    let mut ultimo = Estado {
        corriendo: false,
        motor_pid: None,
        mundo_pid: None,
        bridge_pid: None,
        segundos: 0,
        caido: None,
    };
    for _ in 0..segundos {
        std::thread::sleep(std::time::Duration::from_secs(1));
        ultimo = s.estado();
        if !ultimo.corriendo {
            break;
        }
    }

    if let Some(motivo) = &ultimo.caido {
        eprintln!("[app] {motivo}");
        eprintln!("--- engine ---\n{}", s.log("app-motor.err", 15));
        eprintln!("--- bridge ---\n{}", s.log("app-bridge.err", 15));
        return Err("the simulation died on its own".into());
    }
    println!(
        "[app] engine pid {:?}, window pid {:?}, bridge pid {:?}, up {} s",
        ultimo.motor_pid, ultimo.mundo_pid, ultimo.bridge_pid, ultimo.segundos
    );

    s.detener();
    // Después de detener, los dos tienen que estar muertos. Comprobarlo es lo
    // que distingue "pedimos que pararan" de "pararon".
    let despues = s.estado();
    if despues.motor_pid.is_some() || despues.bridge_pid.is_some() {
        return Err("processes were still alive after stopping".into());
    }

    println!("[app] OK: started, stayed up and stopped cleanly");
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--headless") {
        let segundos = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(8);
        if let Err(e) = headless(segundos) {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
        return;
    }

    let supervisor = match Supervisor::descubrir() {
        Ok(s) => s,
        Err(e) => {
            // Sin supervisor no hay app. Vale más morir con el motivo que abrir
            // una ventana que no puede hacer nada.
            eprintln!("FAILED: {e:#}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(Estados(Mutex::new(supervisor)))
        .invoke_handler(tauri::generate_handler![
            sim_opciones,
            sim_arrancar,
            sim_detener,
            sim_estado,
            sim_logs,
            sim_diagnostico,
            sim_mundos_detalle,
            sim_robots_detalle,
            sim_mundo_spec,
            sim_guardar_mundo,
            sim_previsualizar_mundo,
            sim_generador,
            sim_generar_mundo,
            sim_duplicar_mundo,
            sim_borrar_mundo,
            sim_importar_mundo,
            sim_campos,
            sim_instalar_campo,
            sim_leer_texto,
            sim_escribir_texto,
            sim_explorar,
            sim_revelar,
            sim_prefs,
            sim_guardar_prefs
        ])
        .on_window_event(|window, event| {
            // Cerrar la ventana tiene que matar la simulación. En Windows matar
            // al padre no mata a los hijos, así que sin esto quedan un motor y
            // un bridge huérfanos ocupando los tópicos de gz-transport: el
            // siguiente arranque ve dos motores publicando y las poses se
            // pisan, sin ningún error.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(estados) = window.try_state::<Estados>() {
                    if let Ok(mut s) = estados.0.lock() {
                        s.detener();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("could not start MARS Simulation Studio");
}
