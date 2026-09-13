#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets3d;
mod nt4;

// --- Editions --------------------------------------------------------------
//
// Everything the MARS framework needs lives behind the `mars` feature, which is
// on by default. The Tools edition is compiled with `--no-default-features` and
// these modules, their commands and their dependencies never reach the binary:
// it is not a hidden button, it is code that is not compiled. The front end
// does the same through the `@mars` alias (see src/mars/README.md).
#[cfg(feature = "mars")]
mod feature_gen;
#[cfg(feature = "mars")]
mod simlauncher;
#[cfg(feature = "mars")]
mod source_map;
#[cfg(feature = "mars")]
mod subsystem_gen;
// Las plantillas viajan dentro del binario y solo las usan create_mars_project
// y el wizard de features, los dos detras de `mars`: en la edicion Tools ni se
// compilan ni ocupan los 220 KB.
#[cfg(feature = "mars")]
mod templates;

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use std::path::Path;

// Only the framework's commands use these (cloning the template, reading
// Manifest.java, running gradle). Without the `mars` feature nothing does.
#[cfg(feature = "mars")]
use std::collections::HashMap;
#[cfg(feature = "mars")]
use std::process::Command;
#[cfg(feature = "mars")]
use regex::Regex;

use nt4::client::{NT4Client, NT4State};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Destino del servidor NT4. Determina el puerto al que se conecta la app:
/// el roboRIO/simulador publica en 5810, la Driver Station reexpone los datos
/// en 6767 (en localhost) y Systemcore usa 6810.
pub const NT_PORT_DEFAULT: u16 = 5810;
pub const NT_PORT_DS: u16 = 6767;
pub const NT_PORT_SYSTEMCORE: u16 = 6810;

/// Techo para `read_binary_file`. Una malla de robot bien hecha pesa unos
/// pocos MB; mas alla de esto casi seguro se eligio el archivo equivocado y
/// cargarlo dejaria la webview sin memoria.
const MAX_MODEL_BYTES: u64 = 256 * 1024 * 1024;

fn default_nt_target() -> String { "default".to_string() }
fn default_nt_retention_minutes() -> u32 { 15 }
fn default_nt_custom_port() -> u16 { NT_PORT_DEFAULT }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MarsSettings {
    pub team_number: String,
    pub workspace_path: String,
    pub tools_path: String,
    pub auto_save_deploy: bool,

    // Los campos de NT4 llevan #[serde(default)] a propósito: sin eso, un
    // config.json escrito por una versión anterior no deserializa y el
    // fallback a Default borraría el equipo y las rutas ya guardadas.
    /// "default" | "ds" | "systemcore" | "custom"
    #[serde(default = "default_nt_target")]
    pub nt_target: String,
    /// Puerto usado solo cuando nt_target == "custom".
    #[serde(default = "default_nt_custom_port")]
    pub nt_custom_port: u16,
    /// Reemplaza la dirección derivada del número de equipo. Vacío = usar el
    /// equipo. Sirve para USB (172.22.11.2), mDNS o una IP fija de pruebas.
    #[serde(default)]
    pub nt_custom_address: String,
    /// Minutos de historial que guarda el buffer. 0 = sin límite.
    #[serde(default = "default_nt_retention_minutes")]
    pub nt_retention_minutes: u32,

    // Identidad para publicar features. Se guarda acá y no en el wizard para
    // que el segundo paquete que haga el equipo salga ya prellenado.
    /// Nombre que va en el campo `author` de MarsFeature.json.
    #[serde(default)]
    pub feature_author: String,
    /// Usuario u organización de GitHub bajo la que se publican las features.
    #[serde(default)]
    pub github_user: String,
}

impl Default for MarsSettings {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        MarsSettings {
            team_number: "3472".to_string(),
            workspace_path: String::new(),
            tools_path: home.join("MARSTools").to_string_lossy().to_string(),
            auto_save_deploy: true,
            nt_target: default_nt_target(),
            nt_custom_port: default_nt_custom_port(),
            nt_custom_address: String::new(),
            nt_retention_minutes: default_nt_retention_minutes(),
            feature_author: String::new(),
            github_user: String::new(),
        }
    }
}

