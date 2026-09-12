//! Instalar, actualizar y desinstalar: el orden de las operaciones y el
//! registro de lo que se hizo.
//!
//! La idea central es que **la desinstalación borra exactamente lo que la
//! instalación creó**, ni un archivo más. Por eso cada instalación deja un
//! registro con la lista de archivos y de accesos directos. Un `remove_dir_all`
//! sobre la carpeta que eligió el usuario es una línea más corta y una manera
//! excelente de borrarle el escritorio a alguien que instaló en `C:\`.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::manifiesto;
use crate::plataforma::{self, Componente, Edicion};
use crate::{descarga, integracion, paquete};

/// Qué dejó en disco una instalación. Lo escribe `instalar` y lo lee todo lo
/// demás.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registro {
    /// Sube si el formato cambia de forma incompatible.
    pub schema: u32,
    pub version: String,
    pub edicion: Edicion,
    pub instalado_en: String,
    pub carpeta: PathBuf,
    pub componentes: Vec<String>,
    /// Rutas relativas a `carpeta`.
    pub archivos: Vec<String>,
    pub atajos: Vec<PathBuf>,
}

const SCHEMA: u32 = 1;

/// Dónde vive el registro.
///
/// En la carpeta de datos del usuario y no en la de instalación, para poder
/// encontrar una instalación anterior sin saber dónde la pusieron.
fn ruta_registro() -> PathBuf {
    plataforma::datos_usuario().join("instalacion.json")
}

pub fn leer_registro() -> Option<Registro> {
    let texto = std::fs::read_to_string(ruta_registro()).ok()?;
    let reg: Registro = serde_json::from_str(&texto).ok()?;
    // Un registro que apunta a una carpeta que ya no existe (la borraron a
    // mano) es peor que no tener registro: haría creer que está instalado.
    if !reg.carpeta.exists() {
        return None;
    }
    Some(reg)
}

fn guardar_registro(reg: &Registro) -> Result<()> {
    let ruta = ruta_registro();
    if let Some(p) = ruta.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(&ruta, serde_json::to_string_pretty(reg)?)
        .with_context(|| format!("no pude escribir {}", ruta.display()))?;
    Ok(())
}

/// Lo que la interfaz necesita saber al abrir.
#[derive(Debug, Serialize)]
pub struct Estado {
    pub instalado: Option<Registro>,
    pub so: &'static str,
    pub arch: &'static str,
    /// `false` en macOS: la edición Full no trae simulador ahí.
    pub hay_simulation_studio: bool,
    pub destino_sugerido: PathBuf,
    pub repo: String,
    pub version_instalador: &'static str,
    /// En Windows, si falta el runtime de WebView2.
    pub falta_webview2: bool,
}

pub fn estado() -> Estado {
    let instalado = leer_registro();
    Estado {
        destino_sugerido: instalado
            .as_ref()
            .map(|r| r.carpeta.clone())
            .unwrap_or_else(plataforma::destino_por_defecto),
        instalado,
        so: plataforma::SO,
        arch: plataforma::ARCH,
        hay_simulation_studio: plataforma::hay_simulation_studio(),
        repo: manifiesto::repo(),
        version_instalador: env!("CARGO_PKG_VERSION"),
        falta_webview2: !integracion::hay_webview2(),
    }
}

/// Opciones que llegan de la pantalla de selección.
#[derive(Debug, Clone, Deserialize)]
pub struct Opciones {
    pub edicion: Edicion,
    pub carpeta: PathBuf,
    #[serde(default)]
    pub acceso_escritorio: bool,
}

/// Un paso del progreso, tal como lo pinta la interfaz.
#[derive(Debug, Clone, Serialize)]
pub struct Progreso {
    /// "preparar" | "webview2" | "descargar" | "instalar" | "atajos" | "listo" | "aviso"
    pub fase: &'static str,
    pub mensaje: String,
    /// 0-100 del total de la instalación.
    pub porcentaje: u8,
}

