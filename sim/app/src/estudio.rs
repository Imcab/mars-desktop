//! Lo que MARS Simulation Studio necesita del disco: mundos, robots, ficheros
//! y preferencias.
//!
//! El supervisor (`supervisor.rs`) solo sabe *arrancar* una simulación. Todo lo
//! de autoría --- crear un mundo, importarlo, editarlo, leer un robot-map ---
//! vive aquí, separado a propósito: un fallo escribiendo un SDF no tiene por
//! qué poder tocar el código que mata procesos.
//!
//! # Mundos gestionados
//!
//! Un mundo creado desde el Studio se guarda DOS veces: el `.sdf` que come
//! Gazebo y un `.studio.json` al lado con las propiedades que lo generaron.
//! Ese JSON es lo que permite volver a abrir el árbol de propiedades y
//! reescribir el SDF sin perder nada.
//!
//! Un `.sdf` sin su JSON es un mundo EXTERNO: se puede leer, correr y editar a
//! mano, pero el árbol de propiedades no lo toca. Regenerar un SDF escrito a
//! mano a partir de lo poco que un regex puede sacar de él sería destruir
//! trabajo ajeno en silencio, que es peor que no ofrecer el botón.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

// --- rutas -------------------------------------------------------------

/// Resuelve una ruta relativa contra `sim/` y se niega a salir de ahí.
///
/// La UI manda rutas como texto. Sin esta comprobación, un `../../..` en un
/// campo de texto convierte "guardar mundo" en "escribir donde sea".
pub fn resolver(sim_dir: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() {
        bail!("ruta vacía");
    }
    let p = Path::new(&rel);
    if p.is_absolute() {
        bail!("{rel}: se esperaba una ruta relativa a sim/");
    }
    for c in p.components() {
        use std::path::Component::*;
        match c {
            Normal(_) | CurDir => {}
            ParentDir => bail!("{rel}: no se permite subir de sim/"),
            _ => bail!("{rel}: ruta no admitida"),
        }
    }
    Ok(sim_dir.join(p))
}

/// Igual que `resolver`, pero además exige que caiga en uno de los
/// directorios editables. Leer cualquier cosa de `sim/` es inofensivo;
/// escribir en `build/` o en `bridge/src/` no lo es.
fn resolver_editable(sim_dir: &Path, rel: &str) -> Result<PathBuf> {
    let normal = rel.replace('\\', "/");
    let ok = ["worlds/", "models/", "gui/", "protocol/"]
        .iter()
        .any(|d| normal.starts_with(d));
    if !ok {
        bail!("{rel}: solo se puede escribir dentro de worlds/, models/, gui/ o protocol/");
    }
    resolver(sim_dir, &normal)
}

fn nombre_de_archivo_valido(nombre: &str) -> Result<()> {
    if nombre.is_empty() {
        bail!("el nombre no puede estar vacío");
    }
    if !nombre
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!("'{nombre}': usá solo letras, números, guion y guion bajo");
    }
    Ok(())
}

// --- inventario --------------------------------------------------------

/// Una línea de la biblioteca de mundos.
#[derive(Debug, Serialize)]
pub struct MundoInfo {
    /// Ruta relativa a `sim/`. Es la que come el supervisor.
    pub ruta: String,
    pub archivo: String,
    /// El `<world name="...">` del SDF. Tiene que ser `mars` (ver `notas`).
    pub mundo: String,
    pub modelos: usize,
    pub incluye: usize,
    pub plugins: usize,
    pub luces: usize,
    pub paso: Option<f64>,
    pub rtf: Option<f64>,
    pub bytes: u64,
    /// `true` si tiene su `.studio.json` al lado: editable desde el árbol.
    pub gestionado: bool,
    pub descripcion: Option<String>,
    /// Problemas que impedirían correrlo, en inglés (van directo a la UI).
    pub notas: Vec<String>,
}

/// Una línea de la biblioteca de robots.
#[derive(Debug, Serialize)]
pub struct RobotInfo {
    pub ruta: String,
    pub carpeta: String,
    pub robot: String,
    pub perfil: String,
    pub mundo: String,
    pub modelo: String,
    pub sdf: Option<String>,
    pub actuadores: usize,
    pub encoders: usize,
    pub imu: bool,
    pub notas: Vec<String>,
}

/// Lo que un regex puede sacar de un SDF sin pretender ser un parser.
fn resumen_sdf(texto: &str) -> (String, usize, usize, usize, usize, Option<f64>, Option<f64>) {
    let cuenta = |aguja: &str| texto.matches(aguja).count();
    let mundo = entre(texto, "<world name=\"", "\"").unwrap_or_default();
    (
        mundo,
        cuenta("<model "),
        cuenta("<include>"),
        cuenta("<plugin "),
        cuenta("<light "),
        numero_de(texto, "max_step_size"),
        numero_de(texto, "real_time_factor"),
    )
}

fn entre(texto: &str, desde: &str, hasta: &str) -> Option<String> {
    let i = texto.find(desde)? + desde.len();
    let resto = &texto[i..];
    let j = resto.find(hasta)?;
    Some(resto[..j].to_string())
}

fn numero_de(texto: &str, etiqueta: &str) -> Option<f64> {
    entre(texto, &format!("<{etiqueta}>"), &format!("</{etiqueta}>"))?
        .trim()
        .parse()
        .ok()
}

pub fn mundos_detalle(sim_dir: &Path) -> Vec<MundoInfo> {
    let mut v: Vec<MundoInfo> = std::fs::read_dir(sim_dir.join("worlds"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "sdf"))
        .map(|e| {
            let ruta_abs = e.path();
            let archivo = e.file_name().to_string_lossy().to_string();
            let texto = std::fs::read_to_string(&ruta_abs).unwrap_or_default();
            let (mundo, modelos, incluye, plugins, luces, paso, rtf) = resumen_sdf(&texto);

            let json = ruta_abs.with_extension("studio.json");
            let gestionado = json.is_file();
            let descripcion = std::fs::read_to_string(&json)
                .ok()
                .and_then(|t| serde_json::from_str::<MundoSpec>(&t).ok())
                .map(|s| s.descripcion);

            // Estas tres son las que hacen que un mundo importado no arranque, y
            // las tres son invisibles hasta que el motor falla.
            let mut notas = Vec::new();
            if mundo.is_empty() {
                notas.push("No <world name=\"...\"> declared.".into());
            } else if mundo != "mars" {
                notas.push(format!(
                    "World is named \"{mundo}\"; the MARS protocol requires \"mars\"."
                ));
            }
            if !texto.contains("gz-sim-physics-system") {
                notas.push("No physics system plugin: nothing will move.".into());
            }
            if !texto.contains("gz-sim-scene-broadcaster-system") {
                notas.push("No scene broadcaster: the bridge will see no state.".into());
            }

            MundoInfo {
                ruta: format!("worlds/{archivo}"),
                archivo,
                mundo,
                modelos,
                incluye,
                plugins,
                luces,
                paso,
                rtf,
                bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                gestionado,
                descripcion,
                notas,
            }
        })
        .collect();
    v.sort_by(|a, b| a.archivo.cmp(&b.archivo));
    v
}

pub fn robots_detalle(sim_dir: &Path) -> Vec<RobotInfo> {
    let mut v = Vec::new();
    for entrada in std::fs::read_dir(sim_dir.join("models"))
        .into_iter()
        .flatten()
        .flatten()
    {
        let mapa = entrada.path().join("robot-map.json");
        if !mapa.is_file() {
            continue;
        }
        let carpeta = entrada.file_name().to_string_lossy().to_string();
        let texto = std::fs::read_to_string(&mapa).unwrap_or_default();
        let json: serde_json::Value =
            serde_json::from_str(&texto).unwrap_or(serde_json::Value::Null);

        let cadena = |k: &str| {
            json.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        let largo = |k: &str| {
            json.get(k)
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        };

        let sdf = json.get("sdf").and_then(|v| v.as_str()).map(String::from);
        let mut notas = Vec::new();
        match &sdf {
            Some(s) if !sim_dir.join(s).is_file() => {
                notas.push(format!("Declared SDF \"{s}\" does not exist."))
            }
            None => notas.push("No \"sdf\" field: check.py cannot verify actuator order.".into()),
            _ => {}
        }
        if largo("actuators") == 0 {
            notas.push("No actuators declared.".into());
        }

        v.push(RobotInfo {
            ruta: format!("models/{carpeta}/robot-map.json"),
            carpeta,
            robot: cadena("robot"),
            perfil: cadena("profile"),
            mundo: cadena("world"),
            modelo: cadena("model"),
            sdf,
            actuadores: largo("actuators"),
            encoders: largo("encoders"),
            imu: json.get("imu").is_some_and(|v| !v.is_null()),
            notas,
        });
    }
    v.sort_by(|a, b| a.carpeta.cmp(&b.carpeta));
    v
}

// --- la cancha ---------------------------------------------------------

/// Una cancha 3D disponible para meter en un mundo.
///
/// El formato es el de AdvantageScope tal cual --- una carpeta con
/// `config.json` y `model.glb` --- porque es el mismo que ya consume el Field
/// 3D de mars-desktop. Reusarlo significa que una cancha descargada allí sirve
/// aquí sin convertir nada.
#[derive(Debug, Serialize)]
pub struct CampoInfo {
    pub nombre: String,
    /// Ruta del `.glb` relativa a `sim/`. Vacía si todavía no está en el
    /// proyecto (ver `instalado`).
    pub ruta: String,
    /// Ruta absoluta de la carpeta de origen, para instalarla.
    pub origen: String,
    /// `project` si vive en `sim/fields/`, `mars-desktop` si está en los
    /// assets del dashboard.
    pub fuente: String,
    pub instalado: bool,
    /// Área de juego en metros, de `widthInches`/`heightInches`.
    pub largo_m: f64,
    pub ancho_m: f64,
    pub bytes: u64,
    /// El `coordinateSystem` que declara el config. Informativo.
    pub sistema: String,
}

/// Donde mars-desktop instala las canchas 3D (`src-tauri/src/assets3d.rs`).
fn dir_assets_dashboard() -> Option<PathBuf> {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join(".local/share"))
        })?;
    let d = base.join("MARS/assets3d");
    d.is_dir().then_some(d)
}

