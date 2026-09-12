//! Dos trabajos de compilación: generar el protocolo y aliasar librerías.
//!
//! # 1. Constantes del protocolo
//!
//! `sim/protocol/topics.toml` dice de sí mismo que es la fuente única de verdad
//! y que "nadie escribe un nombre de tópico a mano en el código". Esto lo hace
//! cierto del lado de Rust: lee el manifiesto en tiempo de compilación y emite
//! las constantes. Renombrar un tópico en el manifiesto rompe la compilación
//! del bridge, que es exactamente lo que se quiere.
//!
//! # 2. Alias de librerías
//!
//! Salva el desajuste de nombres entre pkg-config y MSVC.
//!
//! Los `.pc` de conda-forge están escritos con la convención de Unix: piden
//! `-lprotobuf` y `-lzmq`, contando con que el enlazador anteponga `lib`. MSVC
//! no lo hace -- busca `protobuf.lib` y `zmq.lib` literales -- mientras que los
//! archivos instalados se llaman `libprotobuf.lib` y `libzmq.lib`. El enlace de
//! `gz-transport-sys` muere con
//!
//!     LNK1181: no se puede abrir el archivo de entrada 'protobuf.lib'
//!
//! Los `cargo:rustc-link-lib=` los emite `gz-transport-sys` y no hay forma de
//! quitárselos desde aquí, así que en vez de pelear con el nombre se le da lo
//! que pide: un enlace duro con el nombre correcto en OUT_DIR, que se añade al
//! camino de búsqueda del enlazador.
//!
//! Si aparece un LNK1181 nuevo, se añade el nombre a ALIAS y ya.
//!
//! Solo aplica a Windows con MSVC. En Linux y macOS los nombres ya coinciden.

use std::path::{Path, PathBuf};

/// Librerías que hay que exponer sin el prefijo `lib`.
const ALIAS: &[&str] = &["protobuf", "zmq"];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=CONDA_PREFIX");

    generar_protocolo();
    aliasar_librerias();
}

/// Traduce sim/protocol/topics.toml a constantes de Rust.
fn generar_protocolo() {
    let manifiesto = Path::new(env!("CARGO_MANIFEST_DIR")).join("../protocol/topics.toml");
    println!("cargo:rerun-if-changed={}", manifiesto.display());

    let texto = std::fs::read_to_string(&manifiesto)
        .unwrap_or_else(|e| panic!("no se pudo leer {}: {e}", manifiesto.display()));
    let doc: toml::Value = texto.parse().expect("topics.toml no es TOML válido");

    let mut out = String::from(
        "// GENERADO por build.rs desde sim/protocol/topics.toml. No editar.\n",
    );

    let s = |k: &str| doc[k].as_str().expect("campo de texto").to_string();
    out += &format!("pub const PROTOCOL_VERSION: &str = {:?};\n", s("protocol_version"));
    out += &format!("pub const WORLD: &str = {:?};\n", s("world"));

    let campo = &doc["field"];
    for k in ["length_m", "width_m"] {
        let v = campo[k].as_float().expect("las dimensiones son decimales");
        out += &format!("pub const FIELD_{}: f64 = {v:?};\n", k.to_uppercase());
    }

    // Una constante por tópico, con el nombre derivado de su ruta:
    //   /mars/state/pose  ->  T_MARS_STATE_POSE
    // Los de la plantilla del glue llevan <name> y no son constantes, se saltan.
    for grupo in ["gz", "nt"] {
        let Some(entradas) = doc.get(grupo).and_then(|g| g.as_array()) else { continue };
        for e in entradas {
            let topico = e["topic"].as_str().expect("topic es texto");
            if topico.contains('<') {
                continue;
            }
            let ident: String = topico
                .trim_start_matches('/')
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
                .collect();
            out += &format!("pub const T_{ident}: &str = {topico:?};\n");
        }
    }

    let destino = PathBuf::from(std::env::var("OUT_DIR").expect("cargo define OUT_DIR"))
        .join("protocol.rs");
    std::fs::write(&destino, out).expect("no se pudo escribir protocol.rs");
}

fn aliasar_librerias() {
    if cfg!(not(all(target_os = "windows", target_env = "msvc"))) {
        return;
    }

    let Some(libdir) = find_conda_libdir() else {
        // Sin entorno no hay nada que parchear; el enlace fallará después con
        // un mensaje más claro que cualquier cosa que digamos aquí.
        return;
    };

    let out = PathBuf::from(std::env::var("OUT_DIR").expect("cargo define OUT_DIR"));
    let mut hechos = 0;

    for name in ALIAS {
        // Si conda ya instala el nombre sin prefijo, no tocamos nada.
        if libdir.join(format!("{name}.lib")).exists() {
            continue;
        }
        let origen = libdir.join(format!("lib{name}.lib"));
        if !origen.exists() {
            continue;
        }

        let destino = out.join(format!("{name}.lib"));
        // Enlace duro en vez de copia: estas librerías pesan decenas de MB y
        // están en el mismo volumen. Si falla (volúmenes distintos, permisos),
        // se copia.
        if destino.exists() {
            let _ = std::fs::remove_file(&destino);
        }
        if std::fs::hard_link(&origen, &destino).is_err() {
            std::fs::copy(&origen, &destino).unwrap_or_else(|e| {
                panic!("no se pudo aliasar {} -> {}: {e}", origen.display(), destino.display())
            });
        }
        hechos += 1;
    }

    if hechos > 0 {
        println!("cargo:rustc-link-search=native={}", out.display());
    }
}

/// Directorio de librerías del entorno conda `mars-sim`.
fn find_conda_libdir() -> Option<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(prefix) = std::env::var("CONDA_PREFIX") {
        bases.push(PathBuf::from(prefix));
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        bases.push(Path::new(&home).join("miniforge3/envs/mars-sim"));
    }

    bases
        .into_iter()
        .map(|b| b.join("Library/lib"))
        .find(|d| d.is_dir())
}
