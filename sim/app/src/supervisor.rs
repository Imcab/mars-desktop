//! Arranca y mata los procesos de la simulación.
//!
//! Son tres: el motor (`mars-sim-server`), la ventana del mundo
//! (`mars-sim-gui`) y el bridge (`mars-bridge`). Ninguno se puede lanzar "a
//! secas": necesitan el entorno de conda en el PATH para encontrar sus DLLs,
//! las rutas de los plugins de gz-sim y de gz-gui, la de los RenderSystem de
//! OGRE, y el directorio de trabajo correcto para que las rutas relativas de
//! los mundos resuelvan. Todo eso vive aquí.
//!
//! La ventana del mundo es la GUI de Gazebo con nuestra configuración de
//! paneles. No carga el mundo: se CONECTA al motor por gz-transport, así que
//! se puede cerrar y volver a abrir sin tocar la física.
//!
//! # Matar de verdad
//!
//! En Windows matar al padre NO mata a los hijos. Si esta app se cierra sin
//! pasar por `detener`, quedan un `mars-sim-server` y un `mars-bridge` vivos
//! consumiendo CPU y, peor, ocupando los tópicos de gz-transport: el siguiente
//! arranque descubre dos motores publicando en `/mars/state/pose` y las poses
//! se pisan sin ningún error.
//!
//! Por eso se mata en tres sitios: en `detener`, en `Drop`, y en el evento de
//! cierre de la ventana. Los tres son necesarios y ninguno cubre al resto.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

/// Qué simulación arrancar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Ruta del mundo, relativa a `sim/`. Ej: `worlds/swerve.sdf`.
    pub world: String,
    /// Ruta del robot-map, relativa a `sim/`. Ej: `models/swerve/robot-map.json`.
    pub robot_map: String,
    /// Servidor NT4 al que se conecta el bridge. En simulación de escritorio lo
    /// levanta el código del robot, casi siempre en localhost.
    #[serde(default = "host_por_defecto")]
    pub nt_host: String,
    #[serde(default = "puerto_por_defecto")]
    pub nt_port: u16,
}

fn host_por_defecto() -> String {
    "127.0.0.1".to_string()
}

fn puerto_por_defecto() -> u16 {
    5810
}

/// Lo que la UI necesita saber para pintar el panel.
#[derive(Debug, Clone, Serialize)]
pub struct Estado {
    pub corriendo: bool,
    pub motor_pid: Option<u32>,
    pub mundo_pid: Option<u32>,
    pub bridge_pid: Option<u32>,
    pub segundos: u64,
    /// Por qué se murió, si se murió solo. `None` mientras corre o si lo
    /// paramos nosotros.
    pub caido: Option<String>,
}

/// Una línea de la página Diagnostics.
///
/// Cada cosa que hace falta para que "Start" funcione se comprueba por
/// separado y dice cómo arreglarse. Es la alternativa a que el usuario
/// descubra que falta un binario cuando el motor muere sin decir por qué.
#[derive(Debug, Clone, Serialize)]
pub struct Chequeo {
    pub nombre: String,
    /// `ok` | `warn` | `fail`
    pub estado: String,
    pub detalle: String,
    /// Qué hacer si no está en `ok`. Vacío cuando no hay nada que hacer.
    pub arreglo: String,
}

impl Chequeo {
    fn nuevo(nombre: &str, ok: bool, detalle: String, arreglo: &str) -> Self {
        Self {
            nombre: nombre.into(),
            estado: if ok { "ok" } else { "fail" }.into(),
            detalle,
            arreglo: if ok { String::new() } else { arreglo.into() },
        }
    }

    /// Un aviso no impide arrancar: la simulación corre, con menos.
    fn aviso(nombre: &str, ok: bool, detalle: String, arreglo: &str) -> Self {
        let mut c = Self::nuevo(nombre, ok, detalle, arreglo);
        if !ok {
            c.estado = "warn".into();
        }
        c
    }
}

pub struct Supervisor {
    /// El directorio `sim/` del repositorio.
    sim_dir: PathBuf,
    /// El prefijo del entorno conda `mars-sim`.
    conda_env: PathBuf,
    motor: Option<Child>,
    mundo: Option<Child>,
    bridge: Option<Child>,
    arranque: Option<Instant>,
    caido: Option<String>,
    /// En CI no hay pantalla: abrir la ventana ahi solo puede fallar.
    sin_ventana: bool,
}

