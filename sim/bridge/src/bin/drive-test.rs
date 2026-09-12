//! Prueba del lazo completo de actuadores contra el testbot.
//!
//! Lo que ejercita, de punta a punta:
//!   Rust publica /mars/cmd/match y /mars/cmd/actuators
//!     -> MarsLink los recibe y aplica par con el modelo DC del motor
//!     -> la física mueve el robot
//!     -> MarsLink publica /mars/state/pose y /mars/state/joints
//!     -> Rust lo lee y comprueba que el chasis avanzó
//!
//! Uso, con el motor corriendo aparte:
//!   mars-sim-server worlds/testbot.sdf run
//!   cargo run --bin drive-test

use anyhow::{anyhow, bail, Result};
use std::time::{Duration, Instant};

// Los tipos cuelgan de un modulo por .proto, no de la raiz del crate.
use gz_msgs::actuators::Actuators;
use gz_msgs::int32::Int32;
use gz_msgs::model::Model;
use gz_msgs::pose_v::Pose_V;
use gz_transport::Node;

/// Tópicos de sim/protocol/topics.toml.
const T_MATCH: &str = "/mars/cmd/match";
const T_ACTUATORS: &str = "/mars/cmd/actuators";
const T_POSE: &str = "/mars/state/pose";
const T_JOINTS: &str = "/mars/state/joints";

/// Valores de /mars/cmd/match. 0 = disabled, 2 = teleop.
const MATCH_TELEOP: i32 = 2;

/// Cuánto tiene que avanzar el chasis para dar la prueba por buena. Cuatro
/// Krakens a plena potencia mueven 44 kg mucho más que esto en dos segundos; el
/// umbral es bajo a propósito para no volverse frágil si se afina la fricción o
/// la masa del modelo.
const MIN_AVANCE_M: f64 = 0.20;

fn main() -> Result<()> {
    let mut node = Node::new().ok_or_else(|| anyhow!("could not create the node"))?;

    // Cola de 1: solo interesa el estado más reciente. Una cola larga haría que
    // leyéramos poses viejas y midiéramos el avance con retraso.
    let poses = node
        .subscribe_channel::<Pose_V>(T_POSE, 1)
        .ok_or_else(|| anyhow!("could not subscribe to {T_POSE}"))?;
    let joints = node
        .subscribe_channel::<Model>(T_JOINTS, 1)
        .ok_or_else(|| anyhow!("could not subscribe to {T_JOINTS}"))?;
    println!("[drive] subscribed to {T_POSE} and {T_JOINTS}");

    let mut match_pub = node
        .advertise::<Int32>(T_MATCH)
        .ok_or_else(|| anyhow!("could not advertise {T_MATCH}"))?;
    let mut act_pub = node
        .advertise::<Actuators>(T_ACTUATORS)
        .ok_or_else(|| anyhow!("could not advertise {T_ACTUATORS}"))?;
    println!("[drive] publishing to {T_MATCH} and {T_ACTUATORS}");

    // El discovery es asíncrono y bidireccional: no basta con que nosotros
    // veamos al motor, el motor tiene que vernos a nosotros. Publicar antes de
    // que enganche manda los mensajes al vacío, sin error.
    std::thread::sleep(Duration::from_millis(1500));

    let x0 = chassis_x(&poses)?;
    println!("[drive] initial x = {x0:.4}");

    // Habilitar primero: MarsLink fuerza par cero mientras match sea disabled,
    // igual que un robot real con el Driver Station apagado.
    let enabled = Int32 { data: MATCH_TELEOP, ..Default::default() };
    if !match_pub.publish(&enabled) {
        bail!("publishing to {T_MATCH} failed");
    }

    let full_forward = Actuators {
        normalized: vec![1.0; 4],
        ..Default::default()
    };

    // Se republica en bucle en vez de una sola vez porque el bridge real va a
    // mandar comandos a 200 Hz; probar el caso de un único mensaje escondería
    // un fallo de watchdog el día que se añada uno.
    let hasta = Instant::now() + Duration::from_secs(2);
    while Instant::now() < hasta {
        if !act_pub.publish(&full_forward) {
            bail!("publishing to {T_ACTUATORS} failed");
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    let x1 = chassis_x(&poses)?;
    let avance = x1 - x0;
    println!("[drive] final x   = {x1:.4}  (moved {avance:.4} m)");

    // Los joints tienen que haber girado: si el chasis se movió pero las ruedas
    // no, algo lo empujó y el lazo de actuadores no es lo que se probó.
    let (joint, vel) = joint_velocity(&joints)?;
    println!("[drive] {joint} turning at {vel:.2} rad/s");

    // Parar antes de salir, o el robot sigue acelerando con el último comando.
    let disabled = Int32 { data: 0, ..Default::default() };
    let _ = match_pub.publish(&disabled);

    if avance < MIN_AVANCE_M {
        bail!("the robot did not move ({avance:.4} m < {MIN_AVANCE_M} m)");
    }
    if vel.abs() < 1.0 {
        bail!("the wheels are not turning ({vel:.2} rad/s): torque never reached the joints");
    }

    println!("[drive] OK: commands, torque, physics and telemetry all verified");
    Ok(())
}

/// Posición X del chasis según /mars/state/pose.
fn chassis_x(rx: &crossbeam_channel::Receiver<Pose_V>) -> Result<f64> {
    let plazo = Duration::from_secs(5);
    for _ in 0..500 {
        let msg = rx
            .recv_timeout(plazo)
            .map_err(|e| anyhow!("no poses on {T_POSE}: {e}"))?;
        if let Some(p) = msg.pose.iter().find(|p| p.name == "chassis") {
            if let Some(v) = p.position.as_ref() {
                return Ok(v.x);
            }
        }
    }
    bail!("no pose for link 'chassis' ever arrived on {T_POSE}")
}

/// Nombre y velocidad del primer joint de /mars/state/joints.
fn joint_velocity(rx: &crossbeam_channel::Receiver<Model>) -> Result<(String, f64)> {
    let plazo = Duration::from_secs(5);
    for _ in 0..500 {
        let msg = rx
            .recv_timeout(plazo)
            .map_err(|e| anyhow!("no joints on {T_JOINTS}: {e}"))?;
        if let Some(j) = msg.joint.first() {
            if let Some(axis) = j.axis1.as_ref() {
                return Ok((j.name.clone(), axis.velocity));
            }
        }
    }
    bail!("no joint with axis1 ever arrived on {T_JOINTS}")
}
