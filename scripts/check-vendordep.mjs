#!/usr/bin/env node
// Checks that `lib/Mars.json` describes something that actually exists.
//
//   node scripts/check-vendordep.mjs
//
// A vendordep is a promise made to a file on somebody else's computer. The
// `Mars.json` published at `jsonUrl` is what every team's robot project reads,
// and Gradle resolves the jar out of `mavenUrls` from whatever that file says.
// So the two ways to break a team you will never meet are:
//
//   1. Publish a `Mars.json` whose version has no artifacts in `maven/`. The
//      vendordep installs and the next `./gradlew build` fails to resolve
//      com.stzteam.mars:Mars — on their machine, during a competition.
//   2. Point the URLs somewhere that does not serve them.
//
// Neither shows up in a test: the library compiles perfectly either way. Hence
// this, run before the site that carries both is deployed.
//
// THE UUID IS FROZEN. WPILib identifies an installed vendordep by uuid, not by
// name: with a new one the extension does not replace MARS, it installs a
// SECOND copy next to it, and the project ends up with two versions of the same
// classes on the classpath. It is checked here so that a copy-paste never
// changes it quietly.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Where the site this repository publishes serves the two things a robot
// project asks for. If GitHub Pages ever moves, these move with it -- and the
// old ones have to keep answering, see lib/README.md.
const PAGES = "https://stz-robotics.github.io/Mars-frc"

/**
 * The Pages URL the repository we are running in would actually serve.
 *
 * This exists because the constant above once named a different repository than
 * the one publishing it, and nothing noticed: the file agreed with the constant,
 * the constant agreed with itself, and the site went live serving a vendordep
 * whose jsonUrl and mavenUrls were both 404. Internal consistency is not the
 * property that matters -- agreeing with WHERE THIS IS is.
 *
 * It only speaks up in Actions, where GITHUB_REPOSITORY says who we are. A
 * custom domain would legitimately break the derivation; the message says so
 * rather than pretending the repository is wrong.
 */
function pagesUrlOfThisRepo() {
  const slug = process.env.GITHUB_REPOSITORY
  if (!slug || !slug.includes("/")) return null
  const [owner, repo] = slug.split("/")
  // Project pages live under the owner's lowercased github.io host; the
  // repository segment keeps its case, and it IS case-sensitive.
  return `https://${owner.toLowerCase()}.github.io/${repo}`
}
const UUID = "8b9c1d2e-3f4a-5b6c-7d8e-9f0a1b2c3d4e"
const GROUP = "com.stzteam.mars"
const ARTIFACT = "Mars"

const problems = []
const fail = (msg) => problems.push(msg)
const ok = (msg) => console.log(`  ok    ${msg}`)

const dep = JSON.parse(readFileSync(join(root, "lib/Mars.json"), "utf8"))

// --- Identity ---------------------------------------------------------------

if (dep.uuid !== UUID) {
  fail(`the uuid changed: ${dep.uuid}\n        it must stay ${UUID} or every team gets a duplicate MARS`)
} else {
  ok(`uuid — ${dep.uuid}`)
}

if (dep.fileName !== "Mars.json") {
  fail(`fileName says ${dep.fileName}; the extension writes the file under that name`)
}

// --- The version has to exist as bytes --------------------------------------

const version = dep.version
const versionDir = join(root, "lib/maven", ...GROUP.split("."), ARTIFACT, version)

if (!existsSync(versionDir)) {
  fail(
    `Mars.json says ${version}, but lib/maven has no ${version}/ folder.\n` +
      `        Publish it first:  cd lib && ./gradlew publish`,
  )
} else {
  const needed = [`${ARTIFACT}-${version}.jar`, `${ARTIFACT}-${version}.pom`]
  const missing = needed.filter((f) => !existsSync(join(versionDir, f)))
  if (missing.length) {
    fail(`lib/maven/.../${version}/ is missing ${missing.join(", ")}`)
  } else {
    ok(`maven — ${ARTIFACT} ${version} (jar + pom)`)
  }
}

