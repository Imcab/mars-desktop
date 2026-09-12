# MARS Desktop

Dashboard de NetworkTables para FRC: visualizadores de cancha 2D y 3D, swerve,
mecanismos, gráficas, ecuaciones en vivo, SysId, análisis de loop timing y
ancho de banda, consola de comandos y lectura/escritura de logs `.wpilog`.

Es la herramienta del framework [MARS](https://github.com/STZ-Robotics/Mars),
pero **no hace falta usar MARS para usarla**: se publica en dos ediciones.

## Instalación

Descargá el instalador de la
[última release](https://github.com/Imcab/mars-desktop/releases/latest) y
ejecutalo. Él baja todo lo demás.

| Sistema | Archivo |
|---|---|
| **Windows** (recomendado) | `MARS-Installer.exe` |
| Linux | `MARS-Installer-linux-x86_64` (`chmod +x` primero) |
| macOS | `MARS-Installer-macos-aarch64` o `-x86_64` (`chmod +x` primero) |

El instalador deja elegir la edición, no necesita permisos de administrador y
también desinstala. Los detalles están en
[`installer/README.md`](installer/README.md).

### Las dos ediciones

| | MARS completo | Solo herramientas |
|---|---|---|
| Dashboard, visualizadores, gráficas, SysId, logs | ✅ | ✅ |
| Framework MARS: proyectos, paquetes, manifiesto, wizard, features, subsistemas, watchdog | ✅ | — |
| MARS Simulation Studio | ✅ (no en macOS) | — |

"Solo herramientas" es una compilación distinta, no la misma app con botones
escondidos: el código de MARS no entra ni al bundle del front ni al binario de
Rust. El cómo y el porqué están en [`src/mars/README.md`](src/mars/README.md).

## Desarrollo

```bash
npm install
npm run tauri dev                    # edición completa
MARS_EDITION=tools npm run tauri dev  # edición Tools

npm test                                       # tests del front (vitest)
cargo test --manifest-path src-tauri/Cargo.toml # tests de Rust
npm run build                                  # tsc + vite
```

`MARS_EDITION` elige qué se compila; por defecto, `full`.

## Cómo está armado

| Carpeta | Qué es |
|---|---|
| `src/` | La interfaz (React + TypeScript). `src/mars/` es el bloque que solo existe en la edición completa. |
| `src-tauri/` | El backend: cliente NT4 propio, lectura y escritura de `.wpilog`, assets 3D, generadores de código Java. |
| `installer/` | **MARS Installer**: la app que instala, actualiza y desinstala el ecosistema. |
| `sim/` | **MARS Simulation Studio** y el motor de simulación sobre Gazebo. Es un producto aparte con su propio ciclo de vida. |
| `scripts/` | Empaquetado de releases y sincronización de versiones. |

## Publicar una versión

La versión se escribe en **un solo lugar**, `src/constants/version.ts`; los
otros tres archivos que la llevan (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`) se alinean con:

```bash
node scripts/sync-version.mjs --write
```

Después, una etiqueta `vX.Y.Z` dispara `.github/workflows/release.yml`, que
construye en los cuatro runners (Windows, Linux, macOS arm64 e Intel), escribe
el `manifest.json` con los sha256 reales y publica la release. Cada plataforma
se construye en la suya porque Tauri enlaza contra el webview del sistema: no
hay compilación cruzada posible.
