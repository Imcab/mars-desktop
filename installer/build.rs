use std::path::Path;

fn main() {
    // La UI se EMPOTRA en el binario al compilar (lo hace
    // `tauri::generate_context!` con el `frontendDist` de tauri.conf.json), y
    // `tauri-build` solo emite rerun-if-changed para tauri.conf.json y
    // capabilities/. Sin esto, editar un .js y recompilar no recompila nada:
    // cargo dice "Finished", la app abre con la version anterior y el cambio
    // no aparece, sin ningun error. Es la misma trampa que documenta el
    // build.rs del Simulation Studio.
    vigilar(Path::new("ui"));

    tauri_build::build()
}

fn vigilar(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entradas) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entradas.flatten() {
        let p = e.path();
        if p.is_dir() {
            vigilar(&p);
        } else {
            println!("cargo:rerun-if-changed={}", p.display());
        }
    }
}
