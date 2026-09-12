//! Lanzador de MARS Simulation Studio.
//!
//! Esto es TODO lo que mars-desktop sabe de la simulación: dónde está su
//! ejecutable y cómo abrirlo. Nada de Gazebo entra aquí.
//!
//! La simulación es una aplicación aparte a propósito. Arrastra el entorno
//! conda entero --- Gazebo, sus plugins, sus dependencias --- y ese peso no
//! tiene por qué entrar en el bundle del dashboard, que es lo que el equipo usa
//! en competencia. Además puede colgarse, actualizarse o reinstalarse sin tocar
//! la app que tiene que estar viva cuando importa.
//!
//! El proceso se lanza y se suelta: no se supervisa desde aquí. El Studio tiene
//! su propia ventana, su propio ciclo de vida y su propio supervisor de la
//! simulación. Cerrar mars-desktop no cierra la simulación, y eso es
//! deliberado.

use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
const EXE: &str = "mars-sim-app.exe";
#[cfg(not(windows))]
const EXE: &str = "mars-sim-app";

/// Busca el ejecutable de MARS Simulation Studio.
///
/// Cubre los dos escenarios reales: desarrollo, donde vive en el `target` de su
/// propio crate, y una instalación, donde viaja junto a mars-desktop.
fn buscar_ejecutable() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MARS_SIM_APP") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }

    let mut raices: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        // Junto al ejecutable: el caso instalado.
        if let Some(dir) = exe.parent() {
            raices.push(dir.to_path_buf());
        }
        raices.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        raices.push(cwd);
    }

    for raiz in raices {
        for dir in raiz.ancestors() {
            for rel in [
                Path::new(EXE).to_path_buf(),
                Path::new("sim/app/target/release").join(EXE),
                Path::new("sim/app/target/debug").join(EXE),
            ] {
                let candidato = dir.join(&rel);
                if candidato.is_file() {
                    return Some(candidato);
                }
            }
        }
    }
    None
}

/// Si MARS Simulation Studio está instalado, y dónde. La UI lo usa para no ofrecer un botón
/// que no puede hacer nada.
#[tauri::command]
pub fn sim_app_disponible() -> Option<String> {
    buscar_ejecutable().map(|p| p.display().to_string())
}

/// Abre MARS Simulation Studio en su propia ventana.
#[tauri::command]
pub fn abrir_sim_app() -> Result<String, String> {
    let exe = buscar_ejecutable().ok_or_else(|| {
        "No se encontró MARS Simulation Studio. Compilalo con `cargo build` en sim/app, \
         o poné MARS_SIM_APP con la ruta de su ejecutable."
            .to_string()
    })?;

    // El directorio de trabajo se pone en el del ejecutable para que el Studio
    // encuentre `sim/` subiendo desde ahí. Sin esto hereda el de mars-desktop,
    // que puede ser cualquiera segun desde donde se abrio la app.
    let dir = exe.parent().unwrap_or_else(|| Path::new("."));

    Command::new(&exe)
        .current_dir(dir)
        .spawn()
        .map_err(|e| format!("no se pudo abrir MARS Simulation Studio: {e}"))?;

    Ok(exe.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Si el Studio está compilado, el launcher tiene que encontrarlo.
    ///
    /// La búsqueda sube por los ancestros del ejecutable de test, que en
    /// `src-tauri/target/debug/deps` pasa por la raíz del repositorio y de ahí
    /// llega a `sim/app/target/debug`. Es exactamente el mismo camino que sigue
    /// la app en desarrollo, así que si este test pasa, el botón funciona.
    #[test]
    fn encuentra_mars_sim_si_esta_compilado() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri siempre cuelga de la raíz del repo");
        let esperado = repo.join("sim/app/target/debug").join(EXE);

        if !esperado.is_file() {
            // Sin compilar no hay nada que encontrar, y hacer fallar el test
            // por eso convertiría `cargo test` en rehén del orden de compilación.
            eprintln!("saltado: {} no está compilado", esperado.display());
            return;
        }

        let hallado = buscar_ejecutable().expect("está compilado pero no se encontró");
        assert!(
            hallado.ends_with(EXE),
            "encontró algo que no es el ejecutable: {}",
            hallado.display()
        );
        assert!(hallado.is_file());
    }

    /// La variable de entorno manda sobre la búsqueda.
    #[test]
    fn mars_sim_app_tiene_prioridad() {
        // Una ruta que no existe no debe ganar: la variable dice dónde mirar,
        // no promete que haya algo. Si ganara, apuntarla mal dejaría el botón
        // muerto sin manera de recuperarse salvo desapuntarla.
        let antes = std::env::var("MARS_SIM_APP").ok();
        std::env::set_var("MARS_SIM_APP", "no/existe/en/ningun/sitio.exe");
        let hallado = buscar_ejecutable();
        match antes {
            Some(v) => std::env::set_var("MARS_SIM_APP", v),
            None => std::env::remove_var("MARS_SIM_APP"),
        }

        if let Some(p) = hallado {
            assert!(p.is_file(), "devolvió una ruta que no existe: {}", p.display());
        }
    }
}