impl Supervisor {
    /// Localiza `sim/` y el entorno conda.
    ///
    /// El orden de búsqueda cubre los dos escenarios que importan: desarrollo,
    /// donde `sim/` está en el repositorio y el ejecutable en `target/debug`, y
    /// una instalación, donde `sim/` viaja junto al ejecutable.
    pub fn descubrir() -> Result<Self> {
        let sim_dir = Self::buscar_sim_dir()
            .context("could not find the sim/ directory. Set MARS_SIM_DIR if it lives elsewhere")?;
        let conda_env = Self::buscar_conda_env().context(
            "could not find the 'mars-sim' conda environment. \
             Create it with: conda env create -f sim/environment.yml",
        )?;

        Ok(Self {
            sim_dir,
            conda_env,
            motor: None,
            mundo: None,
            bridge: None,
            arranque: None,
            caido: None,
            sin_ventana: false,
        })
    }

    fn buscar_sim_dir() -> Option<PathBuf> {
        if let Ok(d) = std::env::var("MARS_SIM_DIR") {
            let p = PathBuf::from(d);
            if p.join("worlds").is_dir() {
                return Some(p);
            }
        }

        // Desde el ejecutable y desde el directorio actual, subiendo. El
        // ejecutable primero: es lo único fiable cuando la app se lanza desde
        // otro sitio, que es justo lo que hace el launcher de mars-desktop.
        let mut raices = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            raices.push(exe);
        }
        if let Ok(cwd) = std::env::current_dir() {
            raices.push(cwd);
        }

