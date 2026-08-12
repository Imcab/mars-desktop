#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod nt4;
mod subsystem_gen;

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;
use std::collections::HashMap;
use regex::Regex;

use nt4::client::{NT4Client, NT4State};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MarsSettings {
    pub team_number: String,
    pub workspace_path: String,
    pub tools_path: String,
    pub auto_save_deploy: bool,
}

impl Default for MarsSettings {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        MarsSettings {
            team_number: "3472".to_string(),
            workspace_path: String::new(),
            tools_path: home.join("MARSTools").to_string_lossy().to_string(),
            auto_save_deploy: true,
        }
    }
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
    let path = get_mars_config_path();
    
    if !path.exists() {
        return Ok(MarsSettings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Error reading config.json: {}", e))?;

    let settings: MarsSettings = serde_json::from_str(&content)
        .unwrap_or_else(|_| MarsSettings::default());

    Ok(settings)
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

#[tauri::command]
async fn create_mars_project(project_name: String, workspace_path: String, team_number: String) -> Result<String, String> {
    let target_path = PathBuf::from(&workspace_path).join(&project_name);

    let status = Command::new("git")
        .arg("clone")
        .arg("https://github.com/STZ-Robotics/MarsTemplate.git")
        .arg(&target_path)
        .status()
        .map_err(|e| format!("Error at executing git: {}", e))?;

    if !status.success() {
        return Err("Failed at creating a MARS Template, check your connection".into());
    }

    let git_folder = target_path.join(".git");
    if git_folder.exists() {
        let _ = fs::remove_dir_all(&git_folder);
    }

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

#[tauri::command]
fn read_project_units(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(project_path).join("ProjectUnits.json");
    
    if !path.exists() {
        return Err("ProjectUnits.json no encontrado en la raíz del proyecto.".into());
    }

    fs::read_to_string(path).map_err(|e| format!("Error leyendo el archivo de unidades: {}", e))
}

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

fn main() {
    let nt4_state = NT4State(Arc::new(Mutex::new(NT4Client::new())));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(nt4_state)
        .invoke_handler(tauri::generate_handler![
            read_mars_settings,
            write_mars_settings,
            create_mars_project,
            get_local_ip,
            validate_mars_project,
            read_project_units,
            read_manifest_features,
            get_installed_packages,
            install_package_from_json,
            subsystem_gen::derive_java_package,
            subsystem_gen::check_unit_processor,
            subsystem_gen::generate_mars_subsystem,
            nt4::commands::connect_sim,
            nt4::commands::connect_real,
            nt4::commands::disconnect_nt,
            nt4::commands::get_live_values,
            nt4::commands::get_values_at,
            nt4::commands::get_values_range,
            nt4::commands::get_time_bounds
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}