/// Instala (o reinstala) el ecosistema.
///
/// `emitir` recibe cada paso. Se pasa como callback y no como un `AppHandle`
/// para que toda esta lógica se pueda probar sin levantar una ventana.
pub async fn instalar<F>(opciones: Opciones, mut emitir: F) -> Result<Registro>
where
    F: FnMut(Progreso),
{
    manifiesto::validar_repo()?;

    let avisar = |emitir: &mut F, fase: &'static str, pct: u8, msg: String| {
        emitir(Progreso { fase, mensaje: msg, porcentaje: pct });
    };

    avisar(&mut emitir, "preparar", 2, "Consultando la última versión…".into());
    let plan = manifiesto::consultar(opciones.edicion).await?;

    for f in &plan.faltantes {
        avisar(
            &mut emitir,
            "aviso",
            2,
            format!("La release no publica {f} para esta plataforma: se omite."),
        );
    }

    // WebView2 antes que nada: si falta, la app se instala igual pero abre en
    // blanco, y ese síntoma no lleva a nadie a sospechar del runtime.
    if !integracion::hay_webview2() {
        avisar(&mut emitir, "webview2", 5, "Instalando el runtime WebView2 de Microsoft…".into());
        integracion::instalar_webview2().await?;
    }

    // Una reinstalación sobre otra versión: se limpia primero lo viejo, para
    // no dejar archivos de una versión anterior mezclados con los nuevos.
    if let Some(anterior) = leer_registro() {
        avisar(&mut emitir, "preparar", 8, format!("Quitando la versión {} anterior…", anterior.version));
        borrar_instalacion(&anterior);
    }

    std::fs::create_dir_all(&opciones.carpeta)
        .with_context(|| format!("no pude crear {}", opciones.carpeta.display()))?;

    let temporal = descarga::carpeta_temporal();
    let total_artefactos = plan.artefactos.len().max(1) as u8;
    let mut archivos: Vec<String> = Vec::new();
    let mut componentes: Vec<String> = Vec::new();

    // 10% al preparar, 75% repartido entre descargar+extraer, 15% al final.
    for (i, art) in plan.artefactos.iter().enumerate() {
        let base = 10 + (75 / total_artefactos) * i as u8;
        let tramo = 75 / total_artefactos;
        let nombre = nombre_componente(&art.componente);

        let destino_zip = temporal.join(&art.archivo);
        let mut ultimo_pct = u8::MAX;
        descarga::archivo(&art.url, &destino_zip, &art.sha256, |bajado, total| {
            let frac = if total > 0 { bajado as f64 / total as f64 } else { 0.0 };
            let pct = base + (tramo as f64 * 0.8 * frac) as u8;
            // Sin este filtro se emite un evento por cada trozo del stream:
            // miles de mensajes al webview para mover una barra 1 píxel.
            if pct != ultimo_pct {
                ultimo_pct = pct;
                emitir(Progreso {
                    fase: "descargar",
                    mensaje: format!("Descargando {nombre} — {}", tamano_legible(bajado, total)),
                    porcentaje: pct,
                });
            }
        })
        .await?;

        avisar(&mut emitir, "instalar", base + (tramo as f64 * 0.85) as u8, format!("Instalando {nombre}…"));
        let creados = paquete::extraer(&destino_zip, &opciones.carpeta)
            .with_context(|| format!("no pude descomprimir {}", art.archivo))?;
        let _ = std::fs::remove_file(&destino_zip);

        // Sin el filtro, un archivo que viaja en los dos paquetes (el icono)
        // aparece dos veces: no rompe el borrado, pero el resumen le miente al
        // usuario sobre cuántos archivos instaló.
        for c in creados {
            if !archivos.contains(&c) {
                archivos.push(c);
            }
        }
        componentes.push(art.componente.clone());
    }

    // El instalador se copia a sí mismo al destino: es lo que va a correr el
    // botón "Desinstalar" de Windows, y el original puede estar en Descargas,
    // en un USB o directamente borrado para entonces.
    avisar(&mut emitir, "instalar", 88, "Dejando el desinstalador…".into());
    match copiarse(&opciones.carpeta) {
        Ok(rel) => archivos.push(rel),
        Err(e) => avisar(&mut emitir, "aviso", 88, format!("No pude dejar el desinstalador: {e}")),
    }

    // macOS marca en cuarentena todo lo que se descarga: hay que quitarlo
    // antes de crear accesos a algo que no va a abrir.
    for aviso in integracion::tras_extraer(&opciones.carpeta) {
        avisar(&mut emitir, "aviso", 90, aviso);
    }

    avisar(&mut emitir, "atajos", 92, "Creando accesos directos…".into());
    let mut atajos = Vec::new();
    for comp in plataforma::componentes(opciones.edicion) {
        if !componentes.iter().any(|c| c == comp.id()) {
            continue; // no se instaló (la release no lo traía)
        }
        let exe = opciones.carpeta.join(comp.archivo_exe());
        if !exe.exists() {
            avisar(
                &mut emitir,
                "aviso",
                92,
                format!("El paquete de {} no traía {}", comp.nombre(), comp.archivo_exe()),
            );
            continue;
        }
        let nombre = nombre_atajo(comp, opciones.edicion);
        let (creados, avisos) = integracion::crear_atajos(&nombre, &exe, opciones.acceso_escritorio);
        atajos.extend(creados);
        for a in avisos {
            avisar(&mut emitir, "aviso", 92, a);
        }
    }

    let registro = Registro {
        schema: SCHEMA,
        version: plan.release.version.clone(),
        edicion: opciones.edicion,
        instalado_en: ahora_iso(),
        carpeta: opciones.carpeta.clone(),
        componentes,
        archivos,
        atajos,
    };
    guardar_registro(&registro)?;

    avisar(&mut emitir, "atajos", 96, "Registrando el programa…".into());
    let kb = (tamano_total(&registro) / 1024) as u32;
    let desinstalador = opciones.carpeta.join(nombre_desinstalador());
    if let Err(e) = integracion::registrar_programa(
        &registro.version,
        registro.edicion.id(),
        &opciones.carpeta,
        &desinstalador,
        kb,
    ) {
        avisar(&mut emitir, "aviso", 96, format!("No pude registrar el programa: {e}"));
    }

    descarga::limpiar_temporal();
    avisar(&mut emitir, "listo", 100, format!("MARS {} instalado.", registro.version));
    Ok(registro)
}

