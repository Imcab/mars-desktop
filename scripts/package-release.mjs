#!/usr/bin/env node
// Builds and packages MARS for THIS platform.
//
//   node scripts/package-release.mjs                 everything that applies
//   node scripts/package-release.mjs --no-studio     dashboard only
//   node scripts/package-release.mjs --only tools    a single edition
//   node scripts/package-release.mjs --arch x86_64   macOS' other architecture
//   node scripts/package-release.mjs --no-engine     a Studio with no engine
//
// It leaves the archives in `release/`, with the names the installer expects
// (`installer/src/platform.rs::archive_name`). If those names change on one
// side they have to change on the other: it is the only contract between the
// packager and the installer.
//
// Every archive carries its executable AT THE ROOT. That is not incidental: the
// installer drops the contents straight into the install folder, and
// mars-desktop looks for the Simulation Studio NEXT TO its own executable (see
// src-tauri/src/simlauncher.rs). Putting the binary inside a subfolder would
// break that lookup without any error at all.
//
// The Studio's archive also carries a `sim/` folder with the data AND the
// compiled engine it needs to start; see `stageSimData` and `stageSimBinaries`
// for what goes in and why. Packaging it on a machine that has not built the
// engine is refused: that archive installs and can never run.

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "release")

const args = process.argv.slice(2)
const noStudio = args.includes("--no-studio")
// Escape hatch for a machine that cannot build the engine (CI has no conda
// environment): packages the Studio without it rather than skipping it.
const allowNoEngine = args.includes("--no-engine")
const onlyEdition = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
// Crossing architectures ONLY makes sense on macOS, where both live on the same
// platform and the system SDK is universal. Windows and Linux are each built on
// their own.
const requestedArch = args.includes("--arch") ? args[args.indexOf("--arch") + 1] : null

// --- Platform ---------------------------------------------------------------

const OS = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
const NATIVE_ARCH = process.arch === "arm64" ? "aarch64" : "x86_64"
const ARCH = requestedArch ?? NATIVE_ARCH
if (ARCH !== "x86_64" && ARCH !== "aarch64") {
  console.error(`Unknown architecture: ${ARCH}`)
  process.exit(2)
}
if (ARCH !== NATIVE_ARCH && OS !== "macos") {
  console.error(`Architectures can only be crossed on macOS, not on ${OS}.`)
  process.exit(2)
}
// `null` when building for the native architecture: passing --target anyway
// would send the output to target/<triple>/release and force a rebuild of what
// was already compiled.
const TRIPLE = ARCH === NATIVE_ARCH ? null : `${ARCH}-apple-darwin`
const SUBDIR = TRIPLE ? `${TRIPLE}/release` : "release"

const EXE = OS === "windows" ? ".exe" : ""
const EXT = OS === "windows" ? "zip" : "tar.gz"
// The Studio drags Gazebo along, which today is only built on Windows and Linux.
const HAS_STUDIO = OS !== "macos"

const version = readFileSync(join(root, "src/constants/version.ts"), "utf8").match(
  /MARS_VERSION\s*=\s*"([^"]+)"/,
)?.[1]
if (!version) {
  console.error("Could not read MARS_VERSION from src/constants/version.ts")
  process.exit(2)
}

// --- Helpers ----------------------------------------------------------------

const run = (cmd, cmdArgs, options = {}) => {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}`)
  execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: root, shell: OS === "windows", ...options })
}

/**
 * Compresses `entries` (absolute paths to files or folders) into one archive.
 *
 * Files land at the root; a folder keeps its own name and tree, which is how
 * the Studio's `sim/` data travels.
 *
 * The system's own tool is used rather than an npm library: both
 * `Compress-Archive` and `tar` exist on all three platforms and on the CI
 * runners, and the packager needs no node_modules of its own.
 */
function packageArchive(name, entries) {
  const dest = join(outDir, name)
  rmSync(dest, { force: true })

  if (OS === "windows") {
    const list = entries.map((f) => `'${f.replace(/'/g, "''")}'`).join(",")
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${list} -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ])
  } else {
    // -C per entry so the tar stays flat even when the binaries come from
    // different folders (target/release of two different crates).
    const parts = entries.flatMap((f) => ["-C", dirname(f), f.slice(dirname(f).length + 1)])
    run("tar", ["-czf", dest, ...parts])
  }
  const bytes = readFileSync(dest).length
  console.log(`  → ${name} (${(bytes / 1048576).toFixed(1)} MB)`)
}