// The metadata is what Gradle reads to know a version exists at all. `publish`
// rewrites it, so a version present on disk and absent from here means the
// folder was copied in by hand.
const metadata = join(root, "lib/maven", ...GROUP.split("."), ARTIFACT, "maven-metadata.xml")
if (!existsSync(metadata)) {
  fail("lib/maven/.../maven-metadata.xml does not exist")
} else {
  const xml = readFileSync(metadata, "utf8")
  if (!xml.includes(`<version>${version}</version>`)) {
    fail(`maven-metadata.xml does not list ${version}; re-run ./gradlew publish`)
  } else if (!xml.includes(`<release>${version}</release>`)) {
    fail(`maven-metadata.xml still calls ${xml.match(/<release>([^<]+)</)?.[1]} the release, not ${version}`)
  } else {
    ok(`maven-metadata.xml — release ${version}`)
  }
}

// --- The dependency block has to agree with the header ----------------------

const mars = dep.javaDependencies?.find((d) => d.groupId === GROUP && d.artifactId === ARTIFACT)
if (!mars) {
  fail(`javaDependencies does not declare ${GROUP}:${ARTIFACT}`)
} else if (mars.version !== version) {
  fail(`javaDependencies asks for ${ARTIFACT} ${mars.version} while the file calls itself ${version}`)
} else {
  ok(`javaDependencies — ${ARTIFACT} ${version}`)
}

// Every other declared dependency has to be served by one of the maven URLs,
// and this cannot verify a URL that is not ours -- so it only says out loud
// what is being trusted to somebody else's site.
for (const d of dep.javaDependencies ?? []) {
  if (d.groupId !== GROUP) {
    console.log(`  note  ${d.groupId}:${d.artifactId} ${d.version} — resolved from another site`)
  }
}

// --- The URLs -----------------------------------------------------------------

if (dep.jsonUrl !== `${PAGES}/Mars.json`) {
  fail(`jsonUrl is ${dep.jsonUrl}\n        expected ${PAGES}/Mars.json`)
} else {
  ok(`jsonUrl — ${dep.jsonUrl}`)
}

if (!dep.mavenUrls?.includes(`${PAGES}/maven/`)) {
  fail(`mavenUrls does not list ${PAGES}/maven/, which is where this repository publishes`)
} else {
  ok(`mavenUrls — ${PAGES}/maven/`)
}

// The check that a rename or a transfer cannot slip past.
const actual = pagesUrlOfThisRepo()
if (actual && actual !== PAGES) {
  fail(
    `these URLs say ${PAGES}, but ${process.env.GITHUB_REPOSITORY} publishes at ${actual}.
` +
      `        Repoint PAGES here, lib/Mars.json and lib/README.md -- or, if this is a
` +
      `        custom domain, say so here.`,
  )
} else if (actual) {
  ok(`the URLs name the repository that serves them — ${process.env.GITHUB_REPOSITORY}`)
}

// --- The copy the project template ships ------------------------------------
//
// `templates/project/` carries a `vendordeps/Mars.json`, because that is what a
// robot project has on disk and the template IS a robot project. It is the file
// every team starts from, so a stale one does not break anything loudly -- it
// just means every project created from today onwards is born pointing at the
// old site and needing the migration everybody else already did.
//
// It has to be the published vendordep verbatim: that is exactly what WPILib
// writes into a project when the dependency is installed by hand.

const TEMPLATE_COPY = "templates/project/vendordeps/Mars.json"
const templatePath = join(root, TEMPLATE_COPY)
if (!existsSync(templatePath)) {
  fail(`${TEMPLATE_COPY} does not exist; the project template has to ship the vendordep`)
} else {
  const published = readFileSync(join(root, "lib/Mars.json"), "utf8")
  const shipped = readFileSync(templatePath, "utf8")
  if (shipped !== published) {
    const theirs = JSON.parse(shipped)
    const detail =
      theirs.version !== version
        ? `it ships ${theirs.version} while lib/Mars.json publishes ${version}`
        : theirs.jsonUrl !== dep.jsonUrl
          ? `it points at ${theirs.jsonUrl}`
          : "it differs from lib/Mars.json"
    fail(`${TEMPLATE_COPY}: ${detail}.
        Fix it with:  cp lib/Mars.json ${TEMPLATE_COPY}`)
  } else {
    ok(`${TEMPLATE_COPY} — the published vendordep, verbatim`)
  }
}

// --- Verdict ------------------------------------------------------------------

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error(`  WRONG ${p}`)
  process.exit(1)
}
console.log(`\nMars ${version} — the vendordep matches what is on disk.`)
