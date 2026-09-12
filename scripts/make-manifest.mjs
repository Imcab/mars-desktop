#!/usr/bin/env node
// Writes a release's `manifest.json` from the archives that are already
// packaged.
//
//   node scripts/make-manifest.mjs <folder> <version>
//
// It runs AFTER the archives from all three platforms are collected, not during
// each build: that way the manifest describes exactly the bytes that are about
// to be uploaded, including the sha256 the installer verifies. A manifest
// written by hand, or guessed from the configuration, could fail to match what
// was published — and the symptom would be a verification failing on the user's
// machine with nothing actually wrong.

import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [folder, version] = process.argv.slice(2)
if (!folder || !version) {
  console.error("usage: node scripts/make-manifest.mjs <folder> <version>")
  process.exit(2)
}

// The names follow the convention in installer/src/platform.rs.
const PATTERN =
  /^(mars-desktop)-(full|tools)-(windows|linux|macos)-(x86_64|aarch64)\.(zip|tar\.gz)$|^(mars-simulation-studio)-(windows|linux|macos)-(x86_64|aarch64)\.(zip|tar\.gz)$/

const artifacts = []
for (const name of readdirSync(folder).sort()) {
  const m = PATTERN.exec(name)
  if (!m) continue

  const path = join(folder, name)
  const bytes = readFileSync(path)
  artifacts.push({
    component: m[1] ?? m[6],
    // The Studio has no editions: it serves both.
    edition: m[2] ?? "any",
    os: m[3] ?? m[7],
    arch: m[4] ?? m[8],
    file: name,
    size: statSync(path).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
}

if (artifacts.length === 0) {
  console.error(`No archive matching the expected format was found in ${folder}`)
  process.exit(1)
}

// If a platform shows up at all, it has to show up WHOLE. A pass that steps on
// itself leaves half a platform out and the workflow still finishes green: that
// happened with macOS, which published only x86_64 because the second pass was
// deleting what the first one had left. A half-written manifest is worse than
// none, because the installer believes it.
const byPlatform = new Map()
for (const a of artifacts) {
  if (a.component !== "mars-desktop") continue
  const key = `${a.os}-${a.arch}`
  if (!byPlatform.has(key)) byPlatform.set(key, new Set())
  byPlatform.get(key).add(a.edition)
}
const incomplete = [...byPlatform]
  .filter(([, editions]) => !(editions.has("full") && editions.has("tools")))
  .map(([key, editions]) => `${key} (only ${[...editions].join(", ")})`)

if (incomplete.length > 0) {
  console.error(
    `These platforms are only half there: ${incomplete.join("; ")}.\n` +
      "Each one has to carry both editions of mars-desktop.",
  )
  process.exit(1)
}

const manifest = {
  schema: 1,
  version,
  generated: new Date().toISOString(),
  artifacts,
}

const dest = join(folder, "manifest.json")
writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n")

console.log(`manifest.json — ${artifacts.length} archives`)
for (const a of artifacts) {
  console.log(`  ${a.file}  ${(a.size / 1048576).toFixed(1)} MB  ${a.sha256.slice(0, 12)}…`)
}