/**
 * Stages the `sim/` data the Studio needs in order to START.
 *
 * `Supervisor::descubrir()` looks for a `sim/` with `worlds/` and `protocol/`
 * in it, and without one the Studio writes the reason to stderr and exits. It
 * is built with no console, so that message goes nowhere: the button in
 * mars-desktop appeared to do nothing at all. That is what shipping the
 * executable on its own cost.
 *
 * What is copied is tiny (about half a megabyte) and is data, not build
 * output: worlds, the protocol contract, the Gazebo GUI layout, the models,
 * the Java glue and the engine sources. What is NOT copied is `target/`,
 * `build/` and `fields/` (gigabytes, and the Studio's own Field Library
 * reinstalls the fields), nor the conda environment, which the Studio
 * diagnoses and explains by itself.
 *
 * The compiled engine goes in on top of that, in `stageSimBinaries`.
 */
function stageSimData() {
  const stage = join(outDir, "_stage")
  rmSync(stage, { recursive: true, force: true })
  const simOut = join(stage, "sim")
  mkdirSync(simOut, { recursive: true })

  const skip = (src) => !/[\\/](__pycache__|target|build|dist|\.gzsource)$/.test(src)
  for (const dir of ["worlds", "protocol", "gui", "models", "glue", "engine"]) {
    cpSync(join(root, "sim", dir), join(simOut, dir), { recursive: true, filter: skip })
  }
  for (const file of ["environment.yml", "build.ps1", "verify.ps1"]) {
    cpSync(join(root, "sim", file), join(simOut, file))
  }
  return simOut
}

/**
 * Puts the COMPILED engine into the staged `sim/build/`.
 *
 * Without this the install had the data and not one of the four binaries that
 * actually run a simulation, and Diagnostics said so on the installed machine:
 * three FAILs and a WARN, each one telling the user to run `sim\build.ps1` --
 * a script that needs CMake, Ninja, MSVC and the engine sources, none of which
 * anybody who just downloaded an installer has. Shipping the data alone was
 * shipping something that can never start.
 *
 * Where each piece goes is not free choice: `supervisor.rs` looks for the
 * engine and MarsLink in `sim/build/` (`GZ_SIM_SYSTEM_PLUGIN_PATH` points
 * there too, so the plugin has to sit NEXT TO the server), and the bridge in
 * `sim/build/` before the two cargo folders. Moving any of them means moving
 * the lookup as well.
 *
 * What does NOT travel is Gazebo itself: these binaries link against the conda
 * environment, which the user creates from `environment.yml` and the Studio
 * checks on its own page. That is the one prerequisite this cannot remove.
 *
 * Returns what was missing, split into `critical` and `optional`.
 */
function stageSimBinaries(simOut) {
  const buildOut = join(simOut, "build")
  mkdirSync(buildOut, { recursive: true })

  // The bridge is plain cargo, so it lands wherever it was built. Release
  // first: if both exist it is the one worth shipping.
  const bridge = ["release", "debug"]
    .map((profile) => join(root, "sim/bridge/target", profile, `mars-bridge${EXE}`))
    .find(existsSync)

  const marsLink = OS === "windows" ? "MarsLink.dll" : "libMarsLink.so"
  // The severity is not this script's to invent: it is the one the app shows on
  // its own Diagnostics page (`Supervisor::diagnostico`). The 3D window is a
  // `warn` there --- the simulation runs headless without it, which is how it
  // runs in CI --- and the other three are `fail`. Two different answers to
  // "is this required?" is how you end up refusing to ship over a window.
  const pieces = [
    ["mars-sim-server", join(root, "sim/build", `mars-sim-server${EXE}`), true],
    ["mars-bridge", bridge, true],
    [marsLink, join(root, "sim/build", marsLink), true],
    ["mars-sim-gui", join(root, "sim/build", `mars-sim-gui${EXE}`), false],
  ]

  const missing = { critical: [], optional: [] }
  for (const [name, src, critical] of pieces) {
    if (src && existsSync(src)) {
      cpSync(src, join(buildOut, basename(src)))
      console.log(`  + sim/build/${basename(src)}`)
    } else {
      ;(critical ? missing.critical : missing.optional).push(name)
    }
  }
  return missing
}

// --- Build ------------------------------------------------------------------

console.log(
  `\nMARS ${version} — packaging for ${OS} ${ARCH}` +
    (TRIPLE ? ` (crossed from ${NATIVE_ARCH})` : "") +
    `\n${"=".repeat(46)}`,
)
run("node", ["scripts/sync-version.mjs"])

// The folder is emptied ONLY on the native-architecture pass. macOS' second
// pass (`--arch x86_64`) runs against the same folder, and if it emptied it too
// it would wipe the arm64 archives the first pass had just left there — which
// is exactly what happened the first time: the release went out with no Apple
// Silicon files at all and the workflow still said "success".
if (!requestedArch) {
  rmSync(outDir, { recursive: true, force: true })
}
mkdirSync(outDir, { recursive: true })

