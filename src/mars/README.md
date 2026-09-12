# El bloque MARS

MARS Desktop se compila en dos ediciones:

| Edición | Qué trae | Para quién |
|---|---|---|
| **Full** | Todo: NetworkTables + el framework MARS (proyectos, paquetes, manifiesto, wizard, features, estado de subsistemas, watchdog) + lanzador de MARS Simulation Studio | Equipos que usan MARS |
| **Tools** | Solo el dashboard: NetworkTables, visualizadores 2D/3D, swerve, mechanism, telemetría, gráficas, ecuaciones, SysId, loop timing, bandwidth, consola, preferences, logs `.wpilog` | Equipos que quieren la herramienta sin adoptar el framework |

## Cómo se quita MARS de verdad

No es un `if` en runtime. Tools **no compila** el código de MARS:

- **Front**: todo lo que depende del framework se importa desde un único
  módulo, `@mars`. El alias de `vite.config.ts` lo resuelve a
  `src/mars/index.tsx` (Full) o `src/mars/index.tools.tsx` (Tools). El stub no
  importa ninguna página, así que esas páginas se quedan sin importadores y
  rollup no las mete en el bundle.
- **Rust**: los módulos `feature_gen`, `subsystem_gen`, `source_map`,
  `simlauncher` y los comandos de proyecto van detrás de la feature `mars` de
  Cargo (activada por defecto). Tools se construye con `--no-default-features`
  y esos `#[tauri::command]` ni existen en el binario.

Comprobarlo:

```bash
MARS_EDITION=tools npm run build
grep -rl "MarsFeature" dist/assets   # no debe devolver nada
```

## Agregar una función que dependa de MARS

1. La página va en `src/pages/`, como cualquier otra.
2. Se importa y se enruta **solo** en `src/mars/index.tsx`.
3. Su entrada de navegación se agrega a `PROJECT_ITEMS`, `MODULE_ITEMS` o
   `CONFIG_ITEMS` del mismo archivo; el sidebar, el menú y la pantalla de
   inicio las leen de ahí y no tienen listas propias.
4. Si necesita Rust, el módulo va bajo `#[cfg(feature = "mars")]`.

Si la función solo usa NetworkTables, **no va acá**: va directo en `App.tsx`,
que es lo que comparten las dos ediciones.

El contrato entre las dos implementaciones está en `types.ts`
(`MarsSurface`), y cada archivo se asigna a sí mismo a ese tipo: si una
edición se desvía, falla `tsc`, no la app abierta.
