//! Abrir el paquete descargado: `.zip` en Windows, `.tar.gz` en el resto.
//!
//! Devuelve la lista de archivos que dejó, en rutas relativas al destino. Esa
//! lista es lo que hace que la desinstalación pueda borrar EXACTAMENTE lo que
//! se instaló, en vez de arrasar con la carpeta elegida —que puede no ser
//! nuestra.

use anyhow::{bail, Context, Result};
use std::path::{Component, Path, PathBuf};

/// Extrae `paquete` dentro de `destino` y devuelve las rutas relativas creadas.
pub fn extraer(paquete: &Path, destino: &Path) -> Result<Vec<String>> {
    std::fs::create_dir_all(destino)
        .with_context(|| format!("no pude crear {}", destino.display()))?;

    #[cfg(windows)]
    {
        extraer_zip(paquete, destino)
    }
    #[cfg(not(windows))]
    {
        extraer_targz(paquete, destino)
    }
}

/// Rechaza rutas que se escapen del destino (`../..`, rutas absolutas).
///
/// Un zip puede contener lo que sea, incluido `../../.bashrc`. No es paranoia
/// teórica: es un bug con nombre propio (Zip Slip) y cuesta cuatro líneas.
fn ruta_segura(destino: &Path, interna: &Path) -> Result<PathBuf> {
    let mut salida = destino.to_path_buf();
    for parte in interna.components() {
        match parte {
            Component::Normal(p) => salida.push(p),
            Component::CurDir => {}
            _ => bail!(
                "el paquete contiene una ruta que se sale de la carpeta de instalación: {}",
                interna.display()
            ),
        }
    }
    Ok(salida)
}

#[cfg(windows)]
fn extraer_zip(paquete: &Path, destino: &Path) -> Result<Vec<String>> {
    let archivo = std::fs::File::open(paquete)
        .with_context(|| format!("no pude abrir {}", paquete.display()))?;
    let mut zip = zip::ZipArchive::new(archivo).context("el paquete no es un zip válido")?;

    let mut creados = Vec::new();
    for i in 0..zip.len() {
        let mut entrada = zip.by_index(i)?;
        let Some(interna) = entrada.enclosed_name() else {
            bail!("el paquete contiene un nombre de archivo inválido");
        };
        let ruta = ruta_segura(destino, &interna)?;

        if entrada.is_dir() {
            std::fs::create_dir_all(&ruta)?;
            continue;
        }
        if let Some(padre) = ruta.parent() {
            std::fs::create_dir_all(padre)?;
        }
        let mut salida = std::fs::File::create(&ruta)
            .with_context(|| format!("no pude escribir {}", ruta.display()))?;
        std::io::copy(&mut entrada, &mut salida)?;
        creados.push(interna.to_string_lossy().replace('\\', "/"));
    }
    Ok(creados)
}

#[cfg(not(windows))]
fn extraer_targz(paquete: &Path, destino: &Path) -> Result<Vec<String>> {
    use std::os::unix::fs::PermissionsExt;

    let archivo = std::fs::File::open(paquete)
        .with_context(|| format!("no pude abrir {}", paquete.display()))?;
    let descomprimido = flate2::read::GzDecoder::new(archivo);
    let mut tar = tar::Archive::new(descomprimido);
    // Los permisos vienen del tar y hay que respetarlos: es lo que mantiene el
    // bit de ejecución del binario. Sin eso queda un archivo que no arranca.
    tar.set_preserve_permissions(true);

    let mut creados = Vec::new();
    for entrada in tar.entries().context("el paquete no es un tar.gz válido")? {
        let mut entrada = entrada?;
        let interna = entrada.path()?.to_path_buf();
        let ruta = ruta_segura(destino, &interna)?;

        if entrada.header().entry_type().is_dir() {
            std::fs::create_dir_all(&ruta)?;
            continue;
        }
        if let Some(padre) = ruta.parent() {
            std::fs::create_dir_all(padre)?;
        }
        entrada.unpack(&ruta)
            .with_context(|| format!("no pude escribir {}", ruta.display()))?;

        // Cinturón y tirantes: un tar armado sin el bit de ejecución dejaría
        // la app instalada y muerta, con un error que no dice nada.
        if ruta.extension().is_none() || ruta.extension().is_some_and(|e| e == "sh") {
            if let Ok(meta) = std::fs::metadata(&ruta) {
                let mut permisos = meta.permissions();
                permisos.set_mode(permisos.mode() | 0o755);
                let _ = std::fs::set_permissions(&ruta, permisos);
            }
        }
        creados.push(interna.to_string_lossy().to_string());
    }
    Ok(creados)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rechaza_rutas_que_salen_del_destino() {
        let destino = Path::new("/tmp/mars");
        assert!(ruta_segura(destino, Path::new("bin/app")).is_ok());
        assert!(ruta_segura(destino, Path::new("../fuera")).is_err());
        assert!(ruta_segura(destino, Path::new("a/../../fuera")).is_err());
    }

    #[test]
    fn acepta_rutas_normales_y_las_deja_bajo_el_destino() {
        let destino = Path::new("/tmp/mars");
        let r = ruta_segura(destino, Path::new("./sub/app.exe")).unwrap();
        assert!(r.starts_with(destino));
        assert!(r.ends_with("sub/app.exe"));
    }
}
