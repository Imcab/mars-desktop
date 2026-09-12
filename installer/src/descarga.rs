//! Descarga con progreso y verificación de integridad.
//!
//! Baja a un archivo temporal y calcula el sha256 mientras escribe, no después:
//! leer 60 MB dos veces para verificarlos es tiempo regalado, y en un disco
//! lento se nota.

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Baja `url` a `destino`, informando el avance por `avance`.
///
/// `esperado_sha256` vacío significa que la release no traía checksum: se baja
/// igual y quien llama decide qué decirle al usuario.
pub async fn archivo<F>(
    url: &str,
    destino: &Path,
    esperado_sha256: &str,
    mut avance: F,
) -> Result<PathBuf>
where
    F: FnMut(u64, u64),
{
    let cliente = reqwest::Client::builder()
        .user_agent(concat!("mars-installer/", env!("CARGO_PKG_VERSION")))
        .build()?;

    let resp = cliente
        .get(url)
        .send()
        .await
        .with_context(|| format!("no pude empezar la descarga de {url}"))?;

    if !resp.status().is_success() {
        bail!("la descarga respondió {} ({url})", resp.status());
    }

    let total = resp.content_length().unwrap_or(0);

    if let Some(padre) = destino.parent() {
        std::fs::create_dir_all(padre)
            .with_context(|| format!("no pude crear {}", padre.display()))?;
    }
    let mut archivo = std::fs::File::create(destino)
        .with_context(|| format!("no pude escribir {}", destino.display()))?;

    let mut hasher = Sha256::new();
    let mut bajados: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(trozo) = stream.next().await {
        let trozo = trozo.context("se cortó la descarga")?;
        hasher.update(&trozo);
        archivo.write_all(&trozo).context("no pude escribir el archivo descargado")?;
        bajados += trozo.len() as u64;
        avance(bajados, total);
    }
    archivo.flush()?;
    drop(archivo);

    if !esperado_sha256.is_empty() {
        let obtenido = format!("{:x}", hasher.finalize());
        if !obtenido.eq_ignore_ascii_case(esperado_sha256) {
            // Un archivo corrupto no se deja en disco: si se quedara, el
            // siguiente intento podría "reusarlo" y el error sería eterno.
            let _ = std::fs::remove_file(destino);
            bail!(
                "el archivo descargado no coincide con el checksum publicado.\n\
                 esperaba {esperado_sha256}\n\
                 obtuve   {obtenido}\n\n\
                 Puede ser una descarga cortada o un proxy que modificó el archivo."
            );
        }
    }

    Ok(destino.to_path_buf())
}

/// Carpeta temporal propia del instalador, dentro del temporal del sistema.
///
/// Propia y no `std::env::temp_dir()` pelado para poder borrarla entera al
/// terminar sin riesgo de llevarse nada ajeno.
pub fn carpeta_temporal() -> PathBuf {
    std::env::temp_dir().join("mars-installer")
}

pub fn limpiar_temporal() {
    let dir = carpeta_temporal();
    if dir.exists() {
        let _ = std::fs::remove_dir_all(dir);
    }
}
