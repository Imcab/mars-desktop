//! Integración con el escritorio: accesos directos, entrada en la lista de
//! programas instalados y el runtime de WebView2.
//!
//! Es la parte que más cambia entre sistemas y la que más silenciosamente
//! falla, así que ninguna función de acá es fatal: si un acceso directo no se
//! puede crear, la app instalada funciona igual y el instalador lo dice. Lo
//! único que sí tiene que funcionar es WebView2 en Windows, porque sin él la
//! app abre una ventana en blanco.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// Un acceso directo creado, para poder borrarlo al desinstalar.
pub type Atajo = PathBuf;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// Sin esto, cada llamada a powershell parpadea una consola negra encima
    /// del instalador. Son tres o cuatro por instalación.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn powershell(script: &str) -> Result<()> {
        let salida = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .context("no pude ejecutar powershell")?;
        if !salida.status.success() {
            anyhow::bail!(
                "powershell falló: {}",
                String::from_utf8_lossy(&salida.stderr).trim()
            );
        }
        Ok(())
    }

    /// Carpeta del menú Inicio del usuario (no la de todos los usuarios: no
    /// queremos pedir permisos de administrador).
    fn menu_inicio() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join("Microsoft/Windows/Start Menu/Programs/MARS"))
    }

    fn escritorio() -> Option<PathBuf> {
        dirs::desktop_dir()
    }

    /// Crea un `.lnk` con WScript.Shell, que es el COM que usa el propio
    /// Explorador. Escribir el formato .lnk a mano sería una biblioteca entera.
    fn crear_lnk(destino: &Path, objetivo: &Path, descripcion: &str) -> Result<()> {
        if let Some(padre) = destino.parent() {
            std::fs::create_dir_all(padre)?;
        }
        let dir_trabajo = objetivo.parent().unwrap_or(Path::new("."));
        // Las comillas simples de PowerShell se escapan duplicándolas; una
        // ruta con apóstrofo (C:\Users\D'Angelo\...) rompería el script.
        let q = |p: &Path| p.display().to_string().replace('\'', "''");
        powershell(&format!(
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{}'); \
             $s.TargetPath = '{}'; \
             $s.WorkingDirectory = '{}'; \
             $s.Description = '{}'; \
             $s.IconLocation = '{}'; \
             $s.Save()",
            q(destino),
            q(objetivo),
            q(dir_trabajo),
            descripcion.replace('\'', "''"),
            q(objetivo),
        ))
    }

    pub fn crear_atajos(
        nombre: &str,
        objetivo: &Path,
        en_escritorio: bool,
    ) -> (Vec<Atajo>, Vec<String>) {
        let mut creados = Vec::new();
        let mut avisos = Vec::new();

        if let Some(dir) = menu_inicio() {
            let lnk = dir.join(format!("{nombre}.lnk"));
            match crear_lnk(&lnk, objetivo, nombre) {
                Ok(()) => creados.push(lnk),
                Err(e) => avisos.push(format!("no pude crear el acceso en el menú Inicio: {e}")),
            }
        }
        if en_escritorio {
            if let Some(dir) = escritorio() {
                let lnk = dir.join(format!("{nombre}.lnk"));
                match crear_lnk(&lnk, objetivo, nombre) {
                    Ok(()) => creados.push(lnk),
                    Err(e) => avisos.push(format!("no pude crear el acceso en el escritorio: {e}")),
                }
            }
        }
        (creados, avisos)
    }

    /// Deja MARS en "Aplicaciones instaladas" de Windows, con su botón de
    /// desinstalar apuntando a la copia del instalador que queda en disco.
    pub fn registrar_programa(
        version: &str,
        edicion: &str,
        dir: &Path,
        desinstalador: &Path,
        tamano_kb: u32,
    ) -> Result<()> {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (clave, _) = hkcu
            .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\MARS")
            .context("no pude escribir la entrada de programas instalados")?;

        clave.set_value(
            "DisplayName",
            &format!("MARS Desktop ({})", if edicion == "tools" { "Tools" } else { "Full" }),
        )?;
        clave.set_value("DisplayVersion", &version.to_string())?;
        clave.set_value("Publisher", &"STZ Robotics".to_string())?;
        clave.set_value("InstallLocation", &dir.display().to_string())?;
        clave.set_value("DisplayIcon", &desinstalador.display().to_string())?;
        // Las comillas son obligatorias: sin ellas, una ruta con espacios
        // (y %LOCALAPPDATA% suele tenerlos) se parte en dos argumentos.
        clave.set_value(
            "UninstallString",
            &format!("\"{}\" --uninstall", desinstalador.display()),
        )?;
        clave.set_value("EstimatedSize", &tamano_kb)?;
        clave.set_value("NoModify", &1u32)?;
        clave.set_value("NoRepair", &1u32)?;
        Ok(())
    }

    /// Windows no marca nada que haya que limpiar despues de extraer.
    pub fn tras_extraer(_: &Path) -> Vec<String> {
        Vec::new()
    }

    pub fn desregistrar_programa() -> Result<()> {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        // Que no exista no es un error: desinstalar dos veces tiene que ser
        // inofensivo.
        let _ = hkcu.delete_subkey_all(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\MARS");
        Ok(())
    }

    /// `true` si el runtime de WebView2 está presente.
    ///
    /// Sin él, una app de Tauri abre una ventana en blanco sin ningún mensaje.
    /// Windows 11 lo trae de fábrica; Windows 10 no siempre.
    pub fn hay_webview2() -> bool {
        use winreg::enums::*;
        use winreg::RegKey;
        const CLIENTE: &str =
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

        let tiene = |raiz: RegKey, ruta: &str| -> bool {
            raiz.open_subkey(ruta)
                .and_then(|k| k.get_value::<String, _>("pv"))
                .map(|v| !v.is_empty() && v != "0.0.0.0")
                .unwrap_or(false)
        };

        // Instalación por máquina (en 64 bits queda bajo WOW6432Node) o por
        // usuario. Cualquiera de las tres sirve.
        tiene(RegKey::predef(HKEY_LOCAL_MACHINE), &format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}"))
            || tiene(RegKey::predef(HKEY_LOCAL_MACHINE), CLIENTE)
            || tiene(RegKey::predef(HKEY_CURRENT_USER), CLIENTE)
    }

    /// Baja e instala el runtime de WebView2 con el bootstrapper oficial.
    ///
    /// El enlace es el permanente de Microsoft (fwlink), no una URL versionada:
    /// siempre entrega el instalador vigente.
    pub async fn instalar_webview2() -> Result<()> {
        let destino = crate::descarga::carpeta_temporal().join("MicrosoftEdgeWebview2Setup.exe");
        crate::descarga::archivo(
            "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
            &destino,
            "",
            |_, _| {},
        )
        .await
        .context("no pude bajar el instalador de WebView2")?;

        let estado = Command::new(&destino)
            // Silencioso y por usuario: sin UAC, como el resto de la
            // instalación.
            .args(["/silent", "/install"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .context("no pude ejecutar el instalador de WebView2")?;

        if !estado.success() {
            anyhow::bail!(
                "el instalador de WebView2 terminó con código {}. \
                 Se puede instalar a mano desde \
                 https://developer.microsoft.com/microsoft-edge/webview2/",
                estado.code().unwrap_or(-1)
            );
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
    use super::*;

    fn aplicaciones() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join("applications"))
    }

    /// Un `.desktop` conforme a la spec de freedesktop. Es el equivalente
    /// exacto del .lnk: lo leen GNOME, KDE y cualquier lanzador.
    fn crear_desktop(destino: &Path, nombre: &str, objetivo: &Path) -> Result<()> {
        if let Some(padre) = destino.parent() {
            std::fs::create_dir_all(padre)?;
        }
        let contenido = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name={nombre}\n\
             Comment=MARS — herramientas de robótica FRC\n\
             Exec=\"{}\"\n\
             Path={}\n\
             Icon={}\n\
             Terminal=false\n\
             Categories=Development;Engineering;\n",
            objetivo.display(),
            objetivo.parent().unwrap_or(Path::new(".")).display(),
            objetivo.parent().unwrap_or(Path::new(".")).join("icon.png").display(),
        );
        std::fs::write(destino, contenido)
            .with_context(|| format!("no pude escribir {}", destino.display()))?;

        // Sin el bit de ejecución, GNOME marca el lanzador como "no confiable"
        // y hay que autorizarlo a mano en el menú contextual.
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(destino) {
            let mut p = meta.permissions();
            p.set_mode(p.mode() | 0o755);
            let _ = std::fs::set_permissions(destino, p);
        }
        Ok(())
    }

    pub fn crear_atajos(
        nombre: &str,
        objetivo: &Path,
        en_escritorio: bool,
    ) -> (Vec<Atajo>, Vec<String>) {
        let mut creados = Vec::new();
        let mut avisos = Vec::new();
        let archivo = format!("{}.desktop", nombre.to_lowercase().replace(' ', "-"));

        if let Some(dir) = aplicaciones() {
            let ruta = dir.join(&archivo);
            match crear_desktop(&ruta, nombre, objetivo) {
                Ok(()) => creados.push(ruta),
                Err(e) => avisos.push(format!("no pude crear el lanzador: {e}")),
            }
        }
        if en_escritorio {
            if let Some(dir) = dirs::desktop_dir() {
                let ruta = dir.join(&archivo);
                match crear_desktop(&ruta, nombre, objetivo) {
                    Ok(()) => creados.push(ruta),
                    Err(e) => avisos.push(format!("no pude crear el lanzador del escritorio: {e}")),
                }
            }
        }
        (creados, avisos)
    }

    pub fn tras_extraer(_: &Path) -> Vec<String> {
        Vec::new()
    }

    /// Linux no tiene un registro de programas instalados: el `.desktop` y la
    /// carpeta son todo lo que hay, y de eso ya se encarga `instalacion.rs`.
    pub fn registrar_programa(_: &str, _: &str, _: &Path, _: &Path, _: u32) -> Result<()> {
        Ok(())
    }
    pub fn desregistrar_programa() -> Result<()> {
        Ok(())
    }
    /// En Linux el webview es WebKitGTK y viene del gestor de paquetes.
    pub fn hay_webview2() -> bool {
        true
    }
    pub async fn instalar_webview2() -> Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod imp {
    use super::*;

    /// En macOS el "acceso directo" es un alias en ~/Applications, y la app ya
    /// se instala ahí: no hay nada que crear. Un `.desktop` no existe y un
    /// alias de Finder requiere AppleScript para algo que no aporta.
    pub fn crear_atajos(_: &str, _: &Path, _: bool) -> (Vec<Atajo>, Vec<String>) {
        (Vec::new(), Vec::new())
    }

    /// Quita la cuarentena de Gatekeeper de lo recién instalado.
    ///
    /// macOS le pone el atributo `com.apple.quarantine` a todo lo que baja de
    /// internet, y un binario sin firmar en cuarentena NO ABRE: sale "no se
    /// puede comprobar que no contenga software malicioso" y el usuario tiene
    /// que ir a Preferencias a autorizarlo. Como el instalador es el que
    /// descargó los archivos, puede quitarles la marca él mismo; es
    /// exactamente el consentimiento que Gatekeeper está pidiendo.
    ///
    /// Esto NO reemplaza firmar y notarizar la app, que es lo correcto cuando
    /// haya una cuenta de desarrollador de Apple. Mientras tanto, es la
    /// diferencia entre que abra y que no.
    pub fn tras_extraer(carpeta: &Path) -> Vec<String> {
        match std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(carpeta)
            .status()
        {
            Ok(e) if e.success() => Vec::new(),
            Ok(e) => vec![format!(
                "no pude quitar la cuarentena de Gatekeeper (xattr salió con {}).                  Si macOS no deja abrir la app, hacé clic derecho > Abrir.",
                e.code().unwrap_or(-1)
            )],
            Err(e) => vec![format!("no pude ejecutar xattr: {e}")],
        }
    }
    pub fn registrar_programa(_: &str, _: &str, _: &Path, _: &Path, _: u32) -> Result<()> {
        Ok(())
    }
    pub fn desregistrar_programa() -> Result<()> {
        Ok(())
    }
    /// El webview de macOS es WKWebView, parte del sistema.
    pub fn hay_webview2() -> bool {
        true
    }
    pub async fn instalar_webview2() -> Result<()> {
        Ok(())
    }
}

pub use imp::{
    crear_atajos, desregistrar_programa, hay_webview2, instalar_webview2, registrar_programa,
    tras_extraer,
};

/// Borra los accesos directos que registró una instalación.
pub fn borrar_atajos(atajos: &[PathBuf]) {
    for a in atajos {
        let _ = std::fs::remove_file(a);
    }
    // En Windows queda la carpeta "MARS" del menú Inicio: se va si quedó vacía.
    for a in atajos {
        if let Some(padre) = a.parent() {
            if padre.file_name().is_some_and(|n| n == "MARS") {
                let _ = std::fs::remove_dir(padre);
            }
        }
    }
}