// The icon travels with the archive: on Linux the `.desktop` file the installer
// writes references it by path, and without it the launcher gets the generic
// icon.
const icon = join(outDir, "icon.png")
cpSync(join(root, "src-tauri/icons/128x128@2x.png"), icon)

const editions = onlyEdition ? [onlyEdition] : ["full", "tools"]
for (const edition of editions) {
  if (edition !== "full" && edition !== "tools") {
    console.error(`Unknown edition: ${edition}`)
    process.exit(2)
  }
  console.log(`\n--- mars-desktop (${edition}) ---`)

  // The front end first: the binary embeds it at compile time.
  run("npm", ["run", "build"], { env: { ...process.env, MARS_EDITION: edition } })

  // `custom-protocol` is passed explicitly rather than being a `default`
  // feature because the Tools edition is built with --no-default-features,
  // which would take it away: the binary would open the devUrl and show the
  // webview's connection error instead of the app. See the note in
  // src-tauri/Cargo.toml.
  const cargo = [
    "build", "--release",
    "--manifest-path", "src-tauri/Cargo.toml",
    "--features", "custom-protocol",
  ]
  if (edition === "tools") cargo.push("--no-default-features")
  if (TRIPLE) cargo.push("--target", TRIPLE)
  run("cargo", cargo)

  const binary = join(root, "src-tauri/target", SUBDIR, `mars-desktop${EXE}`)
  if (!existsSync(binary)) {
    console.error(`cargo did not leave ${binary}`)
    process.exit(1)
  }
  packageArchive(`mars-desktop-${edition}-${OS}-${ARCH}.${EXT}`, [binary, icon])
}

if (HAS_STUDIO && !noStudio) {
  console.log("\n--- MARS Simulation Studio ---")
  const cargoStudio = ["build", "--release", "--manifest-path", "sim/app/Cargo.toml"]
  if (TRIPLE) cargoStudio.push("--target", TRIPLE)
  run("cargo", cargoStudio)
  const binary = join(root, "sim/app/target", SUBDIR, `mars-sim-app${EXE}`)
  if (existsSync(binary)) {
    const simData = stageSimData()
    const missing = stageSimBinaries(simData)
    // A Studio without its engine installs fine and then fails on the machine
    // of whoever downloaded it, where there is nothing to build with. Better to
    // say it here, on the machine that CAN build it, than to ship it.
    if (missing.optional.length) {
      console.warn(`  WARNING: no ${missing.optional.join(", ")}; the simulation will run headless.`)
    }
    if (missing.critical.length && !allowNoEngine) {
      console.error(
        `\nThe Studio was NOT packaged: the compiled engine is missing (${missing.critical.join(", ")}).\n` +
          `Build it and run this again:\n` +
          `    conda activate mars-sim\n` +
          `    sim\\build.ps1                                     # engine, world window, MarsLink\n` +
          `    cargo build --release --manifest-path sim/bridge/Cargo.toml\n` +
          `Pass --no-engine to package it anyway (it will not start).`,
      )
    } else {
      if (missing.critical.length) {
        console.warn(
          `  WARNING: packaging without ${missing.critical.join(", ")}; the Studio will not start.`,
        )
      }
      packageArchive(`mars-simulation-studio-${OS}-${ARCH}.${EXT}`, [binary, icon, simData])
    }
  } else {
    // Not fatal: the installer knows how to carry on without a component the
    // release does not publish, and says so on screen.
    console.warn(
      `WARNING: the Studio was not built (${binary} does not exist); the release ships without it.`,
    )
  }
}

// --- The installer ----------------------------------------------------------
//
// It ships loose, uncompressed: it is what people download and run. A zip
// holding a single .exe only adds a step.
console.log("\n--- MARS Installer ---")
const cargoInstaller = ["build", "--release", "--manifest-path", "installer/Cargo.toml"]
if (TRIPLE) cargoInstaller.push("--target", TRIPLE)
run("cargo", cargoInstaller)
const installer = join(root, "installer/target", SUBDIR, `mars-installer${EXE}`)
if (existsSync(installer)) {
  const name = OS === "windows" ? "MARS-Installer.exe" : `MARS-Installer-${OS}-${ARCH}`
  cpSync(installer, join(outDir, name))
  console.log(`  → ${name}`)
}

rmSync(icon, { force: true })
rmSync(join(outDir, "_stage"), { recursive: true, force: true })

writeFileSync(join(outDir, "VERSION"), `${version}\n`)
console.log(`\nDone. Archives are in ${outDir}`)