impl MarsSettings {
    /// Puerto NT4 efectivo según el destino elegido.
    pub fn nt_port(&self) -> u16 {
        match self.nt_target.as_str() {
            "ds" => NT_PORT_DS,
            "systemcore" => NT_PORT_SYSTEMCORE,
            "custom" => self.nt_custom_port,
            _ => NT_PORT_DEFAULT,
        }
    }
}

/// Lectura de la config sin pasar por el comando de Tauri, para que el módulo
/// NT4 pueda resolver dirección y puerto sin que el front tenga que mandarlos
/// en cada `connect`.
pub fn load_mars_settings() -> MarsSettings {
    let path = get_mars_config_path();
    if !path.exists() {
        return MarsSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(MarsSettings::default)
}

fn get_mars_config_path() -> PathBuf {
    let config_dir = dirs::config_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    let mars_dir = config_dir.join("MARS");
    
    if !mars_dir.exists() {
        let _ = fs::create_dir_all(&mars_dir);
    }
    
    mars_dir.join("config.json")
}

#[tauri::command]
fn read_mars_settings() -> Result<MarsSettings, String> {
    Ok(load_mars_settings())
}

// --- Workspace (pestañas + su configuración) --------------------------------
//
// Sin esto todo el estado de la app vive solo en memoria de React: los tabs,
// los widgets del Display, las fuentes del Swerve y del Mechanism se pierden al
// cerrar. El layout se guarda como JSON opaco a propósito -- el shape lo define
// el front (WorkspaceTab), y el backend no tiene por qué conocerlo.

fn workspace_path(path: Option<String>) -> PathBuf {
    match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => {
            let config_dir = dirs::config_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
            let mars_dir = config_dir.join("MARS");
            if !mars_dir.exists() {
                let _ = fs::create_dir_all(&mars_dir);
            }
            mars_dir.join("workspace.json")
        }
    }
}

#[tauri::command]
fn save_workspace(layout: serde_json::Value, path: Option<String>) -> Result<String, String> {
    let target = workspace_path(path);
    let json = serde_json::to_string_pretty(&layout)
        .map_err(|e| format!("Error serializing layout: {}", e))?;
    fs::write(&target, json)
        .map_err(|e| format!("Error saving layout: {}", e))?;
    Ok(target.display().to_string())
}

/// `Ok(None)` = todavía no hay layout guardado, que NO es un error: es lo que
/// pasa la primera vez que se abre la app.
#[tauri::command]
fn load_workspace(path: Option<String>) -> Result<Option<serde_json::Value>, String> {
    let target = workspace_path(path);
    if !target.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&target)
        .map_err(|e| format!("Error reading layout: {}", e))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Layout file is corrupt: {}", e))
}

#[tauri::command]
fn write_mars_settings(settings: MarsSettings) -> Result<(), String> {
    let path = get_mars_config_path();

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Error serializating: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Error saving config.json: {}", e))?;

    Ok(())
}

