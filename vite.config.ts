import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MARS_VERSION_LABEL } from "./src/constants/version";

// `__dirname` no existe en un config ESM, y este paquete es "type": "module".
const here = path.dirname(fileURLToPath(import.meta.url));

// La pantalla de carga vive en index.html (se pinta antes de que el bundle se
// evalúe), así que no puede importar la constante: se la inyectamos acá, al
// construir. Así la versión sigue teniendo un solo lugar donde se escribe y el
// splash no parpadea con el hueco vacío mientras carga el JS.
const marsVersion = (edition: Edition): Plugin => ({
  name: "mars-version",
  transformIndexHtml: (html) =>
    html
      .split("__MARS_VERSION__")
      .join(edition === "tools" ? `${MARS_VERSION_LABEL} Tools` : MARS_VERSION_LABEL),
});

// --- Ediciones -------------------------------------------------------------
//
// `full`  : la app entera, con el framework MARS (proyectos, paquetes,
//           manifiesto, subsistemas, watchdog) y el lanzador del Simulation
//           Studio.
// `tools`  : solo dashboard sobre NetworkTables. El código de MARS no se
//           esconde, NO SE COMPILA: el alias `@mars` apunta al stub, así que
//           esas páginas no tienen ningún importador y rollup las deja fuera
//           del bundle. El lado de Rust hace lo mismo con la feature `mars`
//           de Cargo (ver src-tauri/Cargo.toml).
//
// Se elige con MARS_EDITION al construir; por defecto, `full`.
type Edition = "full" | "tools";

// @ts-expect-error process is a nodejs global
const rawEdition: string = process.env.MARS_EDITION ?? "full";
if (rawEdition !== "full" && rawEdition !== "tools") {
  throw new Error(`MARS_EDITION inválida: "${rawEdition}". Usá "full" o "tools".`);
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
