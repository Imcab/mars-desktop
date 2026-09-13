//! Mide por qué el swerve simulado "se siente mal".
//!
//! Dos síntomas que la gente reporta juntos --- patina y pesa --- tienen
//! causas distintas y se miden por separado:
//!
//!   1. ESCALÓN DE DIRECCIÓN. Manda las cuatro direcciones a 90 grados y
//!      cronometra cuánto tardan. Un MK4i real llega en ~0.15 s. Si aquí tarda
//!      medio segundo, el robot pasa cada cambio de dirección con las ruedas
//!      apuntando a otro lado: eso se ve como patinar y se siente como inercia
//!      que el robot no tiene.
//!
//!   2. ESCALÓN DE TRACCIÓN. Con las ruedas rectas, duty 1.0 y se compara la
//!      velocidad de la superficie de la rueda (omega * r) con la del chasis.
//!      La diferencia es DESLIZAMIENTO de verdad: si es alto, el problema es
//!      el contacto y no el control.
//!
//! Uso, con el motor corriendo aparte:
//!   mars-sim-server worlds/swerve.sdf run
//!   cargo run --bin swerve-step

use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use crossbeam_channel::Receiver;
use gz_msgs::actuators::Actuators;
use gz_msgs::int32::Int32;
use gz_msgs::model::Model;
use gz_msgs::pose_v::Pose_V;
use gz_transport::Node;

const T_MATCH: &str = "/mars/cmd/match";
const T_ACTUATORS: &str = "/mars/cmd/actuators";
const T_POSE: &str = "/mars/state/pose";
const T_JOINTS: &str = "/mars/state/joints";

const MATCH_TELEOP: i32 = 2;

/// Radio de rueda de `worlds/gen_swerve.py`. Hace falta para pasar de rad/s del
/// joint a m/s de superficie, que es la mitad de la cuenta del deslizamiento.
const R_RUEDA: f64 = 0.0508;

/// Índices dentro de `gz.msgs.Actuators`, en el orden del robot-map:
/// fl_drive, fl_steer, fr_drive, fr_steer, bl_drive, bl_steer, br_drive, br_steer.
const N_ACT: usize = 8;
const DRIVE: [usize; 4] = [0, 2, 4, 6];
const STEER: [usize; 4] = [1, 3, 5, 7];