/// Borra lo que registró una instalación. No toca los datos del usuario.
fn borrar_instalacion(reg: &Registro) {
    integracion::borrar_atajos(&reg.atajos);
    let _ = integracion::desregistrar_programa();

    for rel in &reg.archivos {
        let ruta = reg.carpeta.join(rel);
        // El desinstalador en Windows se está ejecutando ahora mismo: no se
        // puede borrar todavía, se programa para después.
        let _ = std::fs::remove_file(&ruta);
    }

    // Las carpetas que quedaron vacías, de adentro hacia afuera. Nunca
    // recursivo: si sobró algo que no pusimos nosotros, se queda.
    let mut dirs: Vec<PathBuf> = reg
        .archivos
        .iter()
        .filter_map(|rel| reg.carpeta.join(rel).parent().map(|p| p.to_path_buf()))
        .filter(|p| p.starts_with(&reg.carpeta) && p != &reg.carpeta)
        .collect();
    dirs.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    dirs.dedup();
    for d in dirs {
        let _ = std::fs::remove_dir(d);
    }
    let _ = std::fs::remove_dir(&reg.carpeta);
}

/// Quita MARS de la máquina.
///
/// `borrar_datos` incluye preferencias, layouts guardados y los packs de
/// assets 3D. Va aparte y por defecto en `false` porque son horas de trabajo
/// del equipo y un desinstalador no tiene por qué llevárselas.
pub fn desinstalar(borrar_datos: bool) -> Result<String> {
    let Some(reg) = leer_registro() else {
        bail!("No encontré ninguna instalación de MARS registrada en esta computadora.");
    };

    borrar_instalacion(&reg);

    let datos = plataforma::datos_usuario();
    if borrar_datos {
        let _ = std::fs::remove_dir_all(&datos);
    } else {
        let _ = std::fs::remove_file(ruta_registro());
    }

    programar_autoborrado(&reg.carpeta);

    Ok(if borrar_datos {
        format!("MARS {} desinstalado, incluidos los datos de {}.", reg.version, datos.display())
    } else {
        format!(
            "MARS {} desinstalado. Tus preferencias y layouts siguen en {}.",
            reg.version,
            datos.display()
        )
    })
}

