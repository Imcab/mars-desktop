//! Lo que cambia entre Windows, Linux y macOS: nombres de archivo, rutas por
//! defecto y qué componentes existen en cada uno.
//!
//! Todo lo específico de una plataforma vive acá o en `integracion.rs`. El
//! resto del instalador trabaja con estos valores y no pregunta por el sistema
//! operativo, así que agregar una plataforma es tocar estos dos archivos.

use std::path::PathBuf;

/// Identificador del sistema tal como aparece en el nombre de los archivos de
/// una release: `mars-desktop-full-windows-x86_64.zip`.
pub const SO: &str = if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "macos") {
    "macos"
} else {
    "linux"
};

/// Arquitectura, con los mismos nombres que usa Rust.
pub const ARCH: &str = if cfg!(target_arch = "aarch64") {
    "aarch64"
} else {
    "x86_64"
};

/// Extensión del paquete que sabemos abrir en esta plataforma.
pub const EXT_PAQUETE: &str = if cfg!(windows) { "zip" } else { "tar.gz" };

/// Sufijo de los ejecutables.
pub const EXT_EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// Los tres componentes del ecosistema. El `id` es el que usan los nombres de
/// archivo de la release y el registro de instalación.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Componente {
    /// La aplicación de dashboard. Siempre se instala.
    MarsDesktop,
    /// El simulador. Solo en la edición Full, y no en macOS.
    SimulationStudio,
}

impl Componente {
    pub fn id(&self) -> &'static str {
        match self {
            Componente::MarsDesktop => "mars-desktop",
            Componente::SimulationStudio => "mars-simulation-studio",
        }
    }

    pub fn nombre(&self) -> &'static str {
        match self {
            Componente::MarsDesktop => "MARS Desktop",
            Componente::SimulationStudio => "MARS Simulation Studio",
        }
    }

    /// Nombre del ejecutable dentro del paquete, sin extensión.
    ///
    /// No es el nombre bonito: es el que produce cargo, y mars-desktop busca
    /// al Studio por este nombre exacto (ver `simlauncher.rs`). Los nombres
    /// presentables van en los accesos directos.
    pub fn binario(&self) -> &'static str {
        match self {
            Componente::MarsDesktop => "mars-desktop",
            Componente::SimulationStudio => "mars-sim-app",
        }
    }

    pub fn archivo_exe(&self) -> String {
        format!("{}{}", self.binario(), EXT_EXE)
    }
}

/// Edición elegida en la pantalla de selección.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edicion {
    /// Todo el ecosistema MARS.
    Full,
    /// Solo el dashboard de NetworkTables, sin nada del framework.
    Tools,
}

impl Edicion {
    pub fn id(&self) -> &'static str {
        match self {
            Edicion::Full => "full",
            Edicion::Tools => "tools",
        }
    }
}

/// Qué componentes trae una edición EN ESTA plataforma.
///
/// El Simulation Studio arrastra Gazebo, que hoy solo se construye para
/// Windows y Linux: en macOS la edición Full es la app con el framework, sin
/// simulador. La pantalla de selección lo dice antes de instalar, no después.
pub fn componentes(edicion: Edicion) -> Vec<Componente> {
    let mut v = vec![Componente::MarsDesktop];
    if edicion == Edicion::Full && hay_simulation_studio() {
        v.push(Componente::SimulationStudio);
    }
    v
}

pub const fn hay_simulation_studio() -> bool {
    !cfg!(target_os = "macos")
}

/// Carpeta de instalación por defecto.
///
/// Siempre por usuario, nunca en Archivos de programa ni en /opt: instalar sin
/// permisos de administrador es lo que permite que un estudiante lo haga en la
/// computadora del laboratorio sin pedirle la contraseña a nadie.
pub fn destino_por_defecto() -> PathBuf {
    #[cfg(windows)]
    {
        // %LOCALAPPDATA%\Programs es donde ponen sus apps VS Code y Discord.
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Programs")
            .join("MARS")
    }
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Applications")
            .join("MARS")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // ~/.local/share, como manda la spec XDG.
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("MARS")
    }
}

/// Carpeta de datos del usuario: preferencias, workspaces y assets 3D.
///
/// La comparten las dos ediciones y NO se borra al desinstalar salvo que lo
/// pidan explícitamente. Es la misma que usa mars-desktop
/// (`dirs::config_dir()/MARS`), así que reinstalar no pierde nada.
pub fn datos_usuario() -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("MARS")
}

/// Nombre del archivo de una release para un componente y edición dados.
///
/// Es el contrato con `scripts/package-release.mjs` y con el workflow: si acá
/// cambia, allá también. Un nombre mal formado se manifiesta como "no hay
/// build para tu plataforma", que es un mensaje honesto pero inútil.
pub fn nombre_archivo(componente: Componente, edicion: Edicion) -> String {
    match componente {
        // Solo el dashboard tiene ediciones; el Studio es uno solo.
        Componente::MarsDesktop => format!(
            "mars-desktop-{}-{}-{}.{}",
            edicion.id(),
            SO,
            ARCH,
            EXT_PAQUETE
        ),
        Componente::SimulationStudio => format!(
            "mars-simulation-studio-{}-{}.{}",
            SO, ARCH, EXT_PAQUETE
        ),
    }
}