fn main() -> Result<()> {
    let mut node = Node::new().ok_or_else(|| anyhow!("could not create the node"))?;
    let poses = node
        .subscribe_channel::<Pose_V>(T_POSE, 1)
        .ok_or_else(|| anyhow!("could not subscribe to {T_POSE}"))?;
    let joints = node
        .subscribe_channel::<Model>(T_JOINTS, 1)
        .ok_or_else(|| anyhow!("could not subscribe to {T_JOINTS}"))?;
    let mut match_pub = node
        .advertise::<Int32>(T_MATCH)
        .ok_or_else(|| anyhow!("could not advertise {T_MATCH}"))?;
    let mut act_pub = node
        .advertise::<Actuators>(T_ACTUATORS)
        .ok_or_else(|| anyhow!("could not advertise {T_ACTUATORS}"))?;

    // El discovery es bidireccional: publicar antes de que enganche manda los
    // mensajes al vacío, sin ningún error.
    std::thread::sleep(Duration::from_millis(1500));
    if !match_pub.publish(&Int32 { data: MATCH_TELEOP, ..Default::default() }) {
        bail!("publishing to {T_MATCH} failed");
    }

    // --- 1. escalón de dirección -----------------------------------------
    let objetivo = std::f64::consts::FRAC_PI_2;
    println!("[step] steer: 0 -> 90 deg on all four modules");
    let mut cmd = Actuators {
        normalized: vec![0.0; N_ACT],
        position: vec![0.0; N_ACT],
        ..Default::default()
    };
    for i in STEER {
        cmd.position[i] = objetivo;
    }

    let arranque = Instant::now();
    let mut t10 = None;
    let mut t90 = None;
    let mut t_asentado = None;
    let mut maximo: f64 = 0.0;
    while arranque.elapsed() < Duration::from_secs(3) {
        if !act_pub.publish(&cmd) {
            bail!("publishing to {T_ACTUATORS} failed");
        }
        if let Ok(msg) = joints.recv_timeout(Duration::from_millis(20)) {
            let a = angulo(&msg, "fl_steer_joint").unwrap_or(0.0);
            let t = arranque.elapsed().as_secs_f64();
            maximo = maximo.max(a);
            if t10.is_none() && a >= 0.1 * objetivo {
                t10 = Some(t);
            }
            if t90.is_none() && a >= 0.9 * objetivo {
                t90 = Some(t);
            }
            // Asentado: dentro del 2%, que es un grado y medio.
            if t_asentado.is_none() && (a - objetivo).abs() <= 0.02 * objetivo {
                t_asentado = Some(t);
            }
        }
    }
    let final_ = angulo_bloqueante(&joints, "fl_steer_joint")?;
    println!(
        "[step]   t10 = {}  t90 = {}  settled(2%) = {}",
        opt(t10),
        opt(t90),
        opt(t_asentado)
    );
    println!(
        "[step]   final = {:.1} deg (target 90.0), overshoot = {:.1} deg",
        final_.to_degrees(),
        (maximo - objetivo).max(0.0).to_degrees()
    );
    println!("[step]   a real MK4i steering module gets there in about 0.15 s");

    // --- 2. escalón de tracción -------------------------------------------
    println!("[step] steer back to 0, then drive at full duty");
    for i in STEER {
        cmd.position[i] = 0.0;
    }
    let hasta = Instant::now() + Duration::from_secs(2);
    while Instant::now() < hasta {
        let _ = act_pub.publish(&cmd);
        std::thread::sleep(Duration::from_millis(5));
    }

    for i in DRIVE {
        cmd.normalized[i] = 1.0;
    }
    let (x0, ts0) = chassis_x(&poses)?;
    let arranque = Instant::now();
    let mut muestras: Vec<(f64, f64, f64)> = Vec::new(); // t, v_chasis, v_rueda
    let mut x_prev = x0;
    let mut t_prev = 0.0;
    let mut v_max: f64 = 0.0;
    let mut z_alto: f64 = 0.0;
    while arranque.elapsed() < Duration::from_millis(1500) {
        let _ = act_pub.publish(&cmd);
        std::thread::sleep(Duration::from_millis(20));
        let (x, ts) = chassis_x(&poses)?;
        z_alto = z_alto.max(chassis_z(&poses)?);
        let t = ts - ts0;
        let w = velocidad(&joints, "fl_drive_joint")?;
        // Dos lecturas del mismo mensaje dan dt = 0: sin este filtro la
        // division reparte un dx cualquiera entre cero y escupe un infinito.
        if t - t_prev > 1e-6 {
            let v = (x - x_prev) / (t - t_prev);
            // Con las hitboxes de la cancha puestas, el HUB esta a 2.7 m del
            // punto de spawn: a fondo se llega en menos de un segundo. Cortar
            // al chocar deja la medida de aceleracion limpia, que es de lo que
            // trata esta fase --- el choque lo prueba la siguiente.
            if v_max > 1.0 && v < 0.5 * v_max {
                println!("[step]   hit something at x = {x:.2} m, stopping the run");
                break;
            }
            v_max = v_max.max(v);
            muestras.push((t, v, w * R_RUEDA));
        }
        x_prev = x;
        t_prev = t;
    }
    let _ = match_pub.publish(&Int32 { data: 0, ..Default::default() });

    println!();
    println!("  {:>6} {:>12} {:>12} {:>10}", "t (s)", "chassis m/s", "wheel m/s", "slip");
    for (t, v, vw) in muestras.iter().step_by(5) {
        let slip = if vw.abs() > 1e-3 { (vw - v) / vw } else { 0.0 };
        println!("  {t:>6.2} {v:>12.2} {vw:>12.2} {:>9.0}%", slip * 100.0);
    }
    // --- 3. la pared -------------------------------------------------------
    // Sigue a fondo hasta que el chasis deja de avanzar. Sin las hitboxes de la
    // cancha el robot se va de largo: el <plane> del suelo es infinito y la
    // malla de la cancha no tiene colision ninguna.
    println!();
    println!("[step] full duty until something stops it (field limit test)");
    let arranque = Instant::now();
    let mut x_max = x0;
    let mut z_max: f64 = z_alto;
    let mut quieto = 0;
    while arranque.elapsed() < Duration::from_secs(6) {
        let _ = act_pub.publish(&cmd);
        std::thread::sleep(Duration::from_millis(50));
        let (x, _) = chassis_x(&poses)?;
        z_max = z_max.max(chassis_z(&poses)?);
        if x - x_max < 0.01 {
            quieto += 1;
            if quieto >= 6 {
                break;
            }
        } else {
            quieto = 0;
        }
        x_max = x_max.max(x);
    }
    let _ = match_pub.publish(&Int32 { data: 0, ..Default::default() });
    // La pared de la estacion esta en x = 8.45 y la torre se mete hasta 7.13;
    // un chasis de 0.72 m se para antes de eso.
    // Con el chasis en z = 0.20, subir una rampa de 16.5 cm lo pone en 0.36.
    println!("[step]   highest the chassis got: z = {z_max:.3} m (0.200 on flat carpet)");
    println!(
        "[step]   stopped at x = {x_max:.2} m  ({})",
        if x_max < 8.27 {
            "inside the field"
        } else {
            "OUT OF THE FIELD -- nothing stopped it"
        }
    );

    // --- 4. soltar el gas --------------------------------------------------
    // Lo que mas se parece a "se siente pesado": cuanto tarda en pararse solo.
    // Un swerve real en coast rueda; uno que se clava al soltar el stick da la
    // sensacion de arrastrar un peso que no tiene.
    println!();
    println!("[step] back to full duty, then release to zero and let it coast");
    let _ = match_pub.publish(&Int32 { data: MATCH_TELEOP, ..Default::default() });
    for i in DRIVE {
        cmd.normalized[i] = -1.0;   // hacia atras: por delante esta el HUB
    }
    let hasta = Instant::now() + Duration::from_millis(1200);
    while Instant::now() < hasta {
        let _ = act_pub.publish(&cmd);
        std::thread::sleep(Duration::from_millis(5));
    }
    for i in DRIVE {
        cmd.normalized[i] = 0.0;
    }
    let (mut x_ant, mut t_ant) = chassis_x(&poses)?;
    let mut v0: f64 = 0.0;
    let mut historia: Vec<(f64, f64)> = Vec::new();
    let arranque = Instant::now();
    while arranque.elapsed() < Duration::from_millis(2500) {
        let _ = act_pub.publish(&cmd);
        std::thread::sleep(Duration::from_millis(20));
        let (x, ts) = chassis_x(&poses)?;
        if ts - t_ant > 1e-6 {
            let v = (x - x_ant).abs() / (ts - t_ant);
            if historia.is_empty() {
                v0 = v;
            }
            historia.push((ts, v));
            if v < 0.05 * v0.max(0.1) {
                break;
            }
        }
        x_ant = x;
        t_ant = ts;
    }
    println!("  {:>6} {:>12}", "t (s)", "chassis m/s");
    if let Some((t_ini, _)) = historia.first() {
        for (ts, v) in historia.iter().step_by(4) {
            println!("  {:>6.2} {v:>12.2}", ts - t_ini);
        }
    }
    if let (Some((t_ini, _)), Some((t_fin, v_fin))) = (historia.first(), historia.last()) {
        println!(
            "[step]   released at {v0:.2} m/s, down to {v_fin:.2} m/s in {:.2} s  ->  {:.1} m/s^2",
            t_fin - t_ini,
            (v0 - v_fin) / (t_fin - t_ini).max(1e-6)
        );
        println!("[step]   a real swerve coasting loses about 1 m/s^2; in brake mode, 3 to 5");
    }
    let _ = match_pub.publish(&Int32 { data: 0, ..Default::default() });

    // Hasta la velocidad MAXIMA, no hasta la ultima muestra: la ultima puede
    // ser ya el frenazo contra lo que se haya cruzado, y una muestra de choque
    // dentro del promedio lo baja a la mitad sin que se note de donde sale.
    let pico = muestras
        .iter()
        .enumerate()
        .max_by(|a, b| a.1 .1.total_cmp(&b.1 .1))
        .map(|(i, _)| i);
    if let (Some(i), Some((t0, v0, _))) = (pico, muestras.first()) {
        let (t1, v1, _) = muestras[i];
        println!();
        println!(
            "[step]   average acceleration {:.2} m/s^2 over {:.2} s, up to {v1:.2} m/s",
            (v1 - v0) / (t1 - t0).max(1e-6),
            t1 - t0
        );
        println!("[step]   traction limit on carpet is about 9-11 m/s^2 for a 53 kg chassis");
    }
    Ok(())
}