#[cfg(feature = "mars")]
#[tauri::command]
async fn create_mars_project(project_name: String, workspace_path: String, team_number: String) -> Result<String, String> {
    let target_path = PathBuf::from(&workspace_path).join(&project_name);

    // `git clone` refused to write into a folder that already had something in
    // it, and that refusal was doing real work: without it, creating a project
    // with a name that already exists writes over whatever is there. The check
    // has to be explicit now that the files come from inside the binary.
    if target_path.exists()
        && fs::read_dir(&target_path).map(|mut d| d.next().is_some()).unwrap_or(false)
    {
        return Err(format!("{} already exists and is not empty.", target_path.display()));
    }

    // The template is embedded (see templates.rs): no clone, so no network, no
    // git, and no .git to delete afterwards.
    templates::extract(templates::PROJECT, &target_path)?;

    if let Ok(team_num) = team_number.parse::<u32>() {
        let wpilib_prefs = target_path.join(".wpilib").join("wpilib_preferences.json");
        if wpilib_prefs.exists() {
            if let Ok(content) = fs::read_to_string(&wpilib_prefs) {
                if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                    json["teamNumber"] = serde_json::json!(team_num);
                    if let Ok(new_content) = serde_json::to_string_pretty(&json) {
                        let _ = fs::write(&wpilib_prefs, new_content);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd")
        .args(["/C", "code", target_path.to_str().unwrap_or("")])
        .spawn();

    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("code")
        .arg(&target_path)
        .spawn();

    Ok(format!("Proyect created at {}", workspace_path))
}

/// Escribe un archivo binario desde base64. Se usa para el PNG del gráfico
/// (un canvas solo sabe devolver un data URL) y para el JSON de gains. Va en
/// base64 y no como Vec<u8> porque por IPC eso se convertiría en un array
/// JSON de cientos de miles de números.
#[tauri::command]
fn save_base64_file(path: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;

    // El front puede mandar el data URL completo o solo la carga útil.
    let payload = base64_data
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&base64_data);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Invalid image data: {}", e))?;

    fs::write(&path, bytes).map_err(|e| format!("Could not save image: {}", e))?;
    Ok(path)
}

/// Lee un archivo binario del disco y lo devuelve como bytes crudos.
/// Se usa para los modelos 3D (.stl/.glb) que el usuario elige con el dialog:
/// van por `ipc::Response` y no como Vec<u8> porque eso se serializaria a un
/// array JSON de millones de numeros para una malla de unos pocos MB.
#[tauri::command]
fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Could not open {}: {}", path, e))?;
    if meta.len() > MAX_MODEL_BYTES {
        return Err(format!(
            "File is too large ({:.1} MB); the limit is {} MB.",
            meta.len() as f64 / 1_048_576.0,
            MAX_MODEL_BYTES / 1_048_576,
        ));
    }

    let bytes = fs::read(&path).map_err(|e| format!("Could not read {}: {}", path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Escribe un archivo de texto UTF-8. Lo usa el export de configuraciones
/// (por ahora el del Mechanism 3D), que son JSON legibles y no binarios: pasar
/// por `save_base64_file` obligaria a codificar y decodificar sin motivo.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<String, String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {}", parent.display(), e))?;
        }
    }
    fs::write(&path, contents).map_err(|e| format!("Could not write {}: {}", path, e))?;
    Ok(path)
}

#[tauri::command]
fn get_local_ip() -> Result<String, String> {

    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Error abriendo socket: {}", e))?;

    match socket.connect("8.8.8.8:80") {
        Ok(_) => {
            match socket.local_addr() {
                Ok(addr) => Ok(addr.ip().to_string()),
                Err(_) => Ok("127.0.0.1".to_string())
            }
        }
        Err(_) => Ok("127.0.0.1".to_string())
    }
}

#[cfg(feature = "mars")]
#[tauri::command]
fn validate_mars_project(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let mars_folder = p.join("workspace-mars");

    if !mars_folder.exists() {
        return Err("The selected folder is not a valid MARS project (missing 'workspace-mars' directory).".into());
    }

    let name = p.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown Project")
        .to_string();

    Ok(name)
}

#[cfg(feature = "mars")]
#[tauri::command]
fn read_project_units(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(project_path).join("ProjectUnits.json");
    
    if !path.exists() {
        return Err("ProjectUnits.json no encontrado en la raíz del proyecto.".into());
    }

    fs::read_to_string(path).map_err(|e| format!("Error leyendo el archivo de unidades: {}", e))
}

#[cfg(feature = "mars")]
#[tauri::command]
fn read_manifest_features(project_path: String) -> Result<HashMap<String, bool>, String> {
    // Construimos la ruta asumiendo la estructura estándar de FRC
    // Asegúrate de ajustar "frc/robot" si tu paquete se llama distinto
    let path = PathBuf::from(project_path)
        .join("src")
        .join("main")
        .join("java")
        .join("frc")
        .join("robot")
        .join("configuration")
        .join("Manifest.java");

    if !path.exists() {
        return Err("Manifest.java no encontrado en la ruta esperada.".into());
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Error leyendo el Manifest: {}", e))?;

    let mut features = HashMap::new();
    
    // Esta expresión regular busca exactamente: public static final boolean HAS_ALGO = true/false;
    let re = Regex::new(r"public static final boolean\s+(HAS_[A-Z0-9_]+)\s*=\s*(true|false)\s*;").unwrap();

    for cap in re.captures_iter(&content) {
        let name = cap[1].to_string(); // Ej: "HAS_INTAKE"
        let value = &cap[2] == "true"; // Convierte el texto "true" a un booleano real
        features.insert(name, value);
    }

    Ok(features)
}

#[cfg(feature = "mars")]
#[tauri::command]
fn get_installed_packages(project_path: String) -> Result<Vec<serde_json::Value>, String> {
    let features_dir = PathBuf::from(&project_path).join("workspace-mars").join("features");
    let mut packages = Vec::new();

    if features_dir.exists() {
        if let Ok(entries) = fs::read_dir(features_dir) {
            for entry in entries.flatten() {
                if entry.path().extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(entry.path()) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            packages.push(json);
                        }
                    }
                }
            }
        }
    }
    Ok(packages)
}

