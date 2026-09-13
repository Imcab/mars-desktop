//! Lectura del robot-map.
//!
//! Es la única entrada por robot: el manifiesto del protocolo es fijo y se
//! compila adentro, pero el mapa cambia con cada chasis, así que se pasa por
//! línea de comandos y se lee en caliente.
//!
//! El esquema está documentado en sim/protocol/robot-map.example.json y lo
//! valida sim/protocol/check.py, que comprueba cosas que aquí no se pueden ver
//! -- como que el orden de actuadores coincida con el del SDF.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RobotMap {
    pub protocol: String,
    pub robot: String,
    pub world: String,
    /// Nombre del modelo dentro del mundo.
    pub model: String,
    pub profile: String,
    /// Link que representa el cuerpo del robot; es el que se publica como pose.
    /// Por defecto `chassis`, que es como lo nombran los mundos del repo.
    #[serde(default = "base_link_por_defecto")]
    pub base_link: String,
    pub actuators: Vec<Actuator>,
    #[serde(default)]
    pub encoders: Vec<Encoder>,
}

fn base_link_por_defecto() -> String {
    "chassis".to_string()
}

/// Como interpreta el motor el comando de este actuador. Tiene que coincidir con
/// el atributo `control` del <actuator> en el SDF; check.py lo verifica.
#[derive(Debug, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Control {
    /// Duty crudo -1..1. Lo que aplica un motor sin lazo propio.
    Duty,
    /// Consigna de posicion; el motor cierra el lazo. Lo que hace un TalonFX.
    Position,
}

impl Default for Control {
    fn default() -> Self {
        Self::Duty
    }
}

#[derive(Debug, Deserialize)]
pub struct Actuator {
    pub name: String,
    pub joint: String,
    #[serde(default)]
    pub inverted: bool,
    #[serde(rename = "gearRatio", default = "uno")]
    pub gear_ratio: f64,
    #[serde(default)]
    pub control: Control,
}

#[derive(Debug, Deserialize)]
pub struct Encoder {
    pub name: String,
    pub joint: String,
    #[serde(rename = "countsPerRevolution", default = "uno")]
    pub counts_per_revolution: f64,
}

fn uno() -> f64 {
    1.0
}

impl RobotMap {
    pub fn load(path: &Path) -> Result<Self> {
        let texto = std::fs::read_to_string(path)
            .with_context(|| format!("could not read {}", path.display()))?;
        let mapa: RobotMap = serde_json::from_str(&texto)
            .with_context(|| format!("{} is not in the expected format", path.display()))?;

        // El handshake de verdad va por /mars/meta/hello contra el motor, pero
        // esto atrapa antes el caso más común: un robot-map viejo quedado de
        // una versión anterior del protocolo.
        if mapa.protocol != crate::protocol::PROTOCOL_VERSION {
            bail!(
                "{}: protocolo {} pero el bridge habla {}",
                path.display(),
                mapa.protocol,
                crate::protocol::PROTOCOL_VERSION
            );
        }
        if mapa.world != crate::protocol::WORLD {
            bail!(
                "{}: mundo '{}' pero el manifiesto dice '{}'",
                path.display(),
                mapa.world,
                crate::protocol::WORLD
            );
        }

        Ok(mapa)
    }
}
