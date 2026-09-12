# MARS Desktop

A NetworkTables dashboard for FRC: 2D and 3D field visualisers, swerve,
mechanisms, plots, live equations, SysId, loop-timing and bandwidth analysis, a
command console, and reading/writing of `.wpilog` files.

It is the tool that goes with the [MARS](https://github.com/STZ-Robotics/Mars)
framework, but **you do not need MARS to use it**: it ships in two editions.

## Installing

Download the installer for your system from the
[latest release](https://github.com/Imcab/mars-desktop/releases/latest) and run
it. It fetches everything else.

| System | File |
|---|---|
| **Windows** (recommended) | `MARS-Installer.exe` |
| Linux | `MARS-Installer-linux-x86_64` (`chmod +x` first) |
| macOS | `MARS-Installer-macos-aarch64` or `-x86_64` (`chmod +x` first) |

The installer lets you pick the edition, needs no administrator rights, and also
uninstalls. The details are in [`installer/README.md`](installer/README.md).

### The two editions

| | Complete MARS | Tools only |
|---|---|---|
| Dashboard, visualisers, plots, SysId, logs | ✅ | ✅ |
| MARS framework: projects, packages, manifest, wizard, features, subsystems, watchdog | ✅ | — |
| MARS Simulation Studio | ✅ (not on macOS) | — |

"Tools only" is a separate build, not the same app with the buttons hidden: the
MARS code reaches neither the front-end bundle nor the Rust binary. The how and
the why are in [`src/mars/README.md`](src/mars/README.md).

## Development

```bash
npm install
npm run tauri dev                     # complete edition
MARS_EDITION=tools npm run tauri dev  # Tools edition

npm test                                        # front-end tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml # Rust tests
npm run build                                   # tsc + vite
```

`MARS_EDITION` chooses what gets compiled; it defaults to `full`.

## How it is put together

| Folder | What it is |
|---|---|
| `src/` | The interface (React + TypeScript). `src/mars/` is the block that only exists in the complete edition. |
| `src-tauri/` | The backend: our own NT4 client, `.wpilog` reading and writing, 3D assets, Java code generators. |
| `installer/` | **MARS Installer**: the app that installs, updates and uninstalls the ecosystem. |
| `sim/` | **MARS Simulation Studio** and the Gazebo-based simulation engine. A separate product with its own life cycle. |
| `scripts/` | Release packaging and version syncing. |

## Releasing a version

The version is written in **one place**, `src/constants/version.ts`; the other
three files that carry it (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`) are lined up with:

```bash
node scripts/sync-version.mjs --write
```

After that, a `vX.Y.Z` tag fires `.github/workflows/release.yml`, which builds on
three runners (Windows, Linux, and macOS producing both architectures), writes
`manifest.json` with the real sha256 sums, and publishes the release. Each
platform is built on its own because Tauri links against the system webview:
cross-compiling between operating systems is not possible.
