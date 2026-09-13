//! Diagnóstico: lista los tópicos que el discovery de gz-transport ve.
//!
//! Sirve para el caso en que un tópico "no existe" aunque el motor lo esté
//! publicando. Con el motor corriendo:
//!
//!   cargo run --bin gz-topics

use anyhow::{anyhow, Result};
use std::time::Duration;

fn main() -> Result<()> {
    let node = gz_transport::Node::new().ok_or_else(|| anyhow!("could not create the node"))?;

    // El discovery es por multicast y asíncrono: consultar de inmediato
    // devuelve una lista vacía y hace pensar que no hay nadie publicando.
    println!("[topics] waiting 3 s for discovery...");
    std::thread::sleep(Duration::from_secs(3));

    let mut topics = node.topic_list();
    topics.sort();
    println!("[topics] {} discovered:", topics.len());
    for t in &topics {
        println!("  {t}");
    }
    Ok(())
}
