#!/usr/bin/env node
// Construye y empaqueta MARS para ESTA plataforma.
//
//   node scripts/package-release.mjs                 todo lo que corresponda
//   node scripts/package-release.mjs --sin-studio    solo el dashboard
//   node scripts/package-release.mjs --solo tools    una sola edición
//
// Deja los paquetes en `release/`, con los nombres que espera el instalador
// (`installer/src/plataforma.rs::nombre_archivo`). Si esos nombres cambian de
// un lado, hay que cambiarlos del otro: es el único contrato entre el
// empaquetador y el instalador.
//
// Cada paquete lleva el ejecutable en la raíz y nada más. Que sea plano no es
// casualidad: el instalador coloca el contenido tal cual en la carpeta de
// instalación, y mars-desktop busca al Simulation Studio JUNTO a su propio
// ejecutable (ver src-tauri/src/simlauncher.rs). Una carpeta intermedia
// rompería ese hallazgo sin dar ningún error.

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const salida = join(raiz, "release")

const args = process.argv.slice(2)
const sinStudio = args.includes("--sin-studio")
const soloEdicion = args.includes("--solo") ? args[args.indexOf("--solo") + 1] : null

// --- Plataforma -------------------------------------------------------------

const SO = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
const ARCH = process.arch === "arm64" ? "aarch64" : "x86_64"
const EXE = SO === "windows" ? ".exe" : ""
const EXT = SO === "windows" ? "zip" : "tar.gz"
// El Studio arrastra Gazebo, que hoy solo se construye en Windows y Linux.
const HAY_STUDIO = SO !== "macos"

const version = readFileSync(join(raiz, "src/constants/version.ts"), "utf8").match(
  /MARS_VERSION\s*=\s*"([^"]+)"/,
)?.[1]
if (!version) {
  console.error("No pude leer MARS_VERSION de src/constants/version.ts")
  process.exit(2)
}

// --- Utilidades -------------------------------------------------------------

const correr = (cmd, args, opciones = {}) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`)
  execFileSync(cmd, args, { stdio: "inherit", cwd: raiz, shell: SO === "windows", ...opciones })
}

/**
 * Comprime `archivos` (rutas absolutas) en un paquete plano.
 *
 * Se usa la herramienta del sistema en vez de una librería de npm: tanto
 * `Compress-Archive` como `tar` están en las tres plataformas y en los
 * runners de CI, y el empaquetador no necesita un node_modules propio.
 */
function empaquetar(nombre, archivos) {
  const destino = join(salida, nombre)
  rmSync(destino, { force: true })

  if (SO === "windows") {
    const lista = archivos.map((a) => `'${a.replace(/'/g, "''")}'`).join(",")
    correr("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${lista} -DestinationPath '${destino.replace(/'/g, "''")}' -Force`,
    ])
  } else {
    // -C por archivo para que el tar quede plano aunque los binarios vengan de
    // carpetas distintas (target/release de dos crates diferentes).
    const partes = archivos.flatMap((a) => ["-C", dirname(a), a.slice(dirname(a).length + 1)])
    correr("tar", ["-czf", destino, ...partes])
  }
  const bytes = readFileSync(destino).length
  console.log(`  → ${nombre} (${(bytes / 1048576).toFixed(1)} MB)`)
}

// --- Construcción -----------------------------------------------------------

console.log(`\nMARS ${version} — empaquetando para ${SO} ${ARCH}\n${"=".repeat(46)}`)
correr("node", ["scripts/sync-version.mjs"])

rmSync(salida, { recursive: true, force: true })
mkdirSync(salida, { recursive: true })

// El icono viaja con el paquete: en Linux el `.desktop` que crea el instalador
// lo referencia por ruta, y sin él el lanzador sale con el icono genérico.
const icono = join(salida, "icon.png")
cpSync(join(raiz, "src-tauri/icons/128x128@2x.png"), icono)

const ediciones = soloEdicion ? [soloEdicion] : ["full", "tools"]
for (const edicion of ediciones) {
  if (edicion !== "full" && edicion !== "tools") {
    console.error(`Edición desconocida: ${edicion}`)
    process.exit(2)
  }
  console.log(`\n--- mars-desktop (${edicion}) ---`)

  // El front primero: el binario lo empotra al compilar.
  correr("npm", ["run", "build"], { env: { ...process.env, MARS_EDITION: edicion } })

  // `custom-protocol` va explicita y no como feature `default` porque la
  // edicion Tools se construye con --no-default-features, que se la llevaria
  // puesta: el binario abriria el devUrl y mostraria el error de conexion del
  // webview en vez de la app. Ver la nota en src-tauri/Cargo.toml.
  const cargo = [
    "build", "--release",
    "--manifest-path", "src-tauri/Cargo.toml",
    "--features", "custom-protocol",
  ]
  if (edicion === "tools") cargo.push("--no-default-features")
  correr("cargo", cargo)

  const binario = join(raiz, "src-tauri/target/release", `mars-desktop${EXE}`)
  if (!existsSync(binario)) {
    console.error(`cargo no dejó ${binario}`)
    process.exit(1)
  }
  empaquetar(`mars-desktop-${edicion}-${SO}-${ARCH}.${EXT}`, [binario, icono])
}

if (HAY_STUDIO && !sinStudio) {
  console.log("\n--- MARS Simulation Studio ---")
  correr("cargo", ["build", "--release", "--manifest-path", "sim/app/Cargo.toml"])
  const binario = join(raiz, "sim/app/target/release", `mars-sim-app${EXE}`)
  if (existsSync(binario)) {
    empaquetar(`mars-simulation-studio-${SO}-${ARCH}.${EXT}`, [binario, icono])
  } else {
    // No es fatal: el instalador sabe seguir sin un componente que la release
    // no publique, y lo dice en pantalla.
    console.warn(`AVISO: no se construyó el Studio (${binario} no existe); la release sale sin él.`)
  }
}

// --- El instalador ----------------------------------------------------------
//
// Va suelto, sin comprimir: es lo que la gente descarga y ejecuta. Un zip de
// un solo .exe solo agrega un paso.
console.log("\n--- MARS Installer ---")
correr("cargo", ["build", "--release", "--manifest-path", "installer/Cargo.toml"])
const instalador = join(raiz, "installer/target/release", `mars-installer${EXE}`)
if (existsSync(instalador)) {
  const nombre =
    SO === "windows" ? "MARS-Installer.exe" : `MARS-Installer-${SO}-${ARCH}`
  cpSync(instalador, join(salida, nombre))
  console.log(`  → ${nombre}`)
}

rmSync(icono, { force: true })

writeFileSync(
  join(salida, "VERSION"),
  `${version}\n`,
)
console.log(`\nListo. Paquetes en ${salida}`)
