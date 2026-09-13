#!/usr/bin/env node
// Keeps a single MARS Desktop version across the four files that write it, and
// the Simulation Studio's own version consistent with itself.
//
// `desktop/src/constants/version.ts` is in charge: it is the one the user sees
// on the splash screen. The other three are read by the installer and the
// packager, so one that has drifted publishes a release that claims one version
// and shows another — a bug you only notice once it is already uploaded.
//
//   node scripts/sync-version.mjs          check (exits 1 if they disagree)
//   node scripts/sync-version.mjs --write  copy version.ts's into the others
//
// The Studio does NOT follow MARS_VERSION: it is a separate product with its
// own life cycle. What is checked is that its THREE files agree with each
// other. The one that matters most is the least obvious: `ui/js/constants.js`
// is what the interface actually prints --- on the welcome portal, on About, in
// the status bar and on the Diagnostics row --- while `Cargo.toml` only travels
// so a bug report can name the binary, and `tauri.conf.json` is what the bundle
// carries. Bumping the crate and forgetting the interface leaves an install
// that updated and still says the old number on screen, which is exactly how
// you end up unable to tell a stale install from a change that did not work.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const write = process.argv.includes("--write")

// Each product is a folder of its own at the root of the repository.
// `installer/` carries a version too, but it answers to neither of these.
const DESKTOP = "desktop"
const STUDIO = "simulationstudio"

const read = (rel) => readFileSync(join(root, rel), "utf8")
const save = (rel, text) => writeFileSync(join(root, rel), text)

const source = read(`${DESKTOP}/src/constants/version.ts`).match(/MARS_VERSION\s*=\s*"([^"]+)"/)
if (!source) {
  console.error(`Could not read MARS_VERSION from ${DESKTOP}/src/constants/version.ts`)
  process.exit(2)
}
const version = source[1]

// Each target knows how to find and replace ITS version, and only its own: a
// Cargo.toml's `version` also shows up under every dependency.
const targets = [
  {
    file: `${DESKTOP}/package.json`,
    find: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: `${DESKTOP}/src-tauri/tauri.conf.json`,
    find: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: `${DESKTOP}/src-tauri/Cargo.toml`,
    // Only the one under [package], which is the first in the file.
    find: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  },
]

let problems = 0
for (const { file, find } of targets) {
  const text = read(file)
  const m = text.match(find)
  if (!m) {
    console.error(`${file}: could not find the version field`)
    problems++
    continue
  }
  if (m[2] === version) {
    console.log(`  ok    ${file} — ${version}`)
    continue
  }
  if (write) {
    save(file, text.replace(find, `$1${version}$3`))
    console.log(`  fixed ${file} — ${m[2]} → ${version}`)
  } else {
    console.error(`  WRONG ${file} — says ${m[2]}, version.ts says ${version}`)
    problems++
  }
}

// --- The Studio, which answers only to itself -------------------------------

// Cargo.toml leads, the way version.ts leads for the dashboard.
const studioTargets = [
  { file: `${STUDIO}/app/Cargo.toml`, find: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/ },
  { file: `${STUDIO}/app/tauri.conf.json`, find: /("version"\s*:\s*")([^"]+)(")/ },
  { file: `${STUDIO}/app/ui/js/constants.js`, find: /(MSS_VERSION\s*=\s*")([^"]+)(")/ },
]

const leader = read(studioTargets[0].file).match(studioTargets[0].find)
if (!leader) {
  console.error(`Could not read the Studio's version from ${STUDIO}/app/Cargo.toml`)
  problems++
}
const studioVersion = leader ? leader[2] : null

for (const { file, find } of studioTargets) {
  if (!studioVersion) break
  const text = read(file)
  const m = text.match(find)
  if (!m) {
    console.error(`${file}: could not find the version field`)
    problems++
  } else if (m[2] === studioVersion) {
    console.log(`  ok    ${file} — ${studioVersion}`)
  } else if (write) {
    save(file, text.replace(find, `$1${studioVersion}$3`))
    console.log(`  fixed ${file} — ${m[2]} → ${studioVersion}`)
  } else {
    console.error(`  WRONG ${file} — says ${m[2]}, ${STUDIO}/app/Cargo.toml says ${studioVersion}`)
    problems++
  }
}

if (problems > 0) {
  console.error(`\n${problems} file(s) out of sync. Fix them with: node scripts/sync-version.mjs --write`)
  process.exit(1)
}
console.log(`\nMARS Desktop ${version}, Simulation Studio ${studioVersion}`)