/// El desinstalador no puede borrarse a sí mismo mientras corre.
///
/// En Windows el archivo está bloqueado por el propio proceso; la salida
/// clásica es dejar un comando que espera a que el proceso muera y recién ahí
/// borra. En Unix un archivo abierto sí se puede desenlazar, así que no hace
/// falta nada.
/// Fin de línea de un archivo .bat.
///
/// Va como escapes y no como un salto literal dentro de la cadena para que no
/// dependa de cómo guarde este archivo el editor de turno: un .bat con finales
/// de línea de Unix funciona de casualidad en el cmd moderno, pero falla de
/// formas raras con etiquetas y bloques.
#[cfg(windows)]
const SALTO_BAT: &str = "\r\n";

#[cfg(windows)]
fn programar_autoborrado(carpeta: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    let Ok(yo) = std::env::current_exe() else { return };
    if !yo.starts_with(carpeta) {
        // Se está corriendo el instalador original, no la copia: no hay nada
        // bloqueado y `borrar_instalacion` ya lo resolvió.
        return;
    }

    // Las órdenes van en un .bat y no en un `cmd /C "…"` por dos razones:
    //
    // 1. `cmd /C` con comillas anidadas es un campo minado —cmd se come el
    //    primer y el último par de comillas— y una ruta con espacios
    //    (%LOCALAPPDATA% siempre los tiene) sale partida en pedazos. El
    //    síntoma es que no borra nada y no dice por qué.
    // 2. El bucle permite reintentar: el proceso puede tardar en soltar el
    //    archivo, y un solo intento a los dos segundos falla en silencio.
    //
    // El .bat se borra a sí mismo al final (`%~f0`).
    let bat = std::env::temp_dir().join("mars-limpieza.bat");
    let (exe, dir) = (yo.display().to_string(), carpeta.display().to_string());
    let guion = [
        "@echo off".to_string(),
        "setlocal".to_string(),
        "for /l %%i in (1,1,15) do (".to_string(),
        format!("  del /f /q \"{exe}\" >nul 2>&1"),
        format!("  if not exist \"{exe}\" goto fin"),
        "  ping 127.0.0.1 -n 2 >nul".to_string(),
        ")".to_string(),
        ":fin".to_string(),
        format!("rmdir \"{dir}\" >nul 2>&1"),
        "del /f /q \"%~f0\" >nul 2>&1".to_string(),
        String::new(),
    ]
    .join(SALTO_BAT);

    if std::fs::write(&bat, guion).is_err() {
        return;
    }

    let _ = std::process::Command::new("cmd")
        .arg("/C")
        .arg(&bat)
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn();
}

#[cfg(not(windows))]
fn programar_autoborrado(carpeta: &Path) {
    if let Ok(yo) = std::env::current_exe() {
        if yo.starts_with(carpeta) {
            let _ = std::fs::remove_file(&yo);
            let _ = std::fs::remove_dir(carpeta);
        }
    }
}

fn nombre_desinstalador() -> String {
    format!("mars-uninstall{}", plataforma::EXT_EXE)
}

/// Copia el instalador dentro de la carpeta de instalación.
fn copiarse(carpeta: &Path) -> Result<String> {
    let yo = std::env::current_exe().context("no sé cuál es mi propio ejecutable")?;
    let destino = carpeta.join(nombre_desinstalador());
    if yo == destino {
        return Ok(nombre_desinstalador());
    }
    std::fs::copy(&yo, &destino)
        .with_context(|| format!("no pude copiarme a {}", destino.display()))?;
    Ok(nombre_desinstalador())
}

