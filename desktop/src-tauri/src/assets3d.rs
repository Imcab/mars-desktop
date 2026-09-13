//! Almacén en disco de los assets 3D (canchas y robots) del Field 3D.
//!
//! El formato es el MISMO que usa AdvantageScope: una carpeta por asset con un
//! `config.json` y uno o varios `model*.glb`. Respetarlo al pie de la letra
//! permite instalar los paquetes oficiales tal como salen del .zip, sin
//! convertir ni renombrar nada, y que un equipo que ya arma sus assets para
//! AdvantageScope los reuse acá sin trabajo extra.
//!
//! Los paquetes se COPIAN al almacén en vez de guardarse como rutas sueltas:
//! una cancha son ~20 MB repartidos en varios archivos, y guardar la ruta de
//! la carpeta de Descargas deja el layout roto en cuanto el usuario la ordena.
//!
//! La DESCARGA y la descompresión también viven acá y no en el front. No es
//! una preferencia: GitHub no manda cabeceras CORS en las descargas de sus
//! releases (ni en el 302 ni en la respuesta final), así que un `fetch` desde
//! el webview falla siempre con "Failed to fetch". Desde Rust no hay origen
//! que valga y además los bytes no cruzan el IPC.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Techo por archivo dentro de un paquete. Un modelo de cancha bien hecho pesa
/// unos 20 MB; mucho más que esto casi seguro es el archivo equivocado.
const MAX_ASSET_FILE_BYTES: u64 = 128 * 1024 * 1024;

/// Extensiones que se copian al instalar. Todo lo demás del .zip se ignora a
/// propósito: un paquete de terceros no tiene por qué poder dejar ejecutables
/// ni scripts en una carpeta de la app.
const ALLOWED_EXTENSIONS: [&str; 6] = ["json", "glb", "gltf", "bin", "png", "jpg"];

#[derive(Serialize)]
pub struct AssetPack {
    /// Nombre de la carpeta; es la clave con la que el layout referencia el asset.
    pub folder: String,
    pub path: String,
    /// Texto crudo de config.json. El front lo parsea: el shape lo define él.
    pub config: String,
    /// Nombres de los .glb que trae, ordenados (model.glb, model_0.glb, ...).
    pub models: Vec<String>,
    pub bytes: u64,
}

fn store_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    base.join("MARS").join("assets3d")
}

/// Un nombre que viene de un .zip de terceros no se usa nunca tal cual: sin
/// esto, una entrada llamada `../../config.json` escribiría fuera del almacén.
fn safe_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Empty file name".to_string());
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(part)), None) => Ok(part.to_string_lossy().to_string()),
        _ => Err(format!("Unsafe name: {}", name)),
    }
}

fn has_allowed_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Ordena `model.glb` primero y después `model_0`, `model_1`, ... por número.
/// Un orden alfabético dejaría `model_10` antes que `model_2`, y el índice de
/// cada modelo es lo que empareja las piezas de juego con el config.
fn model_rank(name: &str) -> (u8, u32) {
    let stem = name.trim_end_matches(".glb").trim_end_matches(".gltf");
    match stem.strip_prefix("model_") {
        Some(rest) => (1, rest.parse::<u32>().unwrap_or(u32::MAX)),
        None => (0, 0),
    }
}

fn read_pack(entry: &Path) -> Option<AssetPack> {
    let config = fs::read_to_string(entry.join("config.json")).ok()?;

    let mut models: Vec<String> = Vec::new();
    let mut bytes: u64 = 0;
    for file in fs::read_dir(entry).ok()? {
        let file = match file {
            Ok(f) => f,
            Err(_) => continue,
        };
        let name = file.file_name().to_string_lossy().to_string();
        if let Ok(meta) = file.metadata() {
            if meta.is_file() {
                bytes += meta.len();
            }
        }
        if name.ends_with(".glb") || name.ends_with(".gltf") {
            models.push(name);
        }
    }
    models.sort_by_key(|name| model_rank(name));

    Some(AssetPack {
        folder: entry.file_name()?.to_string_lossy().to_string(),
        path: entry.to_string_lossy().to_string(),
        config,
        models,
        bytes,
    })
}

