#!/usr/bin/env node
// Mantiene una sola versión de MARS Desktop en los cuatro archivos que la
// escriben.
//
// `src/constants/version.ts` manda: es la que ve el usuario en el splash. Los
// otros tres los lee el instalador y el empaquetador, así que una desalineada
// publica una release que dice una versión y muestra otra — un bug que solo se
// nota cuando ya está subida.
//
//   node scripts/sync-version.mjs          verifica (sale 1 si no coinciden)
//   node scripts/sync-version.mjs --write  copia la de version.ts a los demás

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const escribir = process.argv.includes("--write")

const leer = (rel) => readFileSync(join(raiz, rel), "utf8")
const guardar = (rel, texto) => writeFileSync(join(raiz, rel), texto)

const fuente = leer("src/constants/version.ts").match(/MARS_VERSION\s*=\s*"([^"]+)"/)
if (!fuente) {
  console.error("No pude leer MARS_VERSION de src/constants/version.ts")
  process.exit(2)
}
const version = fuente[1]

// Cada destino sabe encontrar y reemplazar SU versión, y solo la suya: el
// `version` de un Cargo.toml aparece también en cada dependencia.
const destinos = [
  {
    archivo: "package.json",
    buscar: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    archivo: "src-tauri/tauri.conf.json",
    buscar: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    archivo: "src-tauri/Cargo.toml",
    // Solo el de [package], que es el primero del archivo.
    buscar: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  },
]

let problemas = 0
for (const { archivo, buscar } of destinos) {
  const texto = leer(archivo)
  const m = texto.match(buscar)
  if (!m) {
    console.error(`${archivo}: no encontré el campo de versión`)
    problemas++
    continue
  }
  if (m[2] === version) {
    console.log(`  ok   ${archivo} — ${version}`)
    continue
  }
  if (escribir) {
    guardar(archivo, texto.replace(buscar, `$1${version}$3`))
    console.log(`  fix  ${archivo} — ${m[2]} → ${version}`)
  } else {
    console.error(`  MAL  ${archivo} — dice ${m[2]}, version.ts dice ${version}`)
    problemas++
  }
}

if (problemas > 0) {
  console.error(`\n${problemas} archivo(s) desalineado(s). Corregilo con: node scripts/sync-version.mjs --write`)
  process.exit(1)
}
console.log(`\nMARS Desktop ${version}`)