fn tamano_total(reg: &Registro) -> u64 {
    reg.archivos
        .iter()
        .filter_map(|rel| std::fs::metadata(reg.carpeta.join(rel)).ok())
        .map(|m| m.len())
        .sum()
}

fn nombre_componente(id: &str) -> &'static str {
    if id == Componente::SimulationStudio.id() {
        Componente::SimulationStudio.nombre()
    } else {
        Componente::MarsDesktop.nombre()
    }
}

/// El nombre que se ve en el menú Inicio.
///
/// La edición Tools se distingue ahí porque si no, dos computadoras del mismo
/// equipo con ediciones distintas muestran lo mismo y nadie sabe cuál tiene
/// cuál.
fn nombre_atajo(comp: Componente, edicion: Edicion) -> String {
    match (comp, edicion) {
        (Componente::MarsDesktop, Edicion::Tools) => "MARS Desktop Tools".to_string(),
        _ => comp.nombre().to_string(),
    }
}

fn tamano_legible(bajado: u64, total: u64) -> String {
    let mb = |b: u64| b as f64 / 1_048_576.0;
    if total > 0 {
        format!("{:.1} de {:.1} MB", mb(bajado), mb(total))
    } else {
        format!("{:.1} MB", mb(bajado))
    }
}

/// Fecha en ISO sin arrastrar una dependencia de calendario.
///
/// Solo se muestra ("instalado el…"), así que la precisión de segundos desde
/// epoch alcanza y `chrono` costaría más de lo que aporta.
fn ahora_iso() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{s}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_atajo_distingue_la_edicion_tools() {
        assert_eq!(nombre_atajo(Componente::MarsDesktop, Edicion::Full), "MARS Desktop");
        assert_eq!(nombre_atajo(Componente::MarsDesktop, Edicion::Tools), "MARS Desktop Tools");
        // El Studio solo existe en Full: su nombre no cambia.
        assert_eq!(
            nombre_atajo(Componente::SimulationStudio, Edicion::Full),
            "MARS Simulation Studio"
        );
    }

    /// Descarga de verdad un paquete de la release y lo abre.
    ///
    /// Cubre el tramo donde más cosas pueden salir mal en silencio: que el
    /// checksum del manifiesto corresponda a los bytes publicados, y que el
    /// ejecutable quede en la RAÍZ de la carpeta de instalación —que es de
    /// donde lo busca mars-desktop al abrir el Simulation Studio—.
    ///
    /// No crea accesos directos ni toca el registro a propósito: eso modifica
    /// la máquina de quien corre los tests. Todo pasa en una carpeta temporal
    /// que se borra al terminar.
    #[tokio::test]
    #[ignore = "necesita red y una release publicada"]
    async fn descarga_y_descomprime_un_paquete_real() {
        let plan = manifiesto::consultar(Edicion::Full).await.expect("consultar");
        let art = plan
            .artefactos
            .iter()
            .find(|a| a.componente == Componente::MarsDesktop.id())
            .expect("la release no trae mars-desktop");

        let dir = std::env::temp_dir().join("mars-installer-test");
        let _ = std::fs::remove_dir_all(&dir);

        let zip = dir.join(&art.archivo);
        crate::descarga::archivo(&art.url, &zip, &art.sha256, |_, _| {})
            .await
            .expect("la descarga o el sha256 fallaron");

        let creados = paquete::extraer(&zip, &dir).expect("no pude descomprimir");
        let exe = Componente::MarsDesktop.archivo_exe();
        assert!(
            creados.iter().any(|c| c == &exe),
            "el paquete no trae {exe} en la raíz, sino: {creados:?}"
        );
        assert!(dir.join(&exe).is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn el_tamano_legible_no_miente_cuando_no_hay_total() {
        assert_eq!(tamano_legible(1_048_576, 2_097_152), "1.0 de 2.0 MB");
        assert_eq!(tamano_legible(1_048_576, 0), "1.0 MB");
    }
}
