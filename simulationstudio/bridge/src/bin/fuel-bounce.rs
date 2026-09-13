//! Mide el rebote real de un FUEL contra el suelo.
//!
//! Existe porque el coeficiente de restitución de `models/fuel/model.sdf` es
//! el único número del modelo que no sale del manual de juego, y porque no
//! estaba dicho en ningún sitio que el motor de física lo respete: un
//! `<bounce>` que el solver ignora en silencio produce una pelota que cae y se
//! queda muerta, con el SDF diciendo lo contrario.
//!
//! Se suscribe a las poses del mundo, sigue la Z de cada FUEL y anota la
//! altura de la que cae y la del primer rebote. De ahí sale el coeficiente
//! medido: `e = sqrt(h_rebote / h_caída)`.
//!
//! Uso, con el motor corriendo aparte:
//!   mars-sim-server worlds/fuel-drop.sdf run
//!   cargo run --bin fuel-bounce

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use gz_msgs::pose_v::Pose_V;
use gz_transport::Node;

/// Lo publica el SceneBroadcaster con la pose de todo lo que hay en el mundo.
const T_POSES: &str = "/world/mars/pose/info";

/// Cuánto observar. Con caídas desde 2.5 m, 6 s cubre la bajada y el primer
/// rebote entero con margen.
const OBSERVAR: Duration = Duration::from_secs(6);

/// Radio del FUEL: la Z que publica gz es la del centro, no la del punto de
/// contacto, así que la altura sobre el suelo es Z menos el radio.
const RADIO: f64 = 0.075;

/// Por debajo de esto no se considera que haya despegado del suelo. Los
/// micro-rebotes de una pelota ya asentada no son un rebote.
const MINIMO_REBOTE: f64 = 0.005;

#[derive(Default)]
struct Traza {
    z_inicial: f64,
    z_min: f64,
    toco: bool,
    /// Altura del primer rebote, en metros sobre el suelo.
    apice: f64,
    /// Se cierra cuando la pelota vuelve a bajar tras el primer rebote.
    cerrado: bool,
    z_previa: f64,
}

fn main() -> Result<()> {
    let mut node = Node::new().ok_or_else(|| anyhow!("could not create the node"))?;
    let poses = node
        .subscribe_channel::<Pose_V>(T_POSES, 1)
        .ok_or_else(|| anyhow!("could not subscribe to {T_POSES}"))?;
    println!("[bounce] subscribed to {T_POSES}, watching for {OBSERVAR:?}");

    let mut trazas: HashMap<String, Traza> = HashMap::new();
    let arranque = Instant::now();

    while arranque.elapsed() < OBSERVAR {
        let Ok(msg) = poses.recv_timeout(Duration::from_millis(500)) else {
            continue;
        };
        for p in msg.pose.iter() {
            if !p.name.starts_with("fuel_") {
                continue;
            }
            let Some(pos) = p.position.as_ref() else { continue };
            let z = pos.z;

            let t = trazas.entry(p.name.clone()).or_insert_with(|| Traza {
                z_inicial: z,
                z_min: z,
                z_previa: z,
                ..Default::default()
            });
            if t.cerrado {
                continue;
            }

            let altura = (z - RADIO).max(0.0);

            if !t.toco {
                // Bajando: se busca el punto más bajo, que es el impacto.
                if z < t.z_min {
                    t.z_min = z;
                } else if t.z_previa <= t.z_min + 1e-6 && z > t.z_previa {
                    // Empezó a subir: el impacto ya ocurrió.
                    t.toco = true;
                }
            } else if altura > t.apice {
                t.apice = altura;
            } else if t.apice > MINIMO_REBOTE && altura < t.apice - 1e-4 {
                // Ya volvió a bajar: el primer rebote está completo.
                t.cerrado = true;
            }
            t.z_previa = z;
        }
    }

    if trazas.is_empty() {
        println!("[bounce] no FUEL seen. Is the engine running with worlds/fuel-drop.sdf?");
        return Ok(());
    }

    println!();
    println!("  {:<18} {:>10} {:>10} {:>10}", "model", "drop (m)", "bounce (m)", "e");
    let mut nombres: Vec<&String> = trazas.keys().collect();
    nombres.sort();
    for n in nombres {
        let t = &trazas[n];
        let caida = (t.z_inicial - RADIO).max(0.0);
        let e = if caida > 1e-6 {
            (t.apice / caida).sqrt()
        } else {
            0.0
        };
        println!("  {n:<18} {caida:>10.3} {:>10.3} {e:>10.3}", t.apice);
    }
    println!();
    println!("  e = sqrt(bounce / drop). If every e is 0.000 the engine is ignoring");
    println!("  <bounce> and the restitution in model.sdf means nothing.");
    Ok(())
}