fn leer_campo(dir: &Path, fuente: &str, sim_dir: &Path) -> Option<CampoInfo> {
    let glb = dir.join("model.glb");
    if !glb.is_file() {
        return None;
    }
    let nombre_dir = dir.file_name()?.to_string_lossy().to_string();

    // El config.json es opcional: sin él la cancha se puede usar igual, solo
    // que no se sabe qué área de juego cubre.
    let cfg: serde_json::Value = std::fs::read_to_string(dir.join("config.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::Value::Null);
    let pulgadas = |k: &str| cfg.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0) * 0.0254;

    let en_proyecto = dir.starts_with(sim_dir);
    Some(CampoInfo {
        nombre: cfg
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&nombre_dir)
            .to_string(),
        ruta: if en_proyecto {
            format!("fields/{nombre_dir}/model.glb")
        } else {
            String::new()
        },
        origen: dir.display().to_string(),
        fuente: fuente.to_string(),
        instalado: en_proyecto,
        largo_m: pulgadas("widthInches"),
        ancho_m: pulgadas("heightInches"),
        bytes: glb.metadata().map(|m| m.len()).unwrap_or(0),
        sistema: cfg
            .get("coordinateSystem")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

/// Canchas del proyecto primero, luego las que mars-desktop tenga instaladas.
pub fn campos(sim_dir: &Path) -> Vec<CampoInfo> {
    let mut v = Vec::new();
    let mut vistos = Vec::new();

    for e in std::fs::read_dir(sim_dir.join("fields"))
        .into_iter()
        .flatten()
        .flatten()
    {
        if let Some(c) = leer_campo(&e.path(), "project", sim_dir) {
            // Se compara por el nombre del config, no por el de la carpeta: al
            // instalar se renombra ("Field3d_2026FRCFieldV1" -> "2026-rebuilt")
            // y comparando carpetas la misma cancha salia en las dos listas.
            vistos.push(c.nombre.clone());
            v.push(c);
        }
    }

    if let Some(assets) = dir_assets_dashboard() {
        for e in std::fs::read_dir(assets).into_iter().flatten().flatten() {
            if let Some(c) = leer_campo(&e.path(), "mars-desktop", sim_dir) {
                if !vistos.contains(&c.nombre) {
                    v.push(c);
                }
            }
        }
    }

    v.sort_by(|a, b| b.instalado.cmp(&a.instalado).then(a.nombre.cmp(&b.nombre)));
    v
}

/// Copia una cancha a `sim/fields/<nombre>/` y la deja renderizable.
///
/// Se copia en vez de referenciarla donde está a propósito: un mundo que
/// apunta a `%APPDATA%` no abre en otra máquina, y los mundos son parte del
/// repositorio.
pub fn instalar_campo(sim_dir: &Path, origen: &str, nombre: &str) -> Result<String> {
    nombre_de_archivo_valido(nombre)?;
    let origen = PathBuf::from(origen);
    if !origen.join("model.glb").is_file() {
        bail!("{} has no model.glb", origen.display());
    }
    let destino = sim_dir.join("fields").join(nombre);
    if destino.exists() {
        bail!("fields/{nombre} already exists");
    }
    copiar_arbol(&origen, &destino)?;

    for glb in ["model.glb", "model_0.glb"] {
        let p = destino.join(glb);
        if p.is_file() {
            aplanar_metales(&p)
                .with_context(|| format!("no se pudo preparar {}", p.display()))?;
        }
    }
    Ok(format!("fields/{nombre}/model.glb"))
}

/// Apaga el metalizado de los materiales de un `.glb`, en sitio.
///
/// # Por qué hace falta
///
/// Los modelos oficiales de cancha declaran `metallicFactor: 1.0` con una
/// rugosidad muy baja en casi todos sus materiales. Un material así, bajo un
/// renderizador PBR, no tiene color propio: refleja el entorno. Y OGRE2 en
/// esta configuración no tiene mapa de entorno, así que lo que refleja es
/// negro. La cancha carga, la física va, y en pantalla hay una mancha negra
/// con forma de cancha. (AdvantageScope resuelve lo mismo forzando
/// `MeshPhongMaterial`, por la misma razón.)
///
/// # Por qué el parche es a nivel de bytes
///
/// Porque reserializar el JSON del glTF --- leerlo con serde y volver a
/// escribirlo --- deja un archivo estructuralmente válido que **cuelga a la
/// ventana de Gazebo indefinidamente** (probado: más de ocho minutos sin
/// abrir, contra los treinta segundos del original). No se investigó por qué;
/// no hace falta, porque el parche mínimo es además el correcto: sustituir el
/// número por otro de la MISMA longitud no mueve un solo offset del archivo.
fn aplanar_metales(glb: &Path) -> Result<usize> {
    const CABECERA: usize = 12;
    let mut d = std::fs::read(glb)?;
    if d.len() < CABECERA + 8 || &d[0..4] != b"glTF" {
        bail!("{} is not a binary glTF", glb.display());
    }

    let len_json = u32::from_le_bytes(d[CABECERA..CABECERA + 4].try_into()?) as usize;
    if &d[CABECERA + 4..CABECERA + 8] != b"JSON" {
        bail!("{}: first chunk is not JSON", glb.display());
    }
    let ini = CABECERA + 8;
    let fin = ini + len_json;
    if fin > d.len() {
        bail!("{}: truncated JSON chunk", glb.display());
    }

    let mut cambios = 0;
    cambios += sustituir_numero(&mut d[ini..fin], b"\"metallicFactor\":", "0");
    cambios += sustituir_numero(&mut d[ini..fin], b"\"roughnessFactor\":", "0.7");

    if cambios > 0 {
        std::fs::write(glb, &d)?;
    }
    Ok(cambios)
}

/// Reescribe cada `"<clave>":<numero>` con `valor`, rellenando con ceros hasta
/// la longitud original.
///
/// `0` -> `0.0000`, `0.7` -> `0.70000`: siguen siendo JSON válido y ocupan
/// exactamente lo mismo, que es la condición que hace seguro el parche. Si el
/// hueco no da ni para `valor`, se deja como estaba.
fn sustituir_numero(json: &mut [u8], clave: &[u8], valor: &str) -> usize {
    let mut cambios = 0;
    let mut i = 0;
    while let Some(p) = buscar(&json[i..], clave) {
        let ini = i + p + clave.len();
        let mut fin = ini;
        while fin < json.len() && !matches!(json[fin], b',' | b'}') {
            fin += 1;
        }
        let hueco = fin - ini;
        if hueco >= valor.len() {
            let mut nuevo = valor.as_bytes().to_vec();
            // El relleno tiene que ir DESPUÉS de un punto decimal, o `0` + `00`
            // daría `000`, que no es número JSON.
            if !valor.contains('.') && hueco > valor.len() {
                nuevo.push(b'.');
            }
            while nuevo.len() < hueco {
                nuevo.push(b'0');
            }
            if json[ini..fin] != nuevo[..] {
                json[ini..fin].copy_from_slice(&nuevo);
                cambios += 1;
            }
        }
        i = fin;
    }
    cambios
}

fn buscar(heno: &[u8], aguja: &[u8]) -> Option<usize> {
    heno.windows(aguja.len()).position(|w| w == aguja)
}

// --- el generador de mundos --------------------------------------------

/// Un objeto suelto en el mundo: caja, cilindro, esfera o malla.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prop {
    pub nombre: String,
    /// `box` | `cylinder` | `sphere` | `mesh`
    pub forma: String,
    /// box: x,y,z --- cylinder: radio,largo,_ --- sphere: radio,_,_
    pub tamano: [f64; 3],
    pub masa: f64,
    pub estatico: bool,
    /// x y z roll pitch yaw, en metros y radianes (SI, como todo en gz).
    pub pose: [f64; 6],
    pub color: [f64; 4],
    /// URI de la malla cuando `forma == "mesh"`.
    #[serde(default)]
    pub malla: String,
}

/// Todo lo que el árbol de propiedades del World Editor puede cambiar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MundoSpec {
    pub archivo: String,
    #[serde(default)]
    pub descripcion: String,

    // Física
    pub paso: f64,
    pub rtf: f64,
    /// `dart` | `bullet-featherstone`
    pub motor_fisica: String,
    pub gravedad: f64,

    // Suelo y cancha
    pub suelo: bool,
    pub friccion: f64,
    pub friccion2: f64,
    pub cancha_largo: f64,
    pub cancha_ancho: f64,
    pub color_suelo: [f64; 4],

    /// Malla de la cancha FRC, relativa a `sim/`. Vacío = sin cancha.
    ///
    /// Entra SOLO como visual. La cancha 2026 son ~2.9 M triángulos: usarla
    /// como colisión reventaría el real-time factor, del que depende la
    /// validez de todo el lazo.
    #[serde(default)]
    pub campo: String,
    /// x y z roll pitch yaw. El roll de 90° por defecto es porque el glTF
    /// viene Y-arriba y Gazebo es Z-arriba.
    #[serde(default = "pose_campo")]
    pub campo_pose: [f64; 6],
    #[serde(default = "uno")]
    pub campo_escala: f64,

    // --- FUEL (el elemento de puntuacion de REBUILT) ---
    //
    // Cuantas pelotas fisicas se siembran. NO son las que dibuja la malla de
    // la cancha: esa lleva 456 FUEL horneados como decorado, sin fisica.
    /// Numero de FUEL con fisica. 0 = ninguno.
    #[serde(default)]
    pub fuel: usize,
    /// Ancho y fondo de la caja donde se siembran, en metros. El valor por
    /// defecto es el de la NEUTRAL ZONE del manual: 206.0 x 72.0 in.
    #[serde(default = "area_fuel")]
    pub fuel_area: [f64; 2],
    /// Centro de esa caja. (0,0) es el centro de la cancha, o sea la linea
    /// central, que es donde el manual las pone.
    #[serde(default)]
    pub fuel_centro: [f64; 2],
    /// Altura de suelta sobre el piso. 0 = apoyadas.
    #[serde(default)]
    pub fuel_altura: f64,

    // Perímetro
    pub muros: bool,
    pub muro_alto: f64,
    pub muro_grosor: f64,

    // Luz y escena
    pub sol: bool,
    pub sombras: bool,
    pub sol_direccion: [f64; 3],
    pub sol_intensidad: f64,
    pub ambiente: f64,
    pub fondo: [f64; 3],

    // Plugins opcionales del mundo
    pub comandos_usuario: bool,
    pub sensores: bool,
    pub imu_system: bool,
    #[serde(default)]
    pub plugins_extra: Vec<String>,

    // Robot
    /// URI de un `<include>`, o vacío para no incluir ninguno.
    #[serde(default)]
    pub robot_uri: String,
    #[serde(default)]
    pub robot_pose: [f64; 6],

    #[serde(default)]
    pub props: Vec<Prop>,
}

fn pose_campo() -> [f64; 6] {
    [0.0, 0.0, 0.0, std::f64::consts::FRAC_PI_2, 0.0, 0.0]
}

fn uno() -> f64 {
    1.0
}

/// La NEUTRAL ZONE: 206.0 in x 72.0 in (manual de REBUILT, 6.3.4.1).
fn area_fuel() -> [f64; 2] {
    [5.23, 1.83]
}

/// Radio del FUEL, de `models/fuel/model.sdf`. Se necesita aqui para
/// colocarlas sin que se solapen; esta duplicado a proposito y con esta nota,
/// porque el generador no parsea el modelo.
const FUEL_RADIO: f64 = 0.075;

fn f(v: f64) -> String {
    // Sin notación científica y sin ceros de más: un SDF se lee a mano.
    let s = format!("{v:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    if s.is_empty() || s == "-" || s == "-0" {
        "0".into()
    } else {
        s
    }
}

fn pose(p: &[f64; 6]) -> String {
    p.iter().map(|v| f(*v)).collect::<Vec<_>>().join(" ")
}

/// Escribe el SDF. Es una plantilla, no un serializador de SDF completo:
/// cubre lo que el árbol de propiedades ofrece y nada más.
pub fn generar_sdf(s: &MundoSpec) -> String {
    let mut o = String::new();
    o.push_str("<?xml version=\"1.0\" ?>\n");
    o.push_str("<!--\n");
    o.push_str("  Generated by MARS Simulation Studio. The .studio.json next to this\n");
    o.push_str("  file holds the properties that produced it; editing this SDF by hand\n");
    o.push_str("  is fine, but regenerating from the editor overwrites it.\n");
    if !s.descripcion.trim().is_empty() {
        o.push_str(&format!("\n  {}\n", s.descripcion.trim().replace("--", "- -")));
    }
    o.push_str("-->\n");
    // El nombre del mundo es contrato: los tópicos estándar de gz-sim lo llevan
    // embebido (/world/mars/clock) y protocol/check.py lo verifica.
    o.push_str("<sdf version=\"1.11\">\n  <world name=\"mars\">\n\n");

    o.push_str(&format!(
        "    <physics name=\"studio\" type=\"ignored\">\n      <max_step_size>{}</max_step_size>\n      <real_time_factor>{}</real_time_factor>\n    </physics>\n\n",
        f(s.paso),
        f(s.rtf)
    ));

    o.push_str(
        "    <plugin filename=\"gz-sim-physics-system\" name=\"gz::sim::systems::Physics\">\n",
    );
    if s.motor_fisica != "dart" {
        o.push_str(&format!(
            "      <engine><filename>gz-physics-{}-plugin</filename></engine>\n",
            s.motor_fisica
        ));
    }
    o.push_str("    </plugin>\n");
    o.push_str("    <plugin filename=\"gz-sim-scene-broadcaster-system\" name=\"gz::sim::systems::SceneBroadcaster\"/>\n");
    if s.comandos_usuario {
        o.push_str("    <plugin filename=\"gz-sim-user-commands-system\" name=\"gz::sim::systems::UserCommands\"/>\n");
    }
    if s.sensores {
        o.push_str("    <plugin filename=\"gz-sim-sensors-system\" name=\"gz::sim::systems::Sensors\">\n      <render_engine>ogre2</render_engine>\n    </plugin>\n");
    }
    if s.imu_system {
        o.push_str(
            "    <plugin filename=\"gz-sim-imu-system\" name=\"gz::sim::systems::Imu\"/>\n",
        );
    }
    for extra in &s.plugins_extra {
        let extra = extra.trim();
        if !extra.is_empty() {
            o.push_str(&format!(
                "    <plugin filename=\"{extra}\" name=\"{extra}\"/>\n"
            ));
        }
    }
    o.push('\n');

    o.push_str(&format!("    <gravity>0 0 {}</gravity>\n", f(s.gravedad)));
    o.push_str(&format!(
        "    <scene>\n      <ambient>{a} {a} {a} 1</ambient>\n      <background>{r} {g} {b} 1</background>\n      <shadows>{sh}</shadows>\n    </scene>\n\n",
        a = f(s.ambiente),
        r = f(s.fondo[0]),
        g = f(s.fondo[1]),
        b = f(s.fondo[2]),
        sh = s.sombras
    ));

    if s.sol {
        o.push_str(&format!(
            "    <light type=\"directional\" name=\"sun\">\n      <cast_shadows>{sh}</cast_shadows>\n      <pose>0 0 10 0 0 0</pose>\n      <diffuse>{i} {i} {i} 1</diffuse>\n      <specular>0.2 0.2 0.2 1</specular>\n      <direction>{dx} {dy} {dz}</direction>\n    </light>\n\n",
            sh = s.sombras,
            i = f(s.sol_intensidad),
            dx = f(s.sol_direccion[0]),
            dy = f(s.sol_direccion[1]),
            dz = f(s.sol_direccion[2]),
        ));
    }

    let con_campo = !s.campo.trim().is_empty();

    if s.suelo {
        // Con una cancha puesta, el suelo pierde su VISUAL y conserva la
        // colisión: la alfombra ya la dibuja la malla, y dos superficies en
        // z = 0 producen z-fighting --- ese parpadeo a franjas que parece un
        // fallo del renderizador y es geometría duplicada.
        let visual = if con_campo {
            String::new()
        } else {
            format!(
                r#"        <visual name="visual">
          <geometry>
            <plane><normal>0 0 1</normal><size>{largo} {ancho}</size></plane>
          </geometry>
          <material>
            <ambient>{r} {g} {b} 1</ambient>
            <diffuse>{r} {g} {b} 1</diffuse>
          </material>
        </visual>
"#,
                largo = f(s.cancha_largo),
                ancho = f(s.cancha_ancho),
                r = f(s.color_suelo[0]),
                g = f(s.color_suelo[1]),
                b = f(s.color_suelo[2]),
            )
        };

        o.push_str(&format!(
            r#"    <model name="ground_plane">
      <static>true</static>
      <link name="link">
        <collision name="collision">
          <geometry><plane><normal>0 0 1</normal></plane></geometry>
          <surface>
            <friction>
              <ode><mu>{mu}</mu><mu2>{mu2}</mu2></ode>
            </friction>
          </surface>
        </collision>
{visual}      </link>
    </model>

"#,
            mu = f(s.friccion),
            mu2 = f(s.friccion2),
        ));
    }

    if con_campo {
        // Solo visual, y a propósito. La cancha 2026 son unos 2.9 M
        // triángulos; meterla como colisión pondría al solver a resolver
        // contacto malla-malla, que es lo más caro que hace un motor de
        // física, y el real-time factor --- del que depende que las ganancias
        // que se afinen aquí transfieran al robot real --- se iría al suelo.
        // La física la siguen dando el plano y los muros.
        o.push_str(&format!(
            r#"    <model name="frc_field">
      <static>true</static>
      <pose>{pose}</pose>
      <link name="link">
        <visual name="visual">
          <cast_shadows>false</cast_shadows>
          <geometry>
            <mesh>
              <uri>{uri}</uri>
              <scale>{e} {e} {e}</scale>
            </mesh>
          </geometry>
        </visual>
      </link>
    </model>

"#,
            pose = pose(&s.campo_pose),
            uri = s.campo.trim(),
            e = f(if s.campo_escala > 0.0 { s.campo_escala } else { 1.0 }),
        ));
    }

    if s.muros {
        // El <plane> de colisión del suelo es infinito: sin muros el robot se
        // sale de la cancha conduciendo y nada lo detiene.
        o.push_str(
            "    <model name=\"field_walls\">\n      <static>true</static>\n      <link name=\"link\">\n",
        );
        let hx = s.cancha_largo / 2.0;
        let hy = s.cancha_ancho / 2.0;
        let h = s.muro_alto;
        let t = s.muro_grosor;
        let muros: [(&str, [f64; 6], [f64; 3]); 4] = [
            (
                "north",
                [0.0, hy + t / 2.0, h / 2.0, 0.0, 0.0, 0.0],
                [s.cancha_largo + 2.0 * t, t, h],
            ),
            (
                "south",
                [0.0, -hy - t / 2.0, h / 2.0, 0.0, 0.0, 0.0],
                [s.cancha_largo + 2.0 * t, t, h],
            ),
            (
                "east",
                [hx + t / 2.0, 0.0, h / 2.0, 0.0, 0.0, 0.0],
                [t, s.cancha_ancho, h],
            ),
            (
                "west",
                [-hx - t / 2.0, 0.0, h / 2.0, 0.0, 0.0, 0.0],
                [t, s.cancha_ancho, h],
            ),
        ];
        for (nombre, p, size) in muros {
            let size = format!("{} {} {}", f(size[0]), f(size[1]), f(size[2]));
            o.push_str(&format!(
                "        <collision name=\"{nombre}_collision\">\n          <pose>{pp}</pose>\n          <geometry><box><size>{size}</size></box></geometry>\n        </collision>\n        <visual name=\"{nombre}_visual\">\n          <pose>{pp}</pose>\n          <geometry><box><size>{size}</size></box></geometry>\n          <material>\n            <ambient>0.25 0.25 0.28 1</ambient>\n            <diffuse>0.35 0.35 0.4 1</diffuse>\n          </material>\n        </visual>\n",
                pp = pose(&p),
            ));
        }
        o.push_str("      </link>\n    </model>\n\n");
    }

    o.push_str(&generar_fuel(s));

    for p in &s.props {
        o.push_str(&generar_prop(p));
    }

    if !s.robot_uri.trim().is_empty() {
        o.push_str(&format!(
            "    <include>\n      <uri>{}</uri>\n      <pose>{}</pose>\n    </include>\n\n",
            s.robot_uri.trim(),
            pose(&s.robot_pose)
        ));
    }

    o.push_str("  </world>\n</sdf>\n");
    o
}

fn generar_prop(p: &Prop) -> String {
    let geometria = match p.forma.as_str() {
        "cylinder" => format!(
            "<cylinder><radius>{}</radius><length>{}</length></cylinder>",
            f(p.tamano[0]),
            f(p.tamano[1])
        ),
        "sphere" => format!("<sphere><radius>{}</radius></sphere>", f(p.tamano[0])),
        "mesh" => format!(
            "<mesh><uri>{}</uri><scale>{} {} {}</scale></mesh>",
            p.malla.trim(),
            f(p.tamano[0]),
            f(p.tamano[1]),
            f(p.tamano[2])
        ),
        _ => format!(
            "<box><size>{} {} {}</size></box>",
            f(p.tamano[0]),
            f(p.tamano[1]),
            f(p.tamano[2])
        ),
    };

    // Inercia de la caja envolvente. Es una aproximación declarada: un prop es
    // un obstáculo, no un mecanismo, y una inercia exacta no cambiaría nada de
    // lo que se está probando.
    let (sx, sy, sz) = match p.forma.as_str() {
        "sphere" => (p.tamano[0] * 2.0, p.tamano[0] * 2.0, p.tamano[0] * 2.0),
        "cylinder" => (p.tamano[0] * 2.0, p.tamano[0] * 2.0, p.tamano[1]),
        _ => (p.tamano[0], p.tamano[1], p.tamano[2]),
    };
    let m = p.masa.max(0.001);
    let ixx = m * (sy * sy + sz * sz) / 12.0;
    let iyy = m * (sx * sx + sz * sz) / 12.0;
    let izz = m * (sx * sx + sy * sy) / 12.0;

    format!(
        r#"    <model name="{nombre}">
      <static>{estatico}</static>
      <pose>{pose}</pose>
      <link name="link">
        <inertial>
          <mass>{masa}</mass>
          <inertia>
            <ixx>{ixx}</ixx><ixy>0</ixy><ixz>0</ixz>
            <iyy>{iyy}</iyy><iyz>0</iyz><izz>{izz}</izz>
          </inertia>
        </inertial>
        <collision name="collision">
          <geometry>{geometria}</geometry>
        </collision>
        <visual name="visual">
          <geometry>{geometria}</geometry>
          <material>
            <ambient>{r} {g} {b} {a}</ambient>
            <diffuse>{r} {g} {b} {a}</diffuse>
          </material>
        </visual>
      </link>
    </model>

"#,
        nombre = p.nombre,
        estatico = p.estatico,
        pose = pose(&p.pose),
        masa = f(m),
        ixx = f(ixx),
        iyy = f(iyy),
        izz = f(izz),
        r = f(p.color[0]),
        g = f(p.color[1]),
        b = f(p.color[2]),
        a = f(p.color[3]),
    )
}

/// Cuantos FUEL entran por capa y en que rejilla, dada la zona de siembra.
///
/// Devuelve `(columnas, filas, capas)`. Está separado del generador porque es
/// lo único de la siembra que se puede probar sin leer XML, y porque el editor
/// enseña la misma cuenta antes de guardar --- ver `capacidadFuel()` en
/// `ui/js/pages/editor.js`, que repite esta fórmula.
fn rejilla_fuel(n: usize, area: [f64; 2]) -> (usize, usize, usize) {
    if n == 0 {
        return (0, 0, 0);
    }

    // 2 cm de aire entre pelota y pelota. Nacer en contacto exacto ya cuenta
    // como colisión para el solver, y un contacto que existe desde el paso
    // cero es energía que el motor tiene que quitar de algún lado.
    const HUECO: f64 = 0.02;
    let paso_min = 2.0 * FUEL_RADIO + HUECO;

    // El área útil es la caja menos el radio por lado: así el BORDE de la
    // pelota queda dentro de la zona declarada y no medio fuera de ella.
    let util_x = (area[0] - 2.0 * FUEL_RADIO).max(0.0);
    let util_y = (area[1] - 2.0 * FUEL_RADIO).max(0.0);
    let cols_max = (util_x / paso_min).floor() as usize + 1;
    let filas_max = (util_y / paso_min).floor() as usize + 1;

    // La rejilla toma la proporción de la zona: en la NEUTRAL ZONE, que es
    // casi tres veces más larga que ancha, salen tres veces más columnas que
    // filas y las pelotas quedan repartidas, no en un cuadrado en el medio.
    let proporcion = if area[1] > 0.0 { area[0] / area[1] } else { 1.0 };
    let cols = ((n as f64 * proporcion).sqrt().round() as usize).clamp(1, cols_max);
    let filas = ((n + cols - 1) / cols).clamp(1, filas_max);
    let por_capa = cols * filas;
    (cols, filas, (n + por_capa - 1) / por_capa)
}

/// Siembra los FUEL con física dentro de `fuel_area`.
///
/// Estas son las pelotas de verdad. Las 456 que se ven en la malla de la
/// cancha son parte del glTF: decorado sin colisión ni masa, y por eso el
/// número de aquí es independiente de ellas.
///
/// Van en rejilla y no al azar por dos razones. Una rejilla es reproducible
/// --- dos corridas del mismo mundo empiezan idénticas, que es lo que hace
/// comparable una prueba de autónomo --- y garantiza que ninguna pelota nazca
/// dentro de otra: dos cuerpos solapados en el paso cero es la forma clásica
/// de que un solver invente energía y los mande a volar.
///
/// Si no caben todas en una capa se apilan, con la misma separación vertical
/// que horizontal: las de arriba caen unos milímetros y se acomodan solas.
fn generar_fuel(s: &MundoSpec) -> String {
    let (cols, filas, capas) = rejilla_fuel(s.fuel, s.fuel_area);
    if capas == 0 {
        return String::new();
    }

    const HUECO: f64 = 0.02;
    let paso_min = 2.0 * FUEL_RADIO + HUECO;
    let util_x = (s.fuel_area[0] - 2.0 * FUEL_RADIO).max(0.0);
    let util_y = (s.fuel_area[1] - 2.0 * FUEL_RADIO).max(0.0);
    // Con una sola columna el paso no se usa, y dividir por cero daría NaN en
    // el SDF --- que gz acepta al parsear y convierte en una pose imposible.
    let sx = if cols > 1 { util_x / (cols - 1) as f64 } else { 0.0 };
    let sy = if filas > 1 { util_y / (filas - 1) as f64 } else { 0.0 };
    let x0 = s.fuel_centro[0] - util_x / 2.0;
    let y0 = s.fuel_centro[1] - util_y / 2.0;
    let z0 = FUEL_RADIO + s.fuel_altura.max(0.0);

    let mut o = format!(
        "    <!-- {n} FUEL con física, en una rejilla de {cols} x {filas}{capa_nota}\n         dentro de {ax} x {ay} m centrada en ({cx}, {cy}). Cada una es un cuerpo\n         dinámico más para el solver: si el real-time factor baja de 1.0,\n         esto es lo primero que hay que recortar. -->\n",
        n = s.fuel,
        capa_nota = if capas > 1 {
            format!(" y {capas} capas")
        } else {
            String::new()
        },
        ax = f(s.fuel_area[0]),
        ay = f(s.fuel_area[1]),
        cx = f(s.fuel_centro[0]),
        cy = f(s.fuel_centro[1]),
    );

    let por_capa = cols * filas;
    for k in 0..s.fuel {
        let capa = k / por_capa;
        let en_capa = k % por_capa;
        let x = x0 + (en_capa % cols) as f64 * sx;
        let y = y0 + (en_capa / cols) as f64 * sy;
        let z = z0 + capa as f64 * paso_min;
        o.push_str(&format!(
            "    <include>\n      <uri>model://fuel</uri>\n      <name>fuel_{n:03}</name>\n      <pose>{x} {y} {z} 0 0 0</pose>\n    </include>\n",
            n = k + 1,
            x = f(x),
            y = f(y),
            z = f(z),
        ));
    }
    o.push('\n');
    o
}

/// Guarda el `.sdf` y su `.studio.json`. Devuelve la ruta relativa del mundo.
pub fn guardar_mundo(sim_dir: &Path, spec: &MundoSpec) -> Result<String> {
    nombre_de_archivo_valido(&spec.archivo)?;
    if !(spec.paso > 0.0 && spec.paso <= 0.1) {
        bail!("the physics step must be greater than 0 and at most 0.1 s");
    }
    let rel = format!("worlds/{}.sdf", spec.archivo);
    let sdf = resolver_editable(sim_dir, &rel)?;
    std::fs::create_dir_all(sdf.parent().unwrap())?;
    std::fs::write(&sdf, generar_sdf(spec))
        .with_context(|| format!("no se pudo escribir {}", sdf.display()))?;
    std::fs::write(
        sdf.with_extension("studio.json"),
        serde_json::to_string_pretty(spec)?,
    )?;
    Ok(rel)
}

/// Devuelve el spec de un mundo gestionado, o `None` si es externo.
pub fn leer_spec(sim_dir: &Path, rel: &str) -> Result<Option<MundoSpec>> {
    let sdf = resolver(sim_dir, rel)?;
    let json = sdf.with_extension("studio.json");
    if !json.is_file() {
        return Ok(None);
    }
    let texto = std::fs::read_to_string(&json)?;
    Ok(Some(serde_json::from_str(&texto).with_context(|| {
        format!("{} está corrupto", json.display())
    })?))
}

// --- mundos generados por script ----------------------------------------
//
// Algunos mundos no se editan con el árbol de propiedades: los escribe un
// script, porque son repetitivos de una forma que un formulario no cubre --- un
// swerve son cuatro módulos idénticos salvo por su esquina, con sus inercias
// calculadas, y `worlds/gen_swerve.py` los genera junto con el robot-map para
// que el ORDEN de los actuadores no pueda divergir.
//
// Hasta ahora eso significaba que tocar una opción de ese mundo era abrir el
// .py o la terminal. Un generador que se respete DECLARA lo que se le puede
// tocar, con `--opciones`, y la app le dibuja el panel: así una opción nueva
// aparece sola en la ventana el día que alguien la añada al script, y no hay
// una lista de opciones en Rust que se quede vieja en silencio.

/// El script que genera un mundo, si lo hay: `worlds/gen_<nombre>.py`.
///
/// Es una CONVENCIÓN de nombre, no un registro: un generador nuevo se llama
/// así y aparece en la app sin tocar nada de aquí.
pub fn generador_de(sim_dir: &Path, rel: &str) -> Option<String> {
    let sdf = resolver(sim_dir, rel).ok()?;
    let nombre = sdf.file_stem()?.to_str()?;
    let script = sdf.with_file_name(format!("gen_{nombre}.py"));
    script
        .is_file()
        .then(|| format!("worlds/gen_{nombre}.py"))
}

fn correr_generador(sim_dir: &Path, python: &Path, script: &str, args: &[String]) -> Result<String> {
    let ruta = resolver(sim_dir, script)?;
    let mut cmd = std::process::Command::new(python);
    cmd.arg(&ruta)
        .args(args)
        // El script escribe rutas relativas a `sim/` y resuelve la cancha desde
        // ahí: lanzarlo desde otro sitio le cambia el mundo bajo los pies.
        .current_dir(sim_dir);
    #[cfg(windows)]
    {
        // Sin esto, cada vez que la ventana abre el panel de opciones parpadea
        // una consola negra. La app es GUI y el script es de consola.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let salida = cmd
        .output()
        .with_context(|| format!("no se pudo ejecutar {} {}", python.display(), script))?;
    if !salida.status.success() {
        // El stderr del script es lo único que explica un fallo suyo, y sin
        // esto la UI enseñaría "exit code 1" y nada más.
        bail!(
            "{script} falló:\n{}",
            String::from_utf8_lossy(&salida.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&salida.stdout).into_owned())
}

/// Lo que el generador de este mundo declara que se le puede tocar.
///
/// `None` si el mundo no tiene generador. El JSON lo define el script; aquí no
/// se interpreta, se pasa tal cual a la UI.
pub fn opciones_generador(
    sim_dir: &Path,
    python: &Path,
    rel: &str,
) -> Result<Option<serde_json::Value>> {
    let Some(script) = generador_de(sim_dir, rel) else {
        return Ok(None);
    };
    let salida = correr_generador(sim_dir, python, &script, &["--opciones".into()])?;
    let mut manifiesto: serde_json::Value = serde_json::from_str(salida.trim())
        .with_context(|| format!("{script} --opciones no devolvió JSON:\n{salida}"))?;
    if let Some(obj) = manifiesto.as_object_mut() {
        obj.insert("script".into(), serde_json::Value::String(script));
    }
    Ok(Some(manifiesto))
}

/// Regenera el mundo con esos valores. Devuelve lo que imprimió el script.
pub fn generar_mundo(
    sim_dir: &Path,
    python: &Path,
    rel: &str,
    valores: &serde_json::Value,
) -> Result<String> {
    let script = generador_de(sim_dir, rel)
        .ok_or_else(|| anyhow::anyhow!("{rel} no tiene generador"))?;
    let mut args = Vec::new();
    for (clave, valor) in valores.as_object().into_iter().flatten() {
        // Un `=` o un salto de línea dentro del valor partiría el par en dos,
        // y el script recibiría una clave que no existe.
        let texto = match valor {
            serde_json::Value::String(s) => s.clone(),
            otro => otro.to_string(),
        };
        if clave.contains('=') || texto.contains('=') || texto.contains('\n') {
            bail!("valor inválido para {clave}: {texto:?}");
        }
        args.push("--set".into());
        args.push(format!("{clave}={texto}"));
    }
    correr_generador(sim_dir, python, &script, &args)
}

pub fn borrar_mundo(sim_dir: &Path, rel: &str) -> Result<()> {
    let sdf = resolver_editable(sim_dir, rel)?;
    if !sdf.is_file() {
        bail!("no existe {rel}");
    }
    std::fs::remove_file(&sdf)?;
    let _ = std::fs::remove_file(sdf.with_extension("studio.json"));
    Ok(())
}

pub fn duplicar_mundo(sim_dir: &Path, rel: &str, nombre: &str) -> Result<String> {
    nombre_de_archivo_valido(nombre)?;
    let origen = resolver(sim_dir, rel)?;
    let destino_rel = format!("worlds/{nombre}.sdf");
    let destino = resolver_editable(sim_dir, &destino_rel)?;
    if destino.exists() {
        bail!("{destino_rel} already exists");
    }
    std::fs::copy(&origen, &destino)?;

    // El spec viaja con el mundo si existe, con el nombre de archivo corregido:
    // si no, la copia se abriría como mundo externo y el árbol quedaría de solo
    // lectura sin motivo.
    if let Some(mut spec) = leer_spec(sim_dir, rel)? {
        spec.archivo = nombre.to_string();
        std::fs::write(
            destino.with_extension("studio.json"),
            serde_json::to_string_pretty(&spec)?,
        )?;
    }
    Ok(destino_rel)
}

/// Copia un `.sdf` de cualquier parte del disco a `worlds/`.
///
/// Si al lado del origen hay una carpeta `meshes/`, `materials/` o `models/`,
/// viaja también: un mundo con mallas que llegan sin sus archivos abre gris y
/// el único rastro queda en stderr.
pub fn importar_mundo(sim_dir: &Path, origen: &str, nombre: Option<&str>) -> Result<String> {
    let origen = PathBuf::from(origen);
    if !origen.is_file() {
        bail!("{} is not a file", origen.display());
    }
    let ext = origen
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "sdf" && ext != "world" {
        bail!("only .sdf and .world files can be imported");
    }

    let base = match nombre {
        Some(n) => {
            nombre_de_archivo_valido(n)?;
            n.to_string()
        }
        None => origen
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "imported".into())
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect(),
    };

    let rel = format!("worlds/{base}.sdf");
    let destino = resolver_editable(sim_dir, &rel)?;
    if destino.exists() {
        bail!("{rel} already exists — pick another name");
    }
    std::fs::copy(&origen, &destino)?;

    if let Some(dir) = origen.parent() {
        for extra in ["meshes", "materials", "models"] {
            let de = dir.join(extra);
            if de.is_dir() {
                copiar_arbol(&de, &sim_dir.join("worlds").join(extra)).ok();
            }
        }
    }
    Ok(rel)
}

fn copiar_arbol(de: &Path, a: &Path) -> Result<()> {
    std::fs::create_dir_all(a)?;
    for e in std::fs::read_dir(de)?.flatten() {
        let destino = a.join(e.file_name());
        if e.path().is_dir() {
            copiar_arbol(&e.path(), &destino)?;
        } else if !destino.exists() {
            std::fs::copy(e.path(), destino)?;
        }
    }
    Ok(())
}

// --- ficheros y explorador ---------------------------------------------

pub fn leer_texto(sim_dir: &Path, rel: &str) -> Result<String> {
    let p = resolver(sim_dir, rel)?;
    std::fs::read_to_string(&p).with_context(|| format!("no se pudo leer {}", p.display()))
}

pub fn escribir_texto(sim_dir: &Path, rel: &str, contenido: &str) -> Result<()> {
    let p = resolver_editable(sim_dir, rel)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&p, contenido).with_context(|| format!("no se pudo escribir {}", p.display()))
}

#[derive(Debug, Serialize)]
pub struct Entrada {
    pub nombre: String,
    pub ruta: String,
    pub carpeta: bool,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct Explorador {
    pub dir: String,
    pub padre: Option<String>,
    pub entradas: Vec<Entrada>,
    /// Raíces sugeridas: las unidades en Windows, `/` y `$HOME` fuera.
    pub atajos: Vec<Entrada>,
}

/// Explorador de disco propio.
///
/// La app no lleva `tauri-plugin-dialog`: una dependencia más para abrir un
/// selector de archivos, en una app cuyo único uso del disco es "elegí un
/// .sdf". Esto lo resuelve con `std::fs` y además encaja con el resto del
/// chrome, que ya imita a un programa de escritorio antiguo.
pub fn explorar(dir: Option<&str>, filtro: &[String]) -> Result<Explorador> {
    let dir = match dir.filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => dir_inicio(),
    };
    let dir = dir.canonicalize().unwrap_or(dir);

    let mut entradas = Vec::new();
    for e in std::fs::read_dir(&dir)
        .with_context(|| format!("no se pudo abrir {}", dir.display()))?
        .flatten()
    {
        let nombre = e.file_name().to_string_lossy().to_string();
        if nombre.starts_with('.') {
            continue;
        }
        let es_dir = e.path().is_dir();
        if !es_dir && !filtro.is_empty() {
            let ext = e
                .path()
                .extension()
                .map(|x| x.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !filtro.iter().any(|f| f == &ext) {
                continue;
            }
        }
        entradas.push(Entrada {
            nombre,
            ruta: e.path().display().to_string(),
            carpeta: es_dir,
            bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    // Carpetas primero y alfabético dentro de cada grupo: el orden de
    // `read_dir` es el del sistema de archivos, que no es ninguno.
    entradas.sort_by(|a, b| {
        b.carpeta
            .cmp(&a.carpeta)
            .then(a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase()))
    });

    Ok(Explorador {
        dir: dir.display().to_string(),
        padre: dir.parent().map(|p| p.display().to_string()),
        entradas,
        atajos: atajos(),
    })
}

fn dir_inicio() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

fn atajos() -> Vec<Entrada> {
    let mut v = Vec::new();
    let mut push = |nombre: &str, p: PathBuf| {
        if p.is_dir() {
            v.push(Entrada {
                nombre: nombre.to_string(),
                ruta: p.display().to_string(),
                carpeta: true,
                bytes: 0,
            });
        }
    };
    let inicio = dir_inicio();
    push("Home", inicio.clone());
    push("Desktop", inicio.join("Desktop"));
    push("Documents", inicio.join("Documents"));
    push("Downloads", inicio.join("Downloads"));
    if cfg!(windows) {
        for letra in 'A'..='Z' {
            let unidad = PathBuf::from(format!("{letra}:\\"));
            if unidad.is_dir() {
                v.push(Entrada {
                    nombre: format!("{letra}:"),
                    ruta: unidad.display().to_string(),
                    carpeta: true,
                    bytes: 0,
                });
            }
        }
    } else {
        push("Root", PathBuf::from("/"));
    }
    v
}

/// Abre una ruta en el explorador de archivos del sistema.
pub fn revelar(sim_dir: &Path, rel: &str) -> Result<()> {
    let p = resolver(sim_dir, rel)?;
    let (programa, args): (&str, Vec<String>) = if cfg!(windows) {
        ("explorer", vec![format!("/select,{}", p.display())])
    } else if cfg!(target_os = "macos") {
        ("open", vec!["-R".into(), p.display().to_string()])
    } else {
        (
            "xdg-open",
            vec![p.parent().unwrap_or(&p).display().to_string()],
        )
    };
    // `explorer` devuelve códigos distintos de cero incluso cuando abre la
    // ventana: no se mira el status a propósito.
    std::process::Command::new(programa)
        .args(args)
        .spawn()
        .with_context(|| format!("no se pudo abrir {}", p.display()))?;
    Ok(())
}

// --- preferencias ------------------------------------------------------

/// Las preferencias son un JSON opaco: qué guarda la UI es cosa de la UI.
/// Viven en `build/` porque son estado local, no algo que vaya al repositorio.
pub fn prefs(sim_dir: &Path) -> serde_json::Value {
    std::fs::read_to_string(sim_dir.join("build/studio-prefs.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn guardar_prefs(sim_dir: &Path, valor: &serde_json::Value) -> Result<()> {
    let dir = sim_dir.join("build");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        dir.join("studio-prefs.json"),
        serde_json::to_string_pretty(valor)?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_minimo() -> MundoSpec {
        MundoSpec {
            archivo: "test".into(),
            descripcion: String::new(),
            paso: 0.004,
            rtf: 1.0,
            motor_fisica: "dart".into(),
            gravedad: -9.8,
            suelo: true,
            friccion: 0.9,
            friccion2: 0.9,
            cancha_largo: 16.54,
            cancha_ancho: 8.21,
            color_suelo: [0.35, 0.35, 0.38, 1.0],
            campo: String::new(),
            campo_pose: pose_campo(),
            campo_escala: 1.0,
            fuel: 0,
            fuel_area: area_fuel(),
            fuel_centro: [0.0, 0.0],
            fuel_altura: 0.0,
            muros: true,
            muro_alto: 0.5,
            muro_grosor: 0.1,
            sol: true,
            sombras: true,
            sol_direccion: [-0.5, 0.1, -0.9],
            sol_intensidad: 0.8,
            ambiente: 0.4,
            fondo: [0.7, 0.75, 0.8],
            comandos_usuario: true,
            sensores: false,
            imu_system: false,
            plugins_extra: vec![],
            robot_uri: String::new(),
            robot_pose: [0.0; 6],
            props: vec![],
        }
    }

    /// El nombre del mundo es contrato: `protocol/check.py` rechaza cualquier
    /// SDF cuyo `<world name>` no sea el del manifiesto.
    #[test]
    fn el_mundo_generado_se_llama_mars() {
        let sdf = generar_sdf(&spec_minimo());
        assert!(sdf.contains("<world name=\"mars\">"), "{sdf}");
    }

    /// Sin estos dos plugins el mundo abre, pero no hay física ni estado que
    /// publicar y el bridge se queda esperando en silencio.
    #[test]
    fn el_mundo_generado_trae_fisica_y_scene_broadcaster() {
        let sdf = generar_sdf(&spec_minimo());
        assert!(sdf.contains("gz-sim-physics-system"));
        assert!(sdf.contains("gz-sim-scene-broadcaster-system"));
    }

    #[test]
    fn los_props_salen_con_inercia_y_geometria() {
        let mut s = spec_minimo();
        s.props.push(Prop {
            nombre: "crate".into(),
            forma: "box".into(),
            tamano: [0.3, 0.3, 0.3],
            masa: 2.0,
            estatico: false,
            pose: [1.0, 0.0, 0.15, 0.0, 0.0, 0.0],
            color: [0.8, 0.5, 0.2, 1.0],
            malla: String::new(),
        });
        let sdf = generar_sdf(&s);
        assert!(sdf.contains("<model name=\"crate\">"));
        assert!(sdf.contains("<mass>2</mass>"));
        assert!(sdf.contains("<box><size>0.3 0.3 0.3</size></box>"));
    }

    /// Sin FUEL no se escribe ni un `<include>`: un mundo de mecanismo no
    /// tiene por qué pagar el coste de nada.
    #[test]
    fn sin_fuel_no_hay_includes() {
        let sdf = generar_sdf(&spec_minimo());
        assert!(!sdf.contains("model://fuel"), "{sdf}");
    }

    /// Las poses de las FUEL sembradas, y solo esas: el mundo trae muros y
    /// cancha, que también llevan `<pose>`.
    fn poses_fuel(sdf: &str) -> Vec<[f64; 3]> {
        sdf.split("<uri>model://fuel</uri>")
            .skip(1)
            .filter_map(|bloque| entre(bloque, "<pose>", "</pose>"))
            .filter_map(|p| {
                let v: Vec<f64> = p.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                (v.len() == 6).then(|| [v[0], v[1], v[2]])
            })
            .collect()
    }

    #[test]
    fn las_fuel_salen_con_nombre_unico_y_apoyadas() {
        let mut s = spec_minimo();
        s.fuel = 12;
        let sdf = generar_sdf(&s);
        assert_eq!(sdf.matches("<uri>model://fuel</uri>").count(), 12);
        assert!(sdf.contains("<name>fuel_001</name>"));
        assert!(sdf.contains("<name>fuel_012</name>"));

        let poses = poses_fuel(&sdf);
        assert_eq!(poses.len(), 12);
        for p in &poses {
            // z = radio: apoyadas en el suelo, ni hundidas ni flotando.
            assert!((p[2] - FUEL_RADIO).abs() < 1e-9, "z inesperada: {}", p[2]);
            // Y dentro de la zona declarada, con la pelota entera adentro.
            assert!(p[0].abs() <= s.fuel_area[0] / 2.0 - FUEL_RADIO + 1e-9);
            assert!(p[1].abs() <= s.fuel_area[1] / 2.0 - FUEL_RADIO + 1e-9);
        }
    }

    /// Dos pelotas que nacen dentro de otra es la forma clásica de que el
    /// solver invente energía. La rejilla existe para que no pase, y esto lo
    /// comprueba con el caso peor: la zona por defecto llena.
    #[test]
    fn las_fuel_no_nacen_solapadas() {
        let mut s = spec_minimo();
        s.fuel = 60;
        let poses = poses_fuel(&generar_sdf(&s));
        assert_eq!(poses.len(), 60);
        for (i, a) in poses.iter().enumerate() {
            for b in &poses[i + 1..] {
                let d2 = (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2);
                assert!(
                    d2 >= (2.0 * FUEL_RADIO).powi(2),
                    "dos FUEL a {} m, menos que un diámetro",
                    d2.sqrt()
                );
            }
        }
    }

    /// La rejilla que sale aquí es la que el editor promete antes de guardar.
    ///
    /// `rejillaFuel()` de `ui/js/worldspec.js` es una copia de esta fórmula, y
    /// una copia sin tripwire se desincroniza: el editor diría "8 × 3" y el SDF
    /// traería otra cosa. Estos números salieron de correr las dos.
    #[test]
    fn la_rejilla_es_la_que_ensena_el_editor() {
        let zona = area_fuel();
        assert_eq!(rejilla_fuel(9, zona), (5, 2, 1));
        assert_eq!(rejilla_fuel(24, zona), (8, 3, 1));
        assert_eq!(rejilla_fuel(60, zona), (13, 5, 1));
        assert_eq!(rejilla_fuel(456, zona), (30, 10, 2));
        assert_eq!(rejilla_fuel(40, [1.0, 1.0]), (6, 6, 2));
    }

    /// Y cuando no caben en el suelo se apilan, en vez de quedarse fuera de la
    /// zona o encimadas.
    #[test]
    fn las_fuel_que_no_caben_se_apilan() {
        let mut s = spec_minimo();
        s.fuel = 40;
        s.fuel_area = [1.0, 1.0];
        let (cols, filas, capas) = rejilla_fuel(s.fuel, s.fuel_area);
        assert!(capas > 1, "40 FUEL en 1 m² tienen que ocupar varias capas");
        assert!(cols * filas * capas >= s.fuel);
        let sdf = generar_sdf(&s);
        assert_eq!(sdf.matches("<uri>model://fuel</uri>").count(), 40);
    }

    /// El generador se encuentra POR NOMBRE, y esa es toda la registración que
    /// hay: `gen_<mundo>.py` al lado del `.sdf`. Si esto se rompe, los mundos
    /// generados pierden su panel de opciones en la app y no hay ningún error.
    #[test]
    fn el_generador_se_encuentra_por_convencion() {
        let raiz = std::env::temp_dir().join("mars-studio-test-generador");
        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(raiz.join("worlds")).unwrap();
        std::fs::write(raiz.join("worlds/swerve.sdf"), "<sdf/>").unwrap();
        std::fs::write(raiz.join("worlds/gen_swerve.py"), "# hola").unwrap();
        std::fs::write(raiz.join("worlds/a-mano.sdf"), "<sdf/>").unwrap();

        assert_eq!(
            generador_de(&raiz, "worlds/swerve.sdf").as_deref(),
            Some("worlds/gen_swerve.py")
        );
        assert_eq!(generador_de(&raiz, "worlds/a-mano.sdf"), None);
        assert_eq!(generador_de(&raiz, "worlds/no-existe.sdf"), None);
        let _ = std::fs::remove_dir_all(&raiz);
    }

    /// El contrato con el generador, de punta a punta.
    ///
    /// Si esto falla, el panel de opciones de la app sale vacío y no hay ningún
    /// error: el `--opciones` es un acuerdo entre un script de Python y un
    /// panel de JavaScript, y nada más lo comprueba. Se salta solo si no está
    /// el entorno conda, porque es el único python que los scripts pueden usar.
    #[test]
    fn el_generador_declara_sus_opciones() {
        let sim = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let Some(python) = ["USERPROFILE", "LOCALAPPDATA"]
            .iter()
            .filter_map(|v| std::env::var(v).ok())
            .map(|r| PathBuf::from(r).join("miniforge3/envs/mars-sim/python.exe"))
            .find(|p| p.is_file())
        else {
            eprintln!("sin entorno mars-sim: saltado");
            return;
        };

        let manifiesto = opciones_generador(sim, &python, "worlds/swerve.sdf")
            .expect("el generador no contestó")
            .expect("worlds/swerve.sdf tiene generador y no se encontró");
        let opciones = manifiesto["opciones"].as_array().expect("sin opciones");
        assert!(opciones.len() >= 3, "{manifiesto}");
        for o in opciones {
            // Lo que la UI necesita de cada una para poder pintar un control.
            assert!(o["nombre"].is_string(), "{o}");
            assert!(o["defecto"] != serde_json::Value::Null, "{o}");
            let tipo = o["tipo"].as_str().unwrap_or("");
            assert!(matches!(tipo, "bool" | "entero" | "opcion"), "tipo {tipo}");
            if tipo == "opcion" {
                let lista = o["opciones"].as_array().expect("opcion sin lista");
                assert!(lista.iter().all(|p| p[0].is_string()), "{o}");
            }
        }
    }

    /// El spec que guarda el editor tiene que volver a leerse igual: es lo
    /// único que hace editable un mundo la segunda vez que se abre.
    #[test]
    fn el_spec_va_y_vuelve_por_json() {
        let s = spec_minimo();
        let texto = serde_json::to_string(&s).unwrap();
        let vuelta: MundoSpec = serde_json::from_str(&texto).unwrap();
        assert_eq!(vuelta.archivo, s.archivo);
        assert_eq!(vuelta.cancha_largo, s.cancha_largo);
        assert_eq!(vuelta.motor_fisica, s.motor_fisica);
    }

    /// El objeto que manda el editor tiene que caer en `MundoSpec` campo por
    /// campo.
    ///
    /// Es una copia literal de `specPorDefecto()` en `ui/js/worldspec.js`. Un
    /// nombre que no coincida no da error de compilación en ningún lado: serde
    /// falla en tiempo de ejecución, con el editor abierto y el usuario
    /// dándole a Save. El mismo riesgo que cubre
    /// `supervisor::tests::la_ui_y_config_hablan_el_mismo_json` para arrancar.
    #[test]
    fn la_ui_y_mundospec_hablan_el_mismo_json() {
        let del_editor = r#"{
            "archivo": "new-world",
            "descripcion": "",
            "paso": 0.004,
            "rtf": 1.0,
            "motor_fisica": "dart",
            "gravedad": -9.8,
            "suelo": true,
            "friccion": 0.9,
            "friccion2": 0.9,
            "cancha_largo": 16.54,
            "cancha_ancho": 8.21,
            "color_suelo": [0.32, 0.33, 0.36, 1],
            "fuel": 0,
            "fuel_area": [5.23, 1.83],
            "fuel_centro": [0, 0],
            "fuel_altura": 0,
            "muros": true,
            "muro_alto": 0.5,
            "muro_grosor": 0.1,
            "sol": true,
            "sombras": true,
            "sol_direccion": [-0.5, 0.1, -0.9],
            "sol_intensidad": 0.8,
            "ambiente": 0.4,
            "fondo": [0.7, 0.75, 0.8],
            "comandos_usuario": true,
            "sensores": false,
            "imu_system": false,
            "plugins_extra": [],
            "robot_uri": "",
            "robot_pose": [0, 0, 0.1, 0, 0, 0],
            "props": []
        }"#;
        let spec: MundoSpec =
            serde_json::from_str(del_editor).expect("el editor manda algo que MundoSpec no lee");
        assert_eq!(spec.archivo, "new-world");
        assert_eq!(spec.cancha_largo, 16.54);
        assert!(spec.muros);
    }

    /// Y el prop, que va anidado dentro del mismo objeto.
    #[test]
    fn la_ui_y_prop_hablan_el_mismo_json() {
        let del_editor = r#"{
            "nombre": "box_1",
            "forma": "box",
            "tamano": [0.3, 0.3, 0.3],
            "masa": 2,
            "estatico": false,
            "pose": [1, 0, 0.15, 0, 0, 0],
            "color": [0.8, 0.5, 0.2, 1],
            "malla": ""
        }"#;
        let p: Prop = serde_json::from_str(del_editor).expect("el editor manda un prop que Prop no lee");
        assert_eq!(p.nombre, "box_1");
        assert_eq!(p.tamano[0], 0.3);
    }

    /// El explorador: carpetas primero, y el filtro de extensión aplicado solo
    /// a los archivos.
    ///
    /// Las dos cosas son invisibles hasta que fallan. Sin el orden, el diálogo
    /// muestra lo que devuelva el sistema de archivos, que no es ninguno; sin
    /// el filtro sobre archivos únicamente, filtrar por `sdf` esconde las
    /// carpetas y no se puede navegar a ningún sitio.
    #[test]
    fn el_explorador_ordena_y_filtra() {
        let raiz = std::env::temp_dir().join("mars-studio-test-explorar");
        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(raiz.join("zeta-dir")).unwrap();
        std::fs::create_dir_all(raiz.join("alfa-dir")).unwrap();
        std::fs::write(raiz.join("mundo.sdf"), "x").unwrap();
        std::fs::write(raiz.join("notas.txt"), "x").unwrap();

        let r = explorar(Some(&raiz.display().to_string()), &["sdf".to_string()]).unwrap();
        let nombres: Vec<&str> = r.entradas.iter().map(|e| e.nombre.as_str()).collect();
        assert_eq!(nombres, vec!["alfa-dir", "zeta-dir", "mundo.sdf"]);
        assert!(r.padre.is_some());

        // Sin filtro salen todos los archivos, detrás de las carpetas igual.
        let todo = explorar(Some(&raiz.display().to_string()), &[]).unwrap();
        assert_eq!(todo.entradas.len(), 4);

        let _ = std::fs::remove_dir_all(&raiz);
    }

    /// Importar copia el `.sdf` y le pone el nombre pedido, y se niega a pisar
    /// uno que ya exista --- perder un mundo por reimportar sería silencioso.
    #[test]
    fn importar_copia_y_no_pisa() {
        let raiz = std::env::temp_dir().join("mars-studio-test-importar");
        let _ = std::fs::remove_dir_all(&raiz);
        let sim = raiz.join("sim");
        std::fs::create_dir_all(sim.join("worlds")).unwrap();
        let origen = raiz.join("ajeno.sdf");
        std::fs::write(&origen, "<sdf/>").unwrap();

        let rel = importar_mundo(&sim, &origen.display().to_string(), Some("traido")).unwrap();
        assert_eq!(rel, "worlds/traido.sdf");
        assert!(sim.join(&rel).is_file());
        assert!(importar_mundo(&sim, &origen.display().to_string(), Some("traido")).is_err());

        // Y solo .sdf/.world: cualquier otra cosa es un error, no una copia.
        let otro = raiz.join("cosa.txt");
        std::fs::write(&otro, "x").unwrap();
        assert!(importar_mundo(&sim, &otro.display().to_string(), Some("cosa")).is_err());

        let _ = std::fs::remove_dir_all(&raiz);
    }

    /// El parche de materiales no puede mover un solo byte del archivo: si la
    /// longitud cambia, todos los offsets del glTF quedan corridos.
    #[test]
    fn aplanar_metales_conserva_la_longitud() {
        let mut json =
            br#"{"materials":[{"pbrMetallicRoughness":{"metallicFactor":1.0,"roughnessFactor":0.2121320366859436}}]}"#
                .to_vec();
        let antes = json.len();
        let cambios = sustituir_numero(&mut json, b"\"metallicFactor\":", "0")
            + sustituir_numero(&mut json, b"\"roughnessFactor\":", "0.7");

        assert_eq!(json.len(), antes, "el parche no puede cambiar la longitud");
        assert_eq!(cambios, 2);
        let texto = String::from_utf8(json).unwrap();
        assert!(texto.contains("\"metallicFactor\":0.0"), "{texto}");
        assert!(texto.contains("\"roughnessFactor\":0.7000000000000000"), "{texto}");

        // Y sigue siendo JSON: el relleno va detrás del punto decimal.
        serde_json::from_str::<serde_json::Value>(&texto).expect("el parche rompió el JSON");
    }

    /// Un hueco más corto que el valor se deja intacto en vez de corromperlo.
    #[test]
    fn aplanar_metales_respeta_los_huecos_cortos() {
        let mut json = br#"{"roughnessFactor":1}"#.to_vec();
        assert_eq!(sustituir_numero(&mut json, b"\"roughnessFactor\":", "0.7"), 0);
        assert_eq!(&json[..], br#"{"roughnessFactor":1}"#);
    }

    /// Una ruta de la UI no puede escribir fuera de sim/.
    #[test]
    fn no_se_puede_salir_de_sim() {
        let sim = Path::new("/tmp/sim");
        assert!(resolver(sim, "../../etc/passwd").is_err());
        assert!(resolver(sim, "/etc/passwd").is_err());
        assert!(resolver(sim, "worlds/ok.sdf").is_ok());
    }

    /// Y solo en los directorios de autoría: `build/` lo escriben los procesos
    /// de la simulación, no el editor.
    #[test]
    fn solo_se_escribe_en_directorios_de_autoria() {
        let sim = Path::new("/tmp/sim");
        assert!(resolver_editable(sim, "worlds/a.sdf").is_ok());
        assert!(resolver_editable(sim, "models/x/robot-map.json").is_ok());
        assert!(resolver_editable(sim, "build/mars-sim-server.exe").is_err());
        assert!(resolver_editable(sim, "bridge/src/lib.rs").is_err());
    }
}



