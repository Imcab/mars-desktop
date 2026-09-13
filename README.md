# MARS

The whole MARS ecosystem for FRC in one repository: the NetworkTables
dashboard, the Gazebo-based simulation environment, the installer that puts
them on a machine, and the documentation.

They live together because they ship together. One release carries all three,
one `manifest.json` describes it, and one installer reads that manifest — so a
change that crosses products (a new archive name, a version bump, a folder the
Studio needs at runtime) is one commit and not a coordination problem across
three repositories.

## Installing

Download the installer for your system from the
[latest release](https://github.com/Imcab/Mars-frc/releases/latest) and run it.
It fetches everything else.

| System | File |
|---|---|
| **Windows** (recommended) | `MARS-Installer.exe` |
| Linux | `MARS-Installer-linux-x86_64` (`chmod +x` first) |
| macOS | `MARS-Installer-macos-aarch64` or `-x86_64` (`chmod +x` first) |

The installer lets you pick the edition, needs no administrator rights, and also
uninstalls.

## What is in here

| Folder | What it is |
|---|---|
| [`desktop/`](desktop/README.md) | **MARS Desktop**: the NetworkTables dashboard. React + TypeScript over a Rust/Tauri backend. This is what most people mean by "MARS". |
| [`simulationstudio/`](simulationstudio/app/README.md) | **MARS Simulation Studio** and the Gazebo-based simulation engine. A separate product with its own version and its own life cycle. |
| [`installer/`](installer/README.md) | **MARS Installer**: the app that installs, updates and uninstalls the ecosystem. |
| [`docs/`](docs/) | The documentation site (MkDocs Material). |
| [`scripts/`](scripts/) | The only things that know about all three at once: release packaging and version syncing. |

Each folder builds on its own — there is no cargo workspace and no npm
workspace, on purpose: the three products have different toolchains (npm +
cargo, cargo + conda + CMake, cargo) and nothing to gain from sharing a
lockfile.

```bash
cd desktop            && npm install && npm run tauri dev
cd simulationstudio   && ./build.ps1 && cargo run --manifest-path app/Cargo.toml
cd installer          && cargo run
```

### One folder, two names

Inside a release archive the Studio's data travels as `sim/`, not as
`simulationstudio/`. That name is a contract with the installed application
(`Supervisor::buscar_sim_dir` looks for a `sim/` next to the executable), so the
packager writes it literally and it does not follow this repository's layout.

## Releasing a version

The dashboard's version is written in **one place**,
`desktop/src/constants/version.ts`; the Studio's is in
`simulationstudio/app/Cargo.toml` and does not follow it. Line up every file
that carries either of them with:

```bash
node scripts/sync-version.mjs          # check
node scripts/sync-version.mjs --write  # fix
```

After that, a `vX.Y.Z` tag fires [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds on three runners (Windows, Linux, and macOS producing both
architectures), writes `manifest.json` with the real sha256 sums, and publishes
the release. Each platform is built on its own because Tauri links against the
system webview: cross-compiling between operating systems is not possible.

To build the archives for your own platform without a tag:

```bash
node scripts/package-release.mjs       # leaves them in release/
```
