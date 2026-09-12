import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARS_VERSION_LABEL } from "./src/constants/version";

// `__dirname` does not exist in an ESM config, and this package is
// "type": "module".
const here = path.dirname(fileURLToPath(import.meta.url));

// The loading screen lives in index.html (it is painted before the bundle is
// even evaluated), so it cannot import the constant: we inject it here, at
// build time. That way the version still has a single place where it is
// written, and the splash does not flash an empty gap while the JS loads.
const marsVersion = (edition: Edition): Plugin => ({
  name: "mars-version",
  transformIndexHtml: (html) =>
    html
      .split("__MARS_VERSION__")
      .join(edition === "tools" ? `${MARS_VERSION_LABEL} Tools` : MARS_VERSION_LABEL),
});

// --- Editions --------------------------------------------------------------
//
// `full`  : the whole app, with the MARS framework (projects, packages,
//           manifest, subsystems, watchdog) and the Simulation Studio
//           launcher.
// `tools` : just the NetworkTables dashboard. The MARS code is not hidden, it
//           IS NOT COMPILED: the `@mars` alias points at the stub, so those
//           pages have no importer at all and rollup leaves them out of the
//           bundle. The Rust side does the same through cargo's `mars` feature
//           (see src-tauri/Cargo.toml).
//
// Chosen with MARS_EDITION at build time; defaults to `full`.
type Edition = "full" | "tools";

// @ts-expect-error process is a nodejs global
const rawEdition: string = process.env.MARS_EDITION ?? "full";
if (rawEdition !== "full" && rawEdition !== "tools") {
  throw new Error(`Invalid MARS_EDITION: "${rawEdition}". Use "full" or "tools".`);
}
const edition = rawEdition as Edition;

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), marsVersion(edition)],

  resolve: {
    alias: {
      "@mars": path.resolve(
        here,
        edition === "tools" ? "src/mars/index.tools.tsx" : "src/mars/index.tsx",
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