        for raiz in raices {
            for dir in raiz.ancestors() {
                for candidato in [dir.join("sim"), dir.to_path_buf()] {
                    if candidato.join("worlds").is_dir() && candidato.join("protocol").is_dir() {
                        return Some(candidato);
                    }
                }
            }
        }
        None
    }

    fn buscar_conda_env() -> Option<PathBuf> {
        let mut candidatos = Vec::new();
        if let Ok(p) = std::env::var("MARS_CONDA_ENV") {
            candidatos.push(PathBuf::from(p));
        }
        if let Ok(p) = std::env::var("CONDA_PREFIX") {
            candidatos.push(PathBuf::from(p));
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            for raiz in ["miniforge3", "miniconda3", "anaconda3"] {
                candidatos.push(Path::new(&home).join(raiz).join("envs/mars-sim"));
            }
        }

        candidatos.into_iter().find(|c| Self::libreria_de(c).is_dir())
    }

    /// Donde conda pone las DLLs. En Windows cuelgan de `Library/`; en Linux y
    /// macOS van directo al prefijo.
    fn libreria_de(env: &Path) -> PathBuf {
        let win = env.join("Library/bin");
        if win.is_dir() {
            win
        } else {
            env.join("bin")
        }
    }

    /// Corre sin abrir la ventana 3D. Para CI, donde no hay pantalla.
    pub fn sin_ventana(&mut self, valor: bool) {
        self.sin_ventana = valor;
    }

    pub fn sim_dir(&self) -> &Path {
        &self.sim_dir
    }

    pub fn conda_env(&self) -> &Path {
        &self.conda_env
    }

    /// Comprueba, una por una, todas las cosas que tienen que estar en su sitio
    /// para que "Start" funcione.
    ///
    /// Existe porque los fallos de esta app son casi todos de instalación --- un
    /// binario sin compilar, una ruta de plugins que no está --- y ninguno se
    /// explica solo: el motor muere con un error de Windows que no dice qué DLL
    /// falta, o la ventana abre gris y el motivo queda en un stderr que nadie
    /// mira.
    pub fn diagnostico(&self) -> Vec<Chequeo> {
        let lib = Self::libreria_de(&self.conda_env);
        let mundos = self.mundos().len();
        let robots = self.robots().len();

        let binario = |nombre: &str, rel: &str, arreglo: &str, critico: bool| {
            let p = self.sim_dir.join(rel);
            let ok = p.is_file();
            let detalle = if ok {
                p.display().to_string()
            } else {
                format!("missing: {}", p.display())
            };
            if critico {
                Chequeo::nuevo(nombre, ok, detalle, arreglo)
            } else {
                Chequeo::aviso(nombre, ok, detalle, arreglo)
            }
        };

        vec![
            Chequeo::nuevo(
                "sim/ directory",
                self.sim_dir.join("worlds").is_dir(),
                self.sim_dir.display().to_string(),
                "Set MARS_SIM_DIR to the sim/ folder of the repository.",
            ),
            Chequeo::nuevo(
                "Conda environment",
                lib.is_dir(),
                self.conda_env.display().to_string(),
                "Create it with: conda env create -f sim/environment.yml",
            ),
            binario(
                "Physics engine (mars-sim-server)",
                "build/mars-sim-server.exe",
                "Build it with sim\\build.ps1",
                true,
            ),
            binario(
                "Bridge (mars-bridge)",
                "bridge/target/debug/mars-bridge.exe",
                "Build it with: cargo build --manifest-path sim/bridge/Cargo.toml",
                true,
            ),
            binario(
                "World window (mars-sim-gui)",
                "build/mars-sim-gui.exe",
                "Build it with sim\\build.ps1. Without it the simulation still runs headless.",
                false,
            ),
            binario(
                "Actuator plugin (MarsLink)",
                "build/MarsLink.dll",
                "Build it with sim\\build.ps1. Without it the world loads with no actuators, silently.",
                true,
            ),
            Chequeo::aviso(
                "OGRE-Next render resources",
                lib.join("OGRE-Next").is_dir(),
                lib.join("OGRE-Next").display().to_string(),
                "Without this path the 3D window opens grey. Reinstall gz-rendering in the conda environment.",
            ),
            Chequeo::nuevo(
                "Worlds",
                mundos > 0,
                format!("{mundos} world(s) in worlds/"),
                "Create one from World Library → New world.",
            ),
            Chequeo::nuevo(
                "Robot maps",
                robots > 0,
                format!("{robots} robot map(s) in models/"),
                "Add a models/<robot>/robot-map.json. See Import Guide.",
            ),
        ]
    }

    /// Mundos disponibles, como rutas relativas a `sim/`.
    pub fn mundos(&self) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(self.sim_dir.join("worlds"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "sdf"))
            .filter_map(|e| e.file_name().into_string().ok())
            .map(|n| format!("worlds/{n}"))
            .collect();
        v.sort();
        v
    }

    /// Robot-maps disponibles, como rutas relativas a `sim/`.
    pub fn robots(&self) -> Vec<String> {
        let mut v = Vec::new();
        for entrada in std::fs::read_dir(self.sim_dir.join("models")).into_iter().flatten().flatten() {
            let mapa = entrada.path().join("robot-map.json");
            if mapa.is_file() {
                if let Some(dir) = entrada.file_name().into_string().ok() {
                    v.push(format!("models/{dir}/robot-map.json"));
                }
            }
        }
        v.sort();
        v
    }

    /// PATH para los hijos: el de conda primero, y sin MSYS2.
    ///
    /// Sin `Library/bin` delante, el motor no encuentra las DLLs de Gazebo y
    /// muere al arrancar con un error de Windows que no dice cuál falta. Y
    /// MSYS2 se filtra porque sus DLLs de nombre coincidente se cuelan antes
    /// que las de conda: el mismo problema que ya obliga a filtrarlo al
    /// compilar.
    fn path_para_hijos(&self) -> String {
        let bin = Self::libreria_de(&self.conda_env);
        let resto: Vec<String> = std::env::var("PATH")
            .unwrap_or_default()
            .split(';')
            .filter(|p| !p.is_empty() && !p.to_lowercase().contains("msys64"))
            .map(String::from)
            .collect();
        format!("{};{}", bin.display(), resto.join(";"))
    }

    /// Variables que necesita la ventana 3D y el motor headless no.
    ///
    /// `OGRE2_RESOURCE_PATH` es la que cuesta encontrar: conda instala los
    /// RenderSystem de OGRE-Next en `Library/bin/OGRE-Next`, y gz-rendering los
    /// busca en la ruta que le grabaron al compilar. Sin esto la ventana abre,
    /// se ve gris y el unico rastro es un `unable to find OpenGL 3+ Rendering
    /// Subsystem` en stderr.
    fn entorno_de_render(&self, cmd: &mut Command) {
        let lib = self.conda_env.join("Library");
        // La ventana resuelve por su cuenta las mallas que le llegan por
        // gz-transport, asi que necesita las mismas rutas de modelos que el
        // motor: si no, el mundo tiene las pelotas y la ventana no las dibuja.
        cmd.env("GZ_SIM_RESOURCE_PATH", self.sim_dir.join("models"));
        cmd.env("OGRE2_RESOURCE_PATH", lib.join("bin/OGRE-Next"));
        cmd.env(
            "GZ_GUI_PLUGIN_PATH",
            format!(
                "{};{}",
                lib.join("lib/gz-gui-10/plugins").display(),
                lib.join("lib/gz-sim-10/plugins/gui").display()
            ),
        );
    }

    fn abrir_log(&self, nombre: &str) -> Result<Stdio> {
        let dir = self.sim_dir.join("build");
        std::fs::create_dir_all(&dir)?;
        let f = std::fs::File::create(dir.join(nombre))?;
        Ok(Stdio::from(f))
    }

    pub fn arrancar(&mut self, cfg: &Config) -> Result<()> {
        if self.corriendo() {
            bail!("the simulation is already running");
        }
        self.caido = None;

        let motor_exe = self.sim_dir.join("build/mars-sim-server.exe");
        let bridge_exe = self.sim_dir.join("bridge/target/debug/mars-bridge.exe");
        for exe in [&motor_exe, &bridge_exe] {
            if !exe.is_file() {
                bail!("{} is missing. Build it with sim\\build.ps1 and cargo build", exe.display());
            }
        }
        if !self.sim_dir.join(&cfg.world).is_file() {
            bail!("world {} does not exist", cfg.world);
        }
        if !self.sim_dir.join(&cfg.robot_map).is_file() {
            bail!("robot map {} does not exist", cfg.robot_map);
        }

        let path = self.path_para_hijos();

        // El motor primero: el bridge se muere si no encuentra a nadie
        // publicando, y de todas formas necesita que el servidor NT4 exista.
        let motor = Command::new(&motor_exe)
            .args([cfg.world.as_str(), "run"])
            .current_dir(&self.sim_dir)
            .env("PATH", &path)
            // Aquí busca gz-sim los systems propios; sin esto MarsLink no se
            // carga y el mundo arranca sin actuadores, en silencio.
            .env("GZ_SIM_SYSTEM_PLUGIN_PATH", self.sim_dir.join("build"))
            // Donde resuelven los `model://`. Sin esto un mundo que incluye
            // `model://fuel` carga sin las pelotas y solo lo dice una linea de
            // stderr; la fisica sigue corriendo, asi que parece que el mundo
            // esta bien y simplemente no hay nada dentro.
            .env("GZ_SIM_RESOURCE_PATH", self.sim_dir.join("models"))
            .stdout(self.abrir_log("app-motor.log")?)
            .stderr(self.abrir_log("app-motor.err")?)
            .spawn()
            .with_context(|| format!("could not launch {}", motor_exe.display()))?;
        self.motor = Some(motor);

        // Un respiro para que el discovery de gz-transport se entere del motor
        // antes de que se suscriban la ventana y el bridge. Sin esto arrancan,
        // no ven nada y se quedan esperando su timeout.
        std::thread::sleep(std::time::Duration::from_millis(800));

        // La ventana del mundo. Si no esta compilada se sigue sin ella: la
        // simulacion es util headless (es como corre en CI) y quedarse sin
        // fisica por no poder dibujarla seria absurdo.
        let mundo_exe = self.sim_dir.join("build/mars-sim-gui.exe");
        if self.sin_ventana {
            eprintln!("[sup] headless mode: no 3D window");
        } else if mundo_exe.is_file() {
            let mut cmd = Command::new(&mundo_exe);
            cmd.arg("gui/mars.config")
                .current_dir(&self.sim_dir)
                .env("PATH", &path)
                .stdout(self.abrir_log("app-mundo.log")?)
                .stderr(self.abrir_log("app-mundo.err")?);
            self.entorno_de_render(&mut cmd);
            match cmd.spawn() {
                Ok(m) => self.mundo = Some(m),
                Err(e) => eprintln!("[sup] no 3D window: {e}"),
            }
        } else {
            eprintln!("[sup] no 3D window: {} is missing", mundo_exe.display());
        }

        let bridge = Command::new(&bridge_exe)
            .args([
                "--robot-map",
                cfg.robot_map.as_str(),
                "--nt-host",
                cfg.nt_host.as_str(),
                "--nt-port",
                &cfg.nt_port.to_string(),
            ])
            .current_dir(&self.sim_dir)
            .env("PATH", &path)
            .stdout(self.abrir_log("app-bridge.log")?)
            .stderr(self.abrir_log("app-bridge.err")?)
            .spawn();

        match bridge {
            Ok(b) => self.bridge = Some(b),
            Err(e) => {
                // Si el bridge no arranca, el motor no puede quedarse suelto.
                self.detener();
                return Err(anyhow!("could not launch the bridge: {e}"));
            }
        }

        self.arranque = Some(Instant::now());
        Ok(())
    }

    pub fn detener(&mut self) {
        // El bridge primero: matar el motor mientras el bridge escribe deja
        // errores de conexión en su log que no son la causa de nada.
        for hijo in [self.bridge.take(), self.mundo.take(), self.motor.take()]
            .into_iter()
            .flatten()
        {
            let mut hijo = hijo;
            let _ = hijo.kill();
            let _ = hijo.wait();
        }
        self.arranque = None;
    }

    fn corriendo(&mut self) -> bool {
        self.motor.is_some() || self.bridge.is_some() || self.mundo.is_some()
    }

    /// Estado actual, recogiendo de paso a los hijos que se hayan muerto solos.
    pub fn estado(&mut self) -> Estado {
        // `try_wait` es lo que convierte un proceso muerto en un estado
        // visible. Sin esto la UI diría "corriendo" para siempre después de un
        // crash, que es la peor forma de fallar: silenciosa.
        // La ventana NO entra aqui: cerrarla es algo que el usuario hace a
        // proposito y no debe matar la simulacion. Se recoge aparte.
        if let Some(Ok(Some(_))) = self.mundo.as_mut().map(|h| h.try_wait()) {
            self.mundo = None;
        }

        for (nombre, ranura) in [("the engine", &mut self.motor), ("the bridge", &mut self.bridge)] {
            let salio = match ranura.as_mut().map(|h| h.try_wait()) {
                Some(Ok(Some(status))) => Some(status),
                _ => None,
            };
            if let Some(status) = salio {
                *ranura = None;
                if self.caido.is_none() {
                    self.caido = Some(format!("{nombre} exited ({status})"));
                }
            }
        }

        // Si uno se cayó, el otro no tiene con quién hablar.
        if self.caido.is_some() && (self.motor.is_some() || self.bridge.is_some()) {
            self.detener();
        }

        Estado {
            corriendo: self.motor.is_some() && self.bridge.is_some(),
            motor_pid: self.motor.as_ref().map(|h| h.id()),
            mundo_pid: self.mundo.as_ref().map(|h| h.id()),
            bridge_pid: self.bridge.as_ref().map(|h| h.id()),
            segundos: self.arranque.map(|t| t.elapsed().as_secs()).unwrap_or(0),
            caido: self.caido.clone(),
        }
    }

    /// Últimas líneas de un log, para el panel.
    pub fn log(&self, nombre: &str, lineas: usize) -> String {
        let ruta = self.sim_dir.join("build").join(nombre);
        let texto = std::fs::read_to_string(&ruta).unwrap_or_default();
        let todas: Vec<&str> = texto.lines().collect();
        todas[todas.len().saturating_sub(lineas)..].join("\n")
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.detener();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El JSON que manda la UI tiene que caer en `Config` campo por campo.
    ///
    /// Es el mismo objeto literal de `ui/index.html`. Un nombre que no coincida
    /// no da error de compilación en ningún lado: serde falla en tiempo de
    /// ejecución, con la ventana ya abierta y el usuario dándole a Arrancar.
    #[test]
    fn la_ui_y_config_hablan_el_mismo_json() {
        let de_la_ui = r#"{
            "world": "worlds/swerve.sdf",
            "robot_map": "models/swerve/robot-map.json",
            "nt_host": "127.0.0.1",
            "nt_port": 5810
        }"#;
        let cfg: Config = serde_json::from_str(de_la_ui).expect("la UI manda algo que Config no lee");
        assert_eq!(cfg.world, "worlds/swerve.sdf");
        assert_eq!(cfg.robot_map, "models/swerve/robot-map.json");
        assert_eq!(cfg.nt_port, 5810);
    }

    /// Los campos con defecto pueden faltar.
    #[test]
    fn el_servidor_nt4_tiene_defecto() {
        let minimo = r#"{"world": "worlds/empty.sdf", "robot_map": "models/testbot/robot-map.json"}"#;
        let cfg: Config = serde_json::from_str(minimo).expect("faltan defectos");
        assert_eq!(cfg.nt_host, "127.0.0.1");
        assert_eq!(cfg.nt_port, 5810);
    }
}
