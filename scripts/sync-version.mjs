#!/usr/bin/env node
// Keeps a single MARS Desktop version across the four files that write it.
//
// `src/constants/version.ts` is in charge: it is the one the user sees on the
// splash screen. The other three are read by the installer and the packager, so
// one that has drifted publishes a release that claims one version and shows
// another — a bug you only notice once it is already uploaded.
//
//   node scripts/sync-version.mjs          check (exits 1 if they disagree)
//   node scripts/sync-version.mjs --write  copy version.ts's into the others

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const write = process.argv.includes("--write")

const read = (rel) => readFileSync(join(root, rel), "utf8")
const save = (rel, text) => writeFileSync(join(root, rel), text)

const source = read("src/constants/version.ts").match(/MARS_VERSION\s*=\s*"([^"]+)"/)
if (!source) {
  console.error("Could not read MARS_VERSION from src/constants/version.ts")
  process.exit(2)
}
const version = source[1]

// Each target knows how to find and replace ITS version, and only its own: a
// Cargo.toml's `version` also shows up under every dependency.
const targets = [
  {
    file: "package.json",
    find: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/tauri.conf.json",
    find: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/Cargo.toml",
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

if (problems > 0) {
  console.error(`\n${problems} file(s) out of sync. Fix them with: node scripts/sync-version.mjs --write`)
  process.exit(1)
}
console.log(`\nMARS Desktop ${version}`)
