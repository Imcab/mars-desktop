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
| `https://stz-robotics.github.io/Mars/Mars.json` | **The vendordep.** `jsonUrl` points here; this is what WPILib re-reads on "Check for updates". |
| `https://stz-robotics.github.io/Mars/maven/` | **The maven repository.** Gradle resolves `com.stzteam.mars:Mars` out of here. |
| `https://stz-robotics.github.io/Mars/api/` | The Javadoc. |
| `https://stz-robotics.github.io/Mars/` | The documentation (MkDocs, from `docs/`). |

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

## The repository this used to live in

The library was published from a separate repository that also lived at
`STZ-Robotics/Mars`, whose GitHub Pages served the Javadoc at the root with
`Mars.json` beside it and `maven/` underneath. Development moved here, and for a
while this repository was called `Mars-frc` — which meant the vendordep had to
change URL, and a vendordep that changes URL has to drag every already-installed
robot project along with it.

**Renaming this repository to `Mars` deleted that problem instead of solving
it.** The URL every installed project already has written in its
`vendordeps/Mars.json` —

```
https://stz-robotics.github.io/Mars/Mars.json
https://stz-robotics.github.io/Mars/maven/
```

— is now the URL this repository serves. `lib/maven/` carries every version the
old site carried and one more (1.6.0 … 1.6.7), and the jars are byte-identical:
checked 1.6.0, 1.6.3 and 1.6.6 against the old site before the rename. So a team
that never touches anything keeps resolving, and a team that hits "Check for
updates" is offered 1.6.7 at the same address it always used.

Nothing had to be migrated, and nothing had to be announced.

### What that cost, and what to remember

1.6.7 exists because of the plan that is no longer needed: it is 1.6.6 with no
code change, cut to carry a version number higher than the one installed, since
WPILib's "Check for updates" compares versions and reports an equal one as
already up to date. It is a perfectly ordinary release now.

Two things are worth keeping in mind, because they are the reason this worked:

- **A Pages URL follows the repository name.** Renaming a repository moves its
  site, which is exactly why the rename could reclaim the old address — and
  exactly why renaming this one again would break every installed project at
  once. The name `Mars` is now load-bearing.
- **`Mars-frc` must never be created again.** Binaries already released have
  that slug compiled into them (see `installer/src/manifest.rs`) and reach this
  repository through GitHub's rename redirect. A new repository claiming the
  freed name would intercept them.

`check-vendordep.mjs` derives the expected Pages URL from `GITHUB_REPOSITORY`
and fails when the declared URLs name a different repository than the one
publishing them, so a future rename cannot ship quietly — it stops the deploy.
