# MARS Desktop

A NetworkTables dashboard for FRC: 2D and 3D field visualisers, swerve,
mechanisms, plots, live equations, SysId, loop-timing and bandwidth analysis, a
command console, and reading/writing of `.wpilog` files.

It is the tool that goes with the [MARS](https://github.com/STZ-Robotics/Mars)
framework, but **you do not need MARS to use it**: it ships in two editions.

This folder is one of the three products in the repository; the map of the whole
thing is in [`../README.md`](../README.md).

## The two editions

| | Complete MARS | Tools only |
|---|---|---|
| Dashboard, visualisers, plots, SysId, logs | ✅ | ✅ |
| MARS framework: projects, packages, manifest, wizard, features, subsystems, watchdog | ✅ | — |
| MARS Simulation Studio | ✅ (not on macOS) | — |

"Tools only" is a separate build, not the same app with the buttons hidden: the
MARS code reaches neither the front-end bundle nor the Rust binary. The how and
the why are in [`src/mars/README.md`](src/mars/README.md).

## Development

Everything here runs **from this folder**, not from the repository root: the
`package.json` lives here.

```bash
cd desktop

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
| `public/` | Static assets vite serves as-is: field images, 3D field models, icons. |

The button that opens the Simulation Studio is `src-tauri/src/simlauncher.rs`,
and it is all mars-desktop knows about the simulation: it looks for the Studio's
executable next to its own (an installation) or in
`simulationstudio/app/target/` (this repository), and launches it. The two
applications do not share a process.

## The version

It is written in **one place**, `src/constants/version.ts`. The other three
files that carry it (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`) are lined up from the repository root with:

```bash
node scripts/sync-version.mjs --write
```
