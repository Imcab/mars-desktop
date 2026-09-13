# MARS (the library)

The FRC Java library: what a robot project actually imports. Everything else in
this repository is a tool that sits around it — the dashboard talks to a robot
running this, and the Simulation Studio simulates one.

It is a Gradle project with its own version, its own release cycle and its own
consumers, and it is the only part of this repository whose output is consumed
by people who will never clone it.

## Where it is published

One GitHub Pages site, built by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

| URL | What |
|---|---|
| `https://imcab.github.io/Mars-frc/Mars.json` | **The vendordep.** `jsonUrl` points here; this is what WPILib re-reads on "Check for updates". |
| `https://imcab.github.io/Mars-frc/maven/` | **The maven repository.** Gradle resolves `com.stzteam.mars:Mars` out of here. |
| `https://imcab.github.io/Mars-frc/api/` | The Javadoc. |
| `https://imcab.github.io/Mars-frc/` | The documentation (MkDocs, from `docs/`). |

The first two are written into the `vendordeps/Mars.json` of every robot project
that has MARS installed. They are not ours to move once published: a team that
installed MARS last season has those strings on disk, and nothing we do here
changes their copy. Treat both as permanent.

## The `maven/` folder is committed on purpose

`build.gradle` publishes into `lib/maven/` (`LocalRepo`), and that folder is in
git. The site does not build the jars — it copies them. So a release is a
commit, which means it is reviewable, revertible, and the bytes a team downloads
are the bytes that were in the tree.

## Cutting a release

The version lives in **one place**: `Mars.json`. `build.gradle` reads it with
`JsonSlurper` and takes both the project version and the generated
`MarsConstants.MARS_VERSION` from it, so there is nothing else to bump.

```bash
cd lib
$EDITOR Mars.json                  # "version" and javaDependencies[Mars].version
./gradlew publish                  # writes lib/maven/.../<version>/
node ../scripts/check-vendordep.mjs  # says no if those two disagree
git add Mars.json maven/
```

Push to `main` and the `pages` workflow deploys. The same check runs there
before anything is uploaded, because a `Mars.json` that promises a version with
no jar behind it does not fail here — it fails on a team's laptop, as
`could not resolve com.stzteam.mars:Mars`, possibly at a competition.

### The uuid is frozen

```
8b9c1d2e-3f4a-5b6c-7d8e-9f0a1b2c3d4e
```

WPILib identifies an installed vendordep by uuid, not by name. Change it and the
extension does not replace MARS — it installs a **second** copy alongside the
old one, and the project ends up with two versions of the same classes on the
classpath. `check-vendordep.mjs` fails if it ever moves.

### ForgeMini is somewhere else

`com.stzteam.forgemini:ForgeMini` is a declared dependency served from
`https://Imcab.github.io/FORGEmini/maven/`, its own repository. It has the same
one-way-door property as the URLs above. Nothing here can verify it; the check
script prints it as a note so it is at least visible.

## Retiring STZ-Robotics/Mars

This library used to live at `STZ-Robotics/Mars`, whose GitHub Pages served
**both** the vendordep and the maven repository — the Javadoc at the root,
`Mars.json` next to it, `maven/` underneath. Development has moved here. The old
repository has not finished its job, and the order of what remains matters.

**1. Deploy this site first.** Both new URLs have to answer before anything
points at them.

**2. Cut a bridge release.** It has to carry a version number **higher than
1.6.6**. WPILib's "Check for updates" compares versions: an identical one is
reported as already up to date and nobody migrates, no matter what else changed
in the file. Publish it from here, so the new maven serves it.

**3. One last commit in the old repository**, replacing its `Mars.json` with:

```json
{
  "fileName": "Mars.json",
  "name": "Mars",
  "version": "<the bridge version>",
  "frcYear": "2026",
  "uuid": "8b9c1d2e-3f4a-5b6c-7d8e-9f0a1b2c3d4e",
  "mavenUrls": [
    "https://imcab.github.io/Mars-frc/maven/",
    "https://Imcab.github.io/FORGEmini/maven/"
  ],
  "jsonUrl": "https://imcab.github.io/Mars-frc/Mars.json",
  "javaDependencies": [
    { "groupId": "com.stzteam.mars", "artifactId": "Mars", "version": "<the bridge version>" },
    { "groupId": "com.stzteam.forgemini", "artifactId": "ForgeMini", "version": "1.1.2" }
  ],
  "cppDependencies": [],
  "jniDependencies": []
}
```

Same uuid, new `jsonUrl`, new maven. This file is the **only** channel that
exists for telling an already-installed project that the library moved: a team
updates once against the old URL and lands here permanently. Let its own
`publish.yml` deploy it one final time.

**4. Then archive it — do not delete it.** An archived repository keeps serving
Pages read-only, so its frozen `maven/` (1.6.0 … 1.6.6) keeps resolving for
every project that never updates. Deleting it takes the maven down with it, and
frees the name `STZ-Robotics/Mars`: whoever claims it next inherits a Pages URL
that other people's builds still fetch from. Archiving also stops its Actions,
which is why step 3 comes first.
