use std::path::Path;

fn main() {
    // Vite's bundle is EMBEDDED into the binary at compile time (that is what
    // `tauri::generate_context!` does with tauri.conf.json's `frontendDist`),
    // and `tauri-build` only emits rerun-if-changed for tauri.conf.json and
    // capabilities/.
    //
    // Without this, building one edition and then the other can leave the new
    // binary with the OLD bundle inside: cargo says "Finished" without
    // recompiling anything because no .rs changed. It is exactly the trap the
    // Simulation Studio's build.rs documents, and here it bites when packaging
    // the release, which builds full and tools back to back.
    watch(Path::new("../dist"));

    tauri_build::build()
}

fn watch(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entries) = std::fs::read_dir(dir) else {
        // A clean checkout has no dist/ yet: the beforeBuildCommand's
        // `npm run build` creates it, and that creation already triggers the
        // rebuild through the line above.
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
