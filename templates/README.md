# Templates

The two scaffolds MARS Desktop writes when a team creates something.

| Folder | What it becomes | Who writes it |
|---|---|---|
| [`project/`](project/) | A WPILib robot project with MARS already wired in | `create_mars_project` (`desktop/src-tauri/src/main.rs`) |
| [`feature/`](feature/) | A MARS Feature repository, ready to publish its own maven | The Feature Wizard (`desktop/src-tauri/src/feature_gen.rs`) |

## They travel inside the binary

Both used to be `git clone`d from GitHub on every run, with the `.git` deleted
immediately afterwards — so the clone was never about history, only about
getting the files. They are embedded now (`desktop/src-tauri/build.rs` enumerates
them, `templates.rs` extracts them), which buys three things:

- **Creating a project works offline**, and without `git` installed. That is the
  first thing a new team does, and it used to fail on a bad connection — which,
  at a competition, is most of them.
- **The template and the code that rewrites it ship together.** This is the one
  that matters. `feature_gen` patches `MarsFeature.json`, `build.gradle`,
  `settings.gradle` and the java package tree by exact expectations about what
  is in the template. While the template lived in its own repository, renaming a
  package there would have left every *already installed* wizard generating a
  project that does not compile, with nothing to warn anyone. Now the two cannot
  disagree.
- **The vendordep inside `project/` can be checked.** It is `lib/Mars.json`
  verbatim, and `scripts/check-vendordep.mjs` fails if it falls behind a
  release. Across repositories that check was not possible, and the template had
  drifted a version behind, pointing at the site being retired.

The cost is about 220 KB of binary and the fact that a template can no longer be
fixed without shipping a release. Given the second bullet, that was never really
true anyway: a template change that the wizard does not know about is a broken
project either way.

Nothing needs packaging: `scripts/package-release.mjs` ships a bare executable,
and the templates are *in* it.

## The standalone repositories have to stay up

`STZ-Robotics/MarsTemplate` and `STZ-Robotics/MARS-Feature-Template` are where
these came from, and **every copy of MARS Desktop released so far clones them by
URL**. That URL is compiled into those binaries; it does not update when the app
does. Deleting or renaming either repository breaks project creation for every
team that has not updated, and there is no way to reach them.

So: they stay. Archive them when it is clear nothing in the wild still clones
them, and even then archiving keeps them readable — it is deleting that breaks
people. The same reasoning, and the same conclusion, as `STZ-Robotics/Mars` in
[`lib/README.md`](../lib/README.md).

While they are up, they should not drift from what is here. They are also what
GitHub's "Use this template" button offers, which is a perfectly good way to
start a project without the dashboard.

## Editing one

Change the files here and run the tests:

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml templates
```

They check that the hidden files survived the walk — `.wpilib/` is what makes
the folder a robot project to the WPILib extension, and it is exactly the kind
of thing a directory walk drops without saying anything — that the files the
wizard rewrites are still where it expects them, and that `gradlew` still starts
with `#!`, which is how the extractor knows to give it back its executable bit.