#[tauri::command]
pub fn asset3d_store_dir() -> Result<String, String> {
    let dir = store_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {}", dir.display(), e))?;
    }
    Ok(dir.to_string_lossy().to_string())
}

/// Carpetas del almacén que tienen un `config.json` legible. Las que no lo
/// tienen se saltan en silencio: una instalación a medias (o una carpeta que
/// el usuario dejó ahí) no debe impedir que se listen las demás.
#[tauri::command]
pub fn list_asset3d_packs() -> Result<Vec<AssetPack>, String> {
    let dir = store_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut packs: Vec<AssetPack> = fs::read_dir(&dir)
        .map_err(|e| format!("Could not read {}: {}", dir.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| read_pack(&entry.path()))
        .collect();

    packs.sort_by(|a, b| a.folder.to_lowercase().cmp(&b.folder.to_lowercase()));
    Ok(packs)
}

/// Descomprime un .zip de asset dentro del almacén.
///
/// Los .zip oficiales traen los archivos en la raíz, pero uno armado a mano en
/// Windows suele meterlos dentro de una carpeta con el nombre del paquete. Se
/// aceptan los dos: manda dónde esté el `config.json`, y todo lo que esté a su
/// lado es el paquete.
fn extract_zip(bytes: Vec<u8>, fallback_name: &str) -> Result<String, String> {
    extract_zip_into(bytes, fallback_name, &store_dir())
}

/// El destino se pasa aparte para poder probar la extracción contra una carpeta
/// temporal en vez de contra el almacén real del usuario.
fn extract_zip_into(bytes: Vec<u8>, fallback_name: &str, root: &Path) -> Result<String, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("That file is not a readable .zip ({}).", e))?;

    // Primero se busca el config.json para saber cuál es la raíz del paquete.
    let mut prefix: Option<String> = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.ends_with("config.json") {
            prefix = Some(name[..name.len() - "config.json".len()].to_string());
            break;
        }
    }
    let prefix = prefix.ok_or_else(|| {
        "That archive has no config.json, so it is not an AdvantageScope asset.".to_string()
    })?;

    let folder = if prefix.is_empty() {
        sanitize_folder(fallback_name)
    } else {
        sanitize_folder(prefix.trim_end_matches('/').rsplit('/').next().unwrap_or(fallback_name))
    };

    let target_dir = root.join(&folder);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Could not create {}: {}", target_dir.display(), e))?;

    let mut written = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");

        // Solo el nivel del config.json: los paquetes son planos, y bajar
        // recursivamente solo abriría la puerta a escribir árboles enteros
        // desde un .zip de procedencia desconocida.
        if !name.starts_with(&prefix) {
            continue;
        }
        let leaf = &name[prefix.len()..];
        if leaf.is_empty() || leaf.contains('/') || !has_allowed_extension(leaf) {
            continue;
        }
        if entry.size() > MAX_ASSET_FILE_BYTES {
            continue;
        }
        let leaf = safe_name(leaf)?;

        let mut buffer = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buffer)
            .map_err(|e| format!("Could not read {} from the archive: {}", leaf, e))?;

        let target = target_dir.join(&leaf);
        fs::write(&target, buffer)
            .map_err(|e| format!("Could not write {}: {}", target.display(), e))?;
        written += 1;
    }

    if written == 0 {
        return Err("The archive had no usable files.".to_string());
    }
    Ok(folder)
}

/// El nombre acaba siendo una carpeta en disco, así que no puede traer
/// separadores ni caracteres que Windows rechace.
fn sanitize_folder(name: &str) -> String {
    let cleaned: String = name
        .trim_end_matches(".zip")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect();

    // Un nombre hecho solo de puntos NO se puede dejar pasar: "." es la propia
    // carpeta del almacén y ".." es la de arriba, así que un .zip malicioso
    // llamado así escribiría fuera del almacén aunque cada archivo suelto sí
    // pase por `safe_name`.
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '.') {
        "Asset".to_string()
    } else {
        cleaned
    }
}

