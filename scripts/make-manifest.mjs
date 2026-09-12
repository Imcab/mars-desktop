#!/usr/bin/env node
// Escribe el `manifest.json` de una release a partir de los archivos que ya
// están empaquetados.
//
//   node scripts/make-manifest.mjs <carpeta> <version>
//
// Se genera DESPUÉS de juntar los paquetes de las tres plataformas, no durante
// cada build: así el manifiesto describe exactamente los bytes que se van a
// subir, incluido el sha256 que el instalador verifica. Un manifiesto escrito
// a mano o adivinado a partir de la configuración podría no corresponderse con
// lo publicado, y el síntoma sería una verificación que falla en la máquina
// del usuario sin que nada esté realmente mal.

import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [carpeta, version] = process.argv.slice(2)
if (!carpeta || !version) {
  console.error("uso: node scripts/make-manifest.mjs <carpeta> <version>")
  process.exit(2)
}

// Los nombres siguen la convención de installer/src/plataforma.rs.
const PATRON = /^(mars-desktop)-(full|tools)-(windows|linux|macos)-(x86_64|aarch64)\.(zip|tar\.gz)$|^(mars-simulation-studio)-(windows|linux|macos)-(x86_64|aarch64)\.(zip|tar\.gz)$/

const artifacts = []
for (const nombre of readdirSync(carpeta).sort()) {
  const m = PATRON.exec(nombre)
  if (!m) continue

  const ruta = join(carpeta, nombre)
  const bytes = readFileSync(ruta)
  artifacts.push({
    component: m[1] ?? m[6],
    // El Studio no tiene ediciones: sirve para las dos.
    edition: m[2] ?? "any",
    os: m[3] ?? m[7],
    arch: m[4] ?? m[8],
    file: nombre,
    size: statSync(ruta).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
}

if (artifacts.length === 0) {
  console.error(`No encontré ningún paquete con el formato esperado en ${carpeta}`)
  process.exit(1)
}

// Si una plataforma aparece, tiene que aparecer ENTERA. Un pase que se pisa a
// si mismo deja media plataforma afuera y el workflow igual termina en verde:
// paso con macOS, que publico solo x86_64 porque el segundo pase borraba lo
// que habia dejado el primero. Un manifiesto a medias es peor que ninguno,
// porque el instalador lo cree.
const porPlataforma = new Map()
for (const a of artifacts) {
  if (a.component !== "mars-desktop") continue
  const clave = `${a.os}-${a.arch}`
  if (!porPlataforma.has(clave)) porPlataforma.set(clave, new Set())
  porPlataforma.get(clave).add(a.edition)
}
const incompletas = [...porPlataforma]
  .filter(([, ediciones]) => !(ediciones.has("full") && ediciones.has("tools")))
  .map(([clave, ediciones]) => `${clave} (solo ${[...ediciones].join(", ")})`)

if (incompletas.length > 0) {
  console.error(
    `Estas plataformas estan a medias: ${incompletas.join("; ")}.\n` +
      "Cada una tiene que traer las dos ediciones de mars-desktop.",
  )
  process.exit(1)
}

const manifiesto = {
  schema: 1,
  version,
  generated: new Date().toISOString(),
  artifacts,
}

const destino = join(carpeta, "manifest.json")
writeFileSync(destino, JSON.stringify(manifiesto, null, 2) + "\n")

console.log(`manifest.json — ${artifacts.length} paquetes`)
for (const a of artifacts) {
  console.log(`  ${a.file}  ${(a.size / 1048576).toFixed(1)} MB  ${a.sha256.slice(0, 12)}…`)
}
