use std::path::Path;

fn main() {
    // La UI se EMPOTRA en el binario en tiempo de compilación (lo hace
    // `tauri::generate_context!` con el `frontendDist` de tauri.conf.json), y
    // `tauri-build` solo emite rerun-if-changed para tauri.conf.json y
    // capabilities/. Sin esto, editar un .js o un .css y volver a compilar no
    // recompila nada: cargo dice "Finished", la app abre con la versión
    // anterior y el cambio simplemente no aparece, sin ningún error. Se pierde
    // media hora buscando el bug en el código que sí estaba bien.
    //
    // No hay watcher que valga: hay que enumerar los archivos.
    vigilar(Path::new("ui"));

    tauri_build::build()
}

fn vigilar(dir: &Path) {
    // Un directorio vigilado también dispara la recompilación cuando aparece o
    // desaparece un archivo dentro, que es lo que cubre el caso de añadir una
    // página nueva.
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