/// Instala un .zip que el usuario ya tiene en disco.
#[tauri::command]
pub fn install_asset3d_zip(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Could not open {}: {}", path, e))?;
    if meta.len() > MAX_ASSET_FILE_BYTES {
        return Err(format!(
            "That archive is too large ({:.1} MB).",
            meta.len() as f64 / 1_048_576.0
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("Could not read {}: {}", path, e))?;
    let fallback = Path::new(&path)
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Asset".to_string());
    extract_zip(bytes, &fallback)
}

/// Descarga un paquete y lo instala.
///
/// Solo se aceptan URLs https: el destino sale de un catálogo fijo del front,
/// pero comprobarlo acá es lo que impide que un layout editado a mano convierta
/// este comando en un descargador de cualquier cosa por http.
#[tauri::command]
pub async fn download_asset3d(url: String, fallback_name: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only https downloads are allowed.".to_string());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {}. Check the internet connection.", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed (HTTP {}).", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("The download was interrupted: {}", e))?;
    if bytes.len() as u64 > MAX_ASSET_FILE_BYTES {
        return Err("The downloaded archive is larger than the limit.".to_string());
    }

    // La descompresión bloquea, así que se saca del hilo asíncrono: son ~20 MB
    // y dejaría la ventana congelada durante el descomprimido.
    tauri::async_runtime::spawn_blocking(move || extract_zip(bytes.to_vec(), &fallback_name))
        .await
        .map_err(|e| format!("Install failed: {}", e))?
}

/// Copia una carpeta de asset ya extraída (la que quedó al descomprimir, o la
/// de `userAssets` de AdvantageScope) al almacén. Es el camino rápido: los
/// bytes no pasan por el IPC.
#[tauri::command]
pub fn import_asset3d_folder(source: String) -> Result<String, String> {
    let source = PathBuf::from(&source);
    if !source.join("config.json").exists() {
        return Err("That folder has no config.json - pick the folder that contains it.".to_string());
    }

    let folder = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Could not read the folder name.".to_string())?;
    let folder = safe_name(&folder)?;

    let target_dir = store_dir().join(&folder);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Could not create {}: {}", target_dir.display(), e))?;

    let mut copied = 0usize;
    for entry in fs::read_dir(&source)
        .map_err(|e| format!("Could not read {}: {}", source.display(), e))?
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        // Solo el primer nivel: los paquetes son planos y bajar recursivamente
        // solo abriría la puerta a copiar árboles enteros por accidente.
        if !meta.is_file() || meta.len() > MAX_ASSET_FILE_BYTES {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !has_allowed_extension(&name) {
            continue;
        }
        fs::copy(entry.path(), target_dir.join(&name))
            .map_err(|e| format!("Could not copy {}: {}", name, e))?;
        copied += 1;
    }

    if copied == 0 {
        return Err("No usable files were found in that folder.".to_string());
    }
    Ok(folder)
}

#[tauri::command]
pub fn delete_asset3d_pack(folder: String) -> Result<(), String> {
    let folder = safe_name(&folder)?;
    let target = store_dir().join(&folder);
    if !target.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("Could not remove {}: {}", target.display(), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// Arma un .zip en memoria con las entradas dadas.
    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            for (name, data) in entries {
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(data).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mars-assets3d-test-{}", tag));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn instala_un_zip_plano() {
        // Los .zip oficiales traen los archivos en la raíz.
        let root = temp_root("plano");
        let data = zip_with(&[
            ("config.json", br#"{"name":"X"}"#),
            ("model.glb", b"glb"),
        ]);

        let folder = extract_zip_into(data, "Field3d_Prueba", &root).unwrap();
        assert_eq!(folder, "Field3d_Prueba");
        assert!(root.join(&folder).join("config.json").exists());
        assert!(root.join(&folder).join("model.glb").exists());
    }

    #[test]
    fn instala_un_zip_con_carpeta_adentro() {
        // El que uno arma a mano en Windows mete todo bajo una carpeta; el
        // nombre del paquete sale de ahí y no del nombre del archivo.
        let root = temp_root("carpeta");
        let data = zip_with(&[
            ("Robot_Mio/config.json", br#"{"name":"X"}"#),
            ("Robot_Mio/model.glb", b"glb"),
        ]);

        let folder = extract_zip_into(data, "descarga", &root).unwrap();
        assert_eq!(folder, "Robot_Mio");
        assert!(root.join("Robot_Mio").join("model.glb").exists());
    }

    #[test]
    fn rechaza_un_zip_sin_config() {
        let root = temp_root("sin-config");
        let data = zip_with(&[("model.glb", b"glb")]);
        let error = extract_zip_into(data, "X", &root).unwrap_err();
        assert!(error.contains("config.json"), "{}", error);
    }

    #[test]
    fn ignora_lo_que_no_es_un_asset() {
        // Un paquete de terceros no tiene por qué poder dejar ejecutables ni
        // subcarpetas en una carpeta de la app.
        let root = temp_root("filtro");
        let data = zip_with(&[
            ("config.json", br#"{"name":"X"}"#),
            ("model.glb", b"glb"),
            ("malo.exe", b"MZ"),
            ("sub/otro.glb", b"glb"),
        ]);

        let folder = extract_zip_into(data, "X", &root).unwrap();
        let dir = root.join(&folder);
        assert!(dir.join("model.glb").exists());
        assert!(!dir.join("malo.exe").exists());
        assert!(!dir.join("sub").exists());
    }

    #[test]
    fn el_nombre_de_carpeta_no_puede_escapar_del_almacen() {
        // Los separadores se reemplazan, así que lo que queda es un solo
        // componente de ruta y no puede salirse del almacén.
        assert_eq!(sanitize_folder("../../etc"), ".._.._etc");
        assert_eq!(sanitize_folder(".."), "Asset");
        assert_eq!(sanitize_folder("."), "Asset");
        assert_eq!(sanitize_folder("Field3d_2026FRCFieldV1.zip"), "Field3d_2026FRCFieldV1");
        assert_eq!(sanitize_folder(""), "Asset");
        assert!(safe_name("../config.json").is_err());
        assert!(safe_name("a/b.glb").is_err());
        assert_eq!(safe_name("model.glb").unwrap(), "model.glb");
    }

    #[test]
    fn los_modelos_se_ordenan_por_numero_y_no_alfabeticamente() {
        // El índice de cada modelo es lo que empareja las piezas de juego con
        // el config; con orden alfabético, model_10 se colaría antes de model_2.
        let mut names = vec![
            "model_10.glb".to_string(),
            "model_2.glb".to_string(),
            "model.glb".to_string(),
            "model_1.glb".to_string(),
        ];
        names.sort_by_key(|n| model_rank(n));
        assert_eq!(names, vec!["model.glb", "model_1.glb", "model_2.glb", "model_10.glb"]);
    }

    /// Descarga de verdad el KitBot (~2 MB) del catálogo oficial.
    ///
    /// Va marcado `ignore` porque necesita internet y no puede correr en un
    /// pit sin red; se lanza a mano con `cargo test -- --ignored`. Existe
    /// porque el camino de descarga NO se puede probar desde el front: GitHub
    /// no manda cabeceras CORS y un `fetch` desde el webview falla siempre.
    #[test]
    #[ignore]
    fn descarga_un_paquete_real() {
        let url = concat!(
            "https://github.com/Mechanical-Advantage/AdvantageScopeAssets",
            "/releases/download/default-assets-v2/Robot_2026FRCKitBotV1.zip",
        );

        let bytes = tauri::async_runtime::block_on(async {
            let response = reqwest::get(url).await.expect("la descarga falló");
            assert!(response.status().is_success(), "HTTP {}", response.status());
            response.bytes().await.expect("no se pudo leer el cuerpo")
        });

        assert!(bytes.len() > 100_000, "el .zip llegó vacío: {} bytes", bytes.len());

        let root = temp_root("descarga");
        let folder = extract_zip_into(bytes.to_vec(), "Robot_2026FRCKitBotV1", &root).unwrap();
        let dir = root.join(&folder);
        assert!(dir.join("config.json").exists());
        assert!(dir.join("model.glb").exists());
    }

    #[test]
    fn solo_se_descarga_por_https() {
        let error = tauri::async_runtime::block_on(download_asset3d(
            "http://ejemplo.invalido/asset.zip".to_string(),
            "X".to_string(),
        ))
        .unwrap_err();
        assert!(error.contains("https"), "{}", error);
    }
}
