//! De dónde salen los archivos que se instalan: una release de GitHub.
//!
//! Hay dos caminos y el orden importa:
//!
//! 1. **`manifest.json` de la release** — lo escribe `package-release.mjs` al
//!    empaquetar y trae tamaño y sha256 de cada archivo. Es el bueno: permite
//!    verificar la descarga y mostrar cuánto falta.
//! 2. **La lista de assets de la API** — si la release no trae manifiesto
//!    (una publicada a mano, por ejemplo), se deducen los archivos por su
//!    nombre. Se puede instalar igual; lo que se pierde es el checksum, y eso
//!    la interfaz lo dice en vez de fingir que verificó algo.
//!
//! Sin el camino 2 una release publicada a mano dejaría el instalador muerto
//! sin ninguna razón técnica.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::plataforma::{self, Edicion};

/// Repositorio de donde se bajan las releases. Se puede apuntar a otro con
/// MARS_RELEASES_REPO, que es lo que usan las pruebas y los forks.
pub fn repo() -> String {
    std::env::var("MARS_RELEASES_REPO").unwrap_or_else(|_| "Imcab/mars-desktop".to_string())
}

/// Un archivo instalable, ya resuelto para esta plataforma.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artefacto {
    pub componente: String,
    pub archivo: String,
    pub url: String,
    /// Bytes, o 0 si la release no lo declara.
    #[serde(default)]
    pub tamano: u64,
    /// Hex en minúsculas, o vacío si no vino en el manifiesto.
    #[serde(default)]
    pub sha256: String,
}

/// Lo que el instalador sabe de la última versión publicada.
#[derive(Debug, Clone, Serialize)]
pub struct Release {
    pub version: String,
    pub etiqueta: String,
    pub notas: String,
    pub url_release: String,
    /// `true` si vino con manifiesto firmado por el empaquetador.
    pub verificable: bool,
}

/// Release + los artefactos que le tocan a esta máquina y edición.
#[derive(Debug, Clone, Serialize)]
pub struct PlanDescarga {
    pub release: Release,
    pub artefactos: Vec<Artefacto>,
    /// Componentes que la edición pedía pero la release no publica para esta
    /// plataforma. Se muestran como advertencia: instalar igual lo que sí está
    /// es mejor que no instalar nada.
    pub faltantes: Vec<String>,
    /// `Some(true)` si la publicada es más nueva que la instalada, `Some(false)`
    /// si no, `None` si no hay nada instalado. Lo completa el comando, que es
    /// quien sabe del registro local.
    pub mas_nueva: Option<bool>,
}

// --- Respuestas de la API de GitHub ----------------------------------------

#[derive(Deserialize)]
struct ReleaseApi {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<AssetApi>,
}

#[derive(Deserialize)]
struct AssetApi {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// El `manifest.json` que sube el empaquetador.
#[derive(Deserialize)]
struct ManifestJson {
    version: String,
    #[serde(default)]
    artifacts: Vec<ManifestArtifact>,
}

#[derive(Deserialize)]
struct ManifestArtifact {
    component: String,
    file: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    sha256: String,
}

fn cliente() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        // La API de GitHub rechaza peticiones sin User-Agent con un 403 que no
        // explica nada.
        .user_agent(concat!("mars-installer/", env!("CARGO_PKG_VERSION")))
        .build()
        .context("no pude crear el cliente HTTP")
}

