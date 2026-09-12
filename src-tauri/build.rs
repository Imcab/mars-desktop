use std::path::Path;

fn main() {
    // El bundle de vite se EMPOTRA en el binario al compilar (lo hace
    // `tauri::generate_context!` con el `frontendDist` de tauri.conf.json), y
    // `tauri-build` solo emite rerun-if-changed para tauri.conf.json y
    // capabilities/.
    //
    // Sin esto, construir una edición y después la otra puede dejar el binario
    // nuevo con el bundle VIEJO adentro: cargo dice "Finished" sin recompilar
    // nada porque ningún .rs cambió. Es exactamente la trampa que documenta el
    // build.rs del Simulation Studio, y acá muerde al empaquetar la release,
    // que construye full y tools una detrás de la otra.
    vigilar(Path::new("../dist"));

    tauri_build::build()
}

fn vigilar(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entradas) = std::fs::read_dir(dir) else {
        // En un checkout limpio todavía no hay dist/: el `npm run build` del
        // beforeBuildCommand la crea, y esa creación ya dispara la
        // recompilación por la línea de arriba.
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
