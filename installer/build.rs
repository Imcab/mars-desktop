use std::path::Path;

fn main() {
    // The UI is EMBEDDED into the binary at compile time (that is what
    // `tauri::generate_context!` does with tauri.conf.json's `frontendDist`),
    // and `tauri-build` only emits rerun-if-changed for tauri.conf.json and
    // capabilities/. Without this, editing a .js and rebuilding recompiles
    // nothing: cargo says "Finished", the app opens with the previous version
    // and the change simply does not show up, with no error at all. It is the
    // same trap the Simulation Studio's build.rs documents.
    watch(Path::new("ui"));

    tauri_build::build()
}

fn watch(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            watch(&p);
        } else {
            println!("cargo:rerun-if-changed={}", p.display());
        }
    }
}
