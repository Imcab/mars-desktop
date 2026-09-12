# MARS Installer

Un ejecutable que instala, actualiza y desinstala el ecosistema MARS. Se baja,
se abre, se elige qué edición se quiere y listo — no hace falta ser
administrador ni tener git, node ni Rust.

```
release/MARS-Installer.exe            Windows  (recomendado)
release/MARS-Installer-linux-x86_64   Linux
release/MARS-Installer-macos-aarch64  macOS Apple Silicon
release/MARS-Installer-macos-x86_64   macOS Intel
```

## Qué instala

| | MARS completo | Solo herramientas |
|---|---|---|
| Dashboard de NetworkTables, campo 2D/3D, swerve, mecanismos, gráficas, ecuaciones, SysId, loop timing, bandwidth, consola, logs `.wpilog` | ✅ | ✅ |
| Framework MARS: proyectos, paquetes, manifiesto, wizard de subsistemas, features, estado de subsistemas, watchdog | ✅ | — |
| MARS Simulation Studio | ✅ (no en macOS) | — |

"Solo herramientas" **no es la misma app con botones escondidos**: es otra
compilación, sin el código de MARS ni en el bundle del front ni en el binario
de Rust. Cómo se hace eso está en [`src/mars/README.md`](../src/mars/README.md).

## Cómo funciona

```
        GitHub Releases                     la máquina del usuario
   ┌──────────────────────────┐        ┌──────────────────────────────┐
   │ manifest.json            │───1───▶│ elegir edición y carpeta     │
   │ mars-desktop-full-…zip   │        │                              │
   │ mars-desktop-tools-…zip  │───2───▶│ descargar + verificar sha256 │
   │ mars-simulation-…zip     │        │ descomprimir                 │
   └──────────────────────────┘        │ accesos directos + registro  │
                                       │ instalacion.json             │
                                       └──────────────────────────────┘
```

1. **Se consulta la última release** por la API de GitHub. Si trae
   `manifest.json` (lo escribe `scripts/make-manifest.mjs`), se usan su tamaño
   y su sha256; si no —una release publicada a mano—, se deducen los archivos
   por su nombre y la pantalla avisa que no se puede verificar nada.
2. **Se baja solo lo que corresponde** a esta plataforma, arquitectura y
   edición. Los nombres siguen una convención estricta:
   `mars-desktop-{full|tools}-{windows|linux|macos}-{x86_64|aarch64}.{zip|tar.gz}`.
3. **Se instala en el usuario**, nunca en Archivos de programa ni en `/opt`:
   así un estudiante lo instala en la computadora del laboratorio sin pedirle
   la contraseña a nadie.

| | Carpeta por defecto |
|---|---|
| Windows | `%LOCALAPPDATA%\Programs\MARS` |
| Linux | `~/.local/share/MARS` |
| macOS | `~/Applications/MARS` |

Cada instalación deja un registro en `<datos de usuario>/instalacion.json` con
**la lista exacta de archivos y accesos directos que creó**. La desinstalación
borra esa lista y nada más: un `remove_dir_all` sobre la carpeta que eligió el
usuario es una línea más corta y una manera excelente de borrarle el escritorio
a alguien que instaló en `C:\`.

## Desinstalar

Tres caminos, todos el mismo código:

- Volver a abrir el instalador → **Desinstalar**.
- En Windows, *Configuración → Aplicaciones instaladas → MARS Desktop*.
- Correr `mars-uninstall` de la carpeta de instalación con `--uninstall`.

Las preferencias, los layouts guardados y los packs de assets 3D **no se
borran** salvo que se marque la casilla: son horas de trabajo del equipo y un
desinstalador no tiene por qué llevárselas.

## Detalles que no se deducen del código

- **WebView2 (Windows).** Una app de Tauri sin el runtime de WebView2 abre una
  ventana en blanco, sin ningún mensaje. Windows 11 lo trae; Windows 10 no
  siempre. El instalador lo comprueba en el registro y, si falta, instala
  primero el bootstrapper oficial de Microsoft.
- **Cuarentena de Gatekeeper (macOS).** macOS marca todo lo que se baja de
  internet, y un binario sin firmar en cuarentena no abre. Como el instalador
  es quien descargó los archivos, les quita la marca él mismo
  (`xattr -dr com.apple.quarantine`). Esto **no reemplaza** firmar y notarizar
  la app; es lo que hace que abra mientras no haya cuenta de desarrollador de
  Apple.
- **El desinstalador no puede borrarse a sí mismo** mientras corre: en Windows
  el archivo está bloqueado por su propio proceso. Deja un `.bat` que espera a
  que el proceso muera, reintenta el borrado y se borra a sí mismo al final.
- **Los paquetes son planos**, con el ejecutable en la raíz. mars-desktop busca
  al Simulation Studio *junto a* su propio ejecutable
  (`src-tauri/src/simlauncher.rs`): una carpeta intermedia rompería ese
  hallazgo sin dar ningún error.
- **Lo que el instalador NO trae**: el entorno de Gazebo que necesita el
  Simulation Studio para simular (conda, ver `sim/environment.yml`). Se instala
  el Studio —su interfaz, su editor de mundos— pero el motor de física es una
  dependencia aparte de varios GB que el propio Studio documenta.

## Desarrollo

```bash
cargo run  --manifest-path installer/Cargo.toml              # abrir
cargo test --manifest-path installer/Cargo.toml              # tests offline
cargo test --manifest-path installer/Cargo.toml -- --ignored # contra la release real
```

Los dos tests `--ignored` son los que valen cuando se toca el formato de
nombres o el manifiesto: bajan de verdad un paquete de la release publicada,
verifican su sha256 y comprueban que el ejecutable quede en la raíz. Ningún
test offline puede cubrir que lo que publica el empaquetador sea lo que busca
el instalador.

Para probar contra otro repositorio:

```bash
MARS_RELEASES_REPO=miusuario/mifork cargo run --manifest-path installer/Cargo.toml
```

La interfaz son módulos ES sueltos en `ui/`, sin bundler, con la paleta de
mars-desktop copiada en `css/tokens.css`. Se empotra en el binario al compilar;
el `build.rs` vigila `ui/` para que editar un `.js` recompile de verdad.

## Publicar una versión

```bash
node scripts/sync-version.mjs --write   # alinear las cuatro versiones
git tag v1.1.4 && git push --tags       # dispara .github/workflows/release.yml
```

El workflow construye en los cuatro runners (Windows, Linux, macOS arm64 y
x86_64), junta los paquetes, escribe el `manifest.json` con los sha256 reales y
publica la release. Hay que hacerlo así y no desde una sola máquina: Tauri
enlaza contra el webview de cada sistema y no se puede compilar cruzado.

Para empaquetar a mano solo la plataforma actual:

```bash
node scripts/package-release.mjs
node scripts/make-manifest.mjs release 1.1.4
```