fn opt(v: Option<f64>) -> String {
    v.map(|x| format!("{x:.3}s")).unwrap_or_else(|| "never".into())
}

fn angulo(msg: &Model, joint: &str) -> Option<f64> {
    msg.joint
        .iter()
        .find(|j| j.name == joint)
        .and_then(|j| j.axis1.as_ref())
        .map(|a| a.position)
}

fn angulo_bloqueante(rx: &Receiver<Model>, joint: &str) -> Result<f64> {
    for _ in 0..200 {
        if let Ok(msg) = rx.recv_timeout(Duration::from_secs(2)) {
            if let Some(a) = angulo(&msg, joint) {
                return Ok(a);
            }
        }
    }
    bail!("no state for {joint} on {T_JOINTS}")
}

fn velocidad(rx: &Receiver<Model>, joint: &str) -> Result<f64> {
    for _ in 0..200 {
        if let Ok(msg) = rx.recv_timeout(Duration::from_secs(2)) {
            if let Some(v) = msg
                .joint
                .iter()
                .find(|j| j.name == joint)
                .and_then(|j| j.axis1.as_ref())
                .map(|a| a.velocity)
            {
                return Ok(v);
            }
        }
    }
    bail!("no state for {joint} on {T_JOINTS}")
}

/// X del chasis y el instante de SIMULACION en el que se midio.
///
/// El tiempo sale del stamp del mensaje y no del reloj de pared a proposito.
/// Derivar una posicion contra el reloj de pared mete en la cuenta todo lo que
/// pasa entre medias --- una muestra que llega tarde, o dos lecturas del mismo
/// mensaje --- y eso salia como picos de 12 m/s^2 y velocidades por encima de
/// la velocidad libre del motor. La fisica no dio esos saltos: los dio el
/// muestreo.
fn chassis_z(rx: &Receiver<Pose_V>) -> Result<f64> {
    for _ in 0..500 {
        let msg = rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| anyhow!("no poses on {T_POSE}: {e}"))?;
        if let Some(p) = msg.pose.iter().find(|p| p.name == "chassis") {
            if let Some(v) = p.position.as_ref() {
                return Ok(v.z);
            }
        }
    }
    bail!("no pose for link 'chassis' ever arrived on {T_POSE}")
}

fn chassis_x(rx: &Receiver<Pose_V>) -> Result<(f64, f64)> {
    for _ in 0..500 {
        let msg = rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| anyhow!("no poses on {T_POSE}: {e}"))?;
        let t = msg
            .header
            .as_ref()
            .and_then(|h| h.stamp.as_ref())
            .map(|s| s.sec as f64 + s.nsec as f64 * 1e-9);
        if let Some(p) = msg.pose.iter().find(|p| p.name == "chassis") {
            if let (Some(v), Some(t)) = (p.position.as_ref(), t) {
                return Ok((v.x, t));
            }
        }
    }
    bail!("no pose for link 'chassis' ever arrived on {T_POSE}")
}
