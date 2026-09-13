# MARS for VS Code

A scaffold, and for now nothing more: `yo code` output with the identity filled
in. It contributes one `Hello World` command and does not do anything useful
yet.

It lives here rather than in its own repository for the same reason everything
else does — it will talk to things this repository defines (the vendordep in
[`lib/`](../lib), the project layout in [`templates/project/`](../templates),
the MARS manifest a robot project carries), and a version of it that disagrees
with those is a version that breaks somebody's project. In here, a change to
both is one commit.

## Getting started

`node_modules` was not installed by the generator, so:

```bash
cd extension
npm install
```

Then press **F5** in VS Code to launch an Extension Development Host with this
extension loaded, and run `Hello World` from the command palette. The details
the generator wrote are in [`vsc-extension-quickstart.md`](vsc-extension-quickstart.md).

```bash
npm run watch       # esbuild + tsc, both in watch mode
npm run compile     # type-check, lint and bundle once
npm test            # vscode-test
```

The bundler is esbuild; `dist/extension.js` is what ships, `src/` is what you
edit. Debugging needs the `connor4312.esbuild-problem-matchers` extension, which
`.vscode/extensions.json` already recommends.

## Before it can be published

- `publisher` is missing from `package.json`. It needs the Marketplace
  publisher id, which is an account thing and not a code thing.
- The identity is `mars` / **MARS** / version `0.0.1`. Note that this version is
  the *extension's* and follows nothing else here: the dashboard, the Studio and
  the library each have their own, and `scripts/sync-version.mjs` deliberately
  does not touch this one.
