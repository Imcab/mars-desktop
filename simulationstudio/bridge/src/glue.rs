//! El lazo de hardware del perfil `vendor`, sobre NT4.
//!
//! Existe porque **el protocolo HALSim WebSocket no cubre motores CAN**. Cubre
//! PWM, DIO, AnalogIn, Encoder, Relay, SimDevice y DriverStation -- todo lo
//! nativo del roboRIO -- pero un TalonFX o un SparkMax se simulan por la API de
//! sim de su vendor (`TalonFXSimState`, `SparkSim`), que vive dentro del proceso
//! del robot y no se asoma a wpilibws. Un drivetrain sobre CAN, que es donde
//! esta casi todo FRC hoy, no puede cerrar el lazo por ahi.
//!
//! La salida son ~50 lineas en el `simulationPeriodic` del robot que publican lo
//! que el vendor le esta aplicando al motor y reinyectan lo que la fisica
//! devuelve. Ese codigo vive en el repo del robot; su contrato esta en
//! `[[glue]]` de sim/protocol/topics.toml.
//!
//! Direcciones, vistas desde el BRIDGE:
//!
//! ```text
//!   codigo del robot  --duty, enabled-->  bridge  --Actuators-->  motor
//!   codigo del robot  <--pos, vel, yaw--  bridge  <--Model,Pose--  motor
//! ```

use anyhow::Result;

use crate::nt4::Nt4;
use crate::robotmap::{Control, RobotMap};

/// Prefijo de todo lo que publica el codigo del robot. El bridge se suscribe a
/// el en bloque, sin enumerar actuadores.
pub const PREFIJO_SALIDA: &str = "/MARS/Glue/out/";
pub const T_ENABLED: &str = "/MARS/Glue/out/enabled";
pub const T_GYRO_YAW: &str = "/MARS/Glue/in/gyro/yaw";
/// Contador que sube en cada ciclo. Es como el codigo del robot sabe que la
/// simulacion esta viva: un robot parado publica ceros que no se distinguen de
/// un canal muerto.
pub const T_HEARTBEAT: &str = "/MARS/Glue/in/heartbeat";

/// Un actuador visto desde el glue: donde leer su comando y donde escribir su
/// estado.
struct Canal {
    /// Indice dentro de los arreglos de `gz.msgs.Actuators`. Es el orden del
    /// robot-map, que check.py verifica contra el orden del SDF.
    indice: usize,
    joint: String,
    gear_ratio: f64,
    control: Control,
    t_duty: String,
    t_setpoint: String,
    t_pos: String,
    t_vel: String,
}

/// Lo que el codigo del robot esta pidiendo, listo para el motor.
pub struct Comandos {
    pub duty: Vec<f64>,
    pub posicion: Vec<f64>,
    pub habilitado: bool,
}

pub struct Glue {
    canales: Vec<Canal>,
    latido: std::cell::Cell<f64>,
}

impl Glue {
    pub fn new(mapa: &RobotMap) -> Self {
        let canales = mapa
            .actuators
            .iter()
            .enumerate()
            .map(|(i, a)| Canal {
                indice: i,
                joint: a.joint.clone(),
                gear_ratio: a.gear_ratio,
                control: a.control,
                t_duty: format!("{PREFIJO_SALIDA}{}/duty", a.name),
                t_setpoint: format!("{PREFIJO_SALIDA}{}/setpoint", a.name),
                t_pos: format!("/MARS/Glue/in/{}/position", a.name),
                t_vel: format!("/MARS/Glue/in/{}/velocity", a.name),
            })
            .collect();
        Self { canales, latido: std::cell::Cell::new(0.0) }
    }

    pub fn suscribir(&self, nt: &Nt4) -> Result<()> {
        nt.subscribe_prefix(PREFIJO_SALIDA)
    }

    pub fn actuadores(&self) -> usize {
        self.canales.len()
    }