/// Consulta la última release y arma el plan de descarga para esta máquina.
pub async fn consultar(edicion: Edicion) -> Result<PlanDescarga> {
    let repo = repo();
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let cliente = cliente()?;

    let resp = cliente
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .with_context(|| format!("no pude consultar {url}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        bail!(
            "{repo} todavía no tiene ninguna release publicada.\n\n\
             Publicá una con los ejecutables (el workflow release.yml del repo \
             lo hace solo al empujar una etiqueta vX.Y.Z) y volvé a abrir el \
             instalador."
        );
    }
    if !resp.status().is_success() {
        bail!("GitHub respondió {} al pedir la última release", resp.status());
    }

    let release: ReleaseApi = resp.json().await.context("la respuesta de GitHub no es la esperada")?;

    let version = release.tag_name.trim_start_matches('v').to_string();
    let manifiesto = descargar_manifiesto(&cliente, &release).await;

    let mut artefactos = Vec::new();
    let mut faltantes = Vec::new();

    for componente in plataforma::componentes(edicion) {
        let nombre = plataforma::nombre_archivo(componente, edicion);
        match release.assets.iter().find(|a| a.name == nombre) {
            Some(asset) => {
                // El tamaño y el checksum salen del manifiesto si está; si no,
                // del tamaño que informa la API, que al menos sirve para la
                // barra de progreso.
                let del_manifiesto = manifiesto
                    .as_ref()
                    .and_then(|m| m.artifacts.iter().find(|a| a.file == nombre));
                artefactos.push(Artefacto {
                    componente: componente.id().to_string(),
                    archivo: nombre.clone(),
                    url: asset.browser_download_url.clone(),
                    tamano: del_manifiesto.map(|a| a.size).filter(|s| *s > 0).unwrap_or(asset.size),
                    sha256: del_manifiesto.map(|a| a.sha256.clone()).unwrap_or_default(),
                });
                // `component` del manifiesto se valida acá y no en serde para
                // poder seguir si una release vieja lo escribía distinto.
                if let Some(a) = del_manifiesto {
                    if a.component != componente.id() {
                        faltantes.push(format!(
                            "{} (el manifiesto lo llama \"{}\")",
                            componente.nombre(),
                            a.component
                        ));
                    }
                }
            }
            None => faltantes.push(componente.nombre().to_string()),
        }
    }

    if artefactos.is_empty() {
        bail!(
            "La release {} no publica ningún archivo para {} {}.\n\n\
             Archivos que busqué: {}",
            release.tag_name,
            plataforma::SO,
            plataforma::ARCH,
            plataforma::componentes(edicion)
                .iter()
                .map(|c| plataforma::nombre_archivo(*c, edicion))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    let verificable = artefactos.iter().all(|a| !a.sha256.is_empty());

    Ok(PlanDescarga {
        release: Release {
            version: manifiesto.map(|m| m.version).unwrap_or(version),
            etiqueta: release.tag_name,
            notas: release
                .body
                .unwrap_or_default()
                .lines()
                .take(24)
                .collect::<Vec<_>>()
                .join("\n"),
            url_release: release.html_url,
            verificable,
        },
        artefactos,
        faltantes,
        mas_nueva: None,
    })
}

async fn descargar_manifiesto(cliente: &reqwest::Client, release: &ReleaseApi) -> Option<ManifestJson> {
    let asset = release.assets.iter().find(|a| a.name == "manifest.json")?;
    let texto = cliente
        .get(&asset.browser_download_url)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    match serde_json::from_str::<ManifestJson>(&texto) {
        Ok(m) => Some(m),
        Err(e) => {
            // No es fatal: se sigue por el camino 2. Pero queda en el log,
            // porque significa que el empaquetador escribió algo raro.
            eprintln!("manifest.json ilegible, sigo por la lista de assets: {e}");
            None
        }
    }
}

/// Compara dos versiones tipo `1.10.2`. Devuelve `true` si `nueva` es mayor.
///
/// Comparar como texto diría que 1.9.0 > 1.10.0, que es justo el caso en el
/// que una actualización importante no se ofrecería.
pub fn es_mas_nueva(nueva: &str, actual: &str) -> bool {
    let partes = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split(['.', '-', '+'])
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (a, b) = (partes(nueva), partes(actual));
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// Comprueba que el repositorio configurado tenga forma de `usuario/repo`.
pub fn validar_repo() -> Result<()> {
    let r = repo();
    let partes: Vec<&str> = r.split('/').collect();
    if partes.len() != 2 || partes.iter().any(|p| p.is_empty()) {
        return Err(anyhow!("MARS_RELEASES_REPO tiene que ser \"usuario/repo\", no \"{r}\""));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plataforma::Componente;

    #[test]
    fn compara_versiones_por_numero_y_no_por_texto() {
        assert!(es_mas_nueva("1.10.0", "1.9.0"));
        assert!(es_mas_nueva("1.1.4", "1.1.3"));
        assert!(es_mas_nueva("2.0.0", "1.99.99"));
        assert!(!es_mas_nueva("1.1.3", "1.1.3"));
        assert!(!es_mas_nueva("1.1.2", "1.1.3"));
        // Con y sin la "v" de la etiqueta tiene que dar lo mismo.
        assert!(es_mas_nueva("v1.2.0", "1.1.9"));
        // Menos componentes no significa menor: 1.2 == 1.2.0.
        assert!(!es_mas_nueva("1.2", "1.2.0"));
    }

    /// Contra la release publicada de verdad.
    ///
    /// Va marcado `ignore` porque necesita red: `cargo test` en una máquina sin
    /// internet no tiene por qué fallar. Se corre a mano con
    /// `cargo test -- --ignored` cada vez que se toca el formato de nombres o
    /// el manifiesto, que es justo lo que ningún test offline puede cubrir:
    /// que lo que publica el empaquetador sea lo que busca el instalador.
    #[tokio::test]
    #[ignore = "necesita red y una release publicada"]
    async fn encuentra_los_archivos_de_la_release_publicada() {
        let plan = consultar(Edicion::Full).await.expect("no pude consultar la release");
        assert!(!plan.artefactos.is_empty(), "la release no trae nada para esta plataforma");
        assert!(
            plan.release.verificable,
            "la release no publicó sha256: el instalador no podría verificar nada"
        );
        for a in &plan.artefactos {
            assert_eq!(a.sha256.len(), 64, "sha256 con forma rara en {}", a.archivo);
            assert!(a.tamano > 0, "{} dice pesar 0 bytes", a.archivo);
            assert!(a.url.starts_with("https://"), "{} no tiene URL", a.archivo);
        }
        // La edición Tools tiene que resolver a un archivo distinto del de Full.
        let tools = consultar(Edicion::Tools).await.expect("tools");
        assert_ne!(
            tools.artefactos[0].archivo, plan.artefactos[0].archivo,
            "las dos ediciones apuntan al mismo paquete"
        );
    }

    #[test]
    fn los_nombres_de_archivo_siguen_la_convencion() {
        let n = plataforma::nombre_archivo(Componente::MarsDesktop, Edicion::Tools);
        assert!(n.starts_with("mars-desktop-tools-"), "{n}");
        assert!(n.ends_with(plataforma::EXT_PAQUETE), "{n}");
        // El Studio no tiene ediciones: una sola build para las dos.
        let s = plataforma::nombre_archivo(Componente::SimulationStudio, Edicion::Full);
        assert_eq!(s, plataforma::nombre_archivo(Componente::SimulationStudio, Edicion::Tools));
    }
}