#[cfg(feature = "mars")]
#[tauri::command]
async fn install_package_from_json(project_path: String, feature_data: String) -> Result<String, String> {
    // 1. Parsear y extraer el ID
    let json: serde_json::Value = serde_json::from_str(&feature_data).map_err(|e| format!("Invalid JSON: {}", e))?;
    let feature_id = json["featureId"].as_str().ok_or("Missing featureId in JSON")?;
    
    // 2. Crear carpetas y guardar
    let features_dir = PathBuf::from(&project_path).join("workspace-mars").join("features");
    if !features_dir.exists() {
        fs::create_dir_all(&features_dir).map_err(|e| format!("Failed creating directory: {}", e))?;
    }
    
    let file_path = features_dir.join(format!("{}.json", feature_id));
    fs::write(file_path, &feature_data).map_err(|e| format!("Failed saving file: {}", e))?;
    
    // 3. Compilar Gradle de forma ligera
    // 3. Compilar Gradle de forma ligera (CORREGIDO PARA TERMINAL)
    let status = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "gradlew.bat", "build", "-x", "test"])
            .current_dir(&project_path)
            .status()
            .map_err(|e| format!("Failed executing gradle (cmd): {}", e))?
    } else {
        Command::new("sh")
            .args(["-c", "./gradlew build -x test"])
            .current_dir(&project_path)
            .status()
            .map_err(|e| format!("Failed executing gradle (sh): {}", e))?
    };
        
    if status.success() {
        let name = json["name"].as_str().unwrap_or(feature_id);
        Ok(format!("{} installed successfully!", name))
    } else {
        Err("Gradle build failed in the background.".to_string())
    }

}

/// Registers the command handler with the base list plus whatever is passed in.
///
/// `tauri::generate_handler!` takes no per-line attributes, and a builder only
/// accepts ONE `invoke_handler` (the second silently replaces the first). So the
/// base list lives in a macro and each edition calls it once with its own extra
/// commands, rather than duplicating forty names.
macro_rules! register_commands {
    ($builder:expr $(, $extra:path)* $(,)?) => {
        $builder.invoke_handler(tauri::generate_handler![
            read_mars_settings,
            write_mars_settings,
            save_workspace,
            load_workspace,
            save_base64_file,
            read_binary_file,
            write_text_file,
            get_local_ip,
            assets3d::asset3d_store_dir,
            assets3d::list_asset3d_packs,
            assets3d::install_asset3d_zip,
            assets3d::download_asset3d,
            assets3d::import_asset3d_folder,
            assets3d::delete_asset3d_pack,
            nt4::commands::connect_sim,
            nt4::commands::connect_real,
            nt4::commands::disconnect_nt,
            nt4::commands::get_live_values,
            nt4::commands::get_values_at,
            nt4::commands::get_values_range,
            nt4::commands::get_time_bounds,
            nt4::commands::set_value,
            nt4::commands::unpublish_value,
            nt4::commands::get_jitter_stats,
            nt4::commands::set_buffer_retention_minutes,
            nt4::commands::get_nt_link_status,
            nt4::commands::get_bandwidth_report,
            nt4::commands::export_wpilog,
            nt4::commands::open_wpilog,
            nt4::commands::close_log
            $(, $extra)*
        ])
    };
}

fn main() {
    let nt4_state = NT4State(Arc::new(Mutex::new(NT4Client::new())));
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(nt4_state);

    #[cfg(feature = "mars")]
    let builder = register_commands!(
        builder,
        create_mars_project,
        validate_mars_project,
        read_project_units,
        read_manifest_features,
        get_installed_packages,
        install_package_from_json,
        subsystem_gen::derive_java_package,
        subsystem_gen::check_unit_processor,
        subsystem_gen::generate_mars_subsystem,
        feature_gen::create_mars_feature,
        feature_gen::read_project_vendordeps,
        simlauncher::sim_app_disponible,
        simlauncher::abrir_sim_app,
        source_map::find_topic_source,
        source_map::open_in_editor,
    );

    #[cfg(not(feature = "mars"))]
    let builder = register_commands!(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