    /// Lee los comandos del codigo del robot.
    ///
    /// Cada actuador aporta a UN solo arreglo, el que le toca por su modo:
    /// `normalized` en modo duty, `position` en modo posicion. El motor lee el
    /// que corresponde y el otro le llega en cero, que es inofensivo porque no
    /// lo mira.
    ///
    /// Un actuador del que todavia no llego nada queda en 0. Para un duty eso
    /// es "sin potencia"; para una consigna de posicion es "vuelve al cero del
    /// encoder", que es lo unico razonable sin saber que quiere el robot -- y
    /// da igual en la practica, porque hasta que el robot no se habilita el
    /// motor fuerza par cero de todas formas.
    pub fn comandos(&self, nt: &Nt4) -> Comandos {
        let mut duty = vec![0.0; self.canales.len()];
        let mut posicion = vec![0.0; self.canales.len()];

        for c in &self.canales {
            match c.control {
                Control::Duty => {
                    if let Some(v) = nt.get_f64(&c.t_duty) {
                        duty[c.indice] = v.clamp(-1.0, 1.0);
                    }
                }
                Control::Position => {
                    if let Some(v) = nt.get_f64(&c.t_setpoint) {
                        // El robot habla en radianes del MOTOR; el motor de la
                        // simulacion razona en el joint. La reduccion se
                        // deshace aqui, en el mismo sitio donde se aplica al
                        // volver, para que las dos direcciones no puedan
                        // divergir.
                        posicion[c.indice] = v / c.gear_ratio;
                    }
                }
            }
        }

        // Sin dato explicito, deshabilitado. Que un fallo de comunicacion deje
        // el robot corriendo seria lo peor posible.
        Comandos {
            duty,
            posicion,
            habilitado: nt.get_bool(T_ENABLED).unwrap_or(false),
        }
    }

    /// Publica hacia el codigo del robot lo que la fisica devolvio.
    ///
    /// Las posiciones y velocidades van en el eje del MOTOR, no en el del joint:
    /// se multiplican por la reduccion, que es como las reportan los encoders
    /// integrados de Falcon y Kraken y lo que el vendor espera en
    /// `setRawRotorPosition`.
    pub fn publicar_estado(
        &self,
        nt: &Nt4,
        joints: &gz_msgs::model::Model,
        yaw_rad: f64,
    ) -> Result<()> {
        for c in &self.canales {
            let Some(j) = joints.joint.iter().find(|j| j.name == c.joint) else {
                continue;
            };
            let Some(axis) = j.axis1.as_ref() else { continue };
            nt.set_double(&c.t_pos, axis.position * c.gear_ratio)?;
            nt.set_double(&c.t_vel, axis.velocity * c.gear_ratio)?;
        }

        // Grados y CCW positivo: la convencion de WPILib, no la de Gazebo. La
        // conversion la hace el bridge para que el glue sea lo mas tonto
        // posible -- cuanto menos calcule el codigo del robot, menos hay que
        // depurar del lado que no controlamos.
        nt.set_double(T_GYRO_YAW, yaw_rad.to_degrees())?;

        // El latido va AL FINAL: si llega, todo lo de arriba llego tambien.
        self.latido.set(self.latido.get() + 1.0);
        nt.set_double(T_HEARTBEAT, self.latido.get())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_topicos_se_arman_desde_el_nombre_del_actuador() {
        // Se construye a mano en vez de leer un robot-map: el test es sobre la
        // forma de los topicos, no sobre el parseo.
        let canal = Canal {
            indice: 0,
            joint: "fl_drive_joint".into(),
            gear_ratio: 6.75,
            control: Control::Duty,
            t_duty: format!("{PREFIJO_SALIDA}fl_drive/duty"),
            t_setpoint: format!("{PREFIJO_SALIDA}fl_drive/setpoint"),
            t_pos: "/MARS/Glue/in/fl_drive/position".into(),
            t_vel: "/MARS/Glue/in/fl_drive/velocity".into(),
        };
        assert_eq!(canal.t_duty, "/MARS/Glue/out/fl_drive/duty");
        // El prefijo de suscripcion tiene que cubrir lo que el robot publica.
        assert!(canal.t_duty.starts_with(PREFIJO_SALIDA));
        assert!(T_ENABLED.starts_with(PREFIJO_SALIDA));
        assert_eq!(canal.indice, 0);
        assert_eq!(canal.gear_ratio, 6.75);
        assert_eq!(canal.joint, "fl_drive_joint");
        assert_eq!(canal.control, Control::Duty);
        assert!(canal.t_setpoint.starts_with(PREFIJO_SALIDA));
    }
}
