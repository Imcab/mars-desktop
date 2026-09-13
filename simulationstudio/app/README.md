# MARS Simulation Studio

La aplicación de simulación. Es un producto **aparte** de mars-desktop.

```
cargo build          # o ..\verify.ps1, que la compila y la prueba
cargo run
```

## Por qué es una app aparte

mars-desktop lleva un solo botón —  *Simulation Studio*, en el grupo Connection
del Sidebar — y ese botón lanza este ejecutable. Nada de Gazebo entra en el
dashboard.

La razón es de riesgo, no de gusto. La simulación arrastra el entorno conda
entero: Gazebo, sus plugins y sus dependencias. Ese peso no tiene por qué
viajar en el bundle de la app que el equipo usa **en competencia**, y la
simulación puede colgarse, actualizarse o reinstalarse sin tocarla.

El proceso se lanza y se suelta. Cerrar mars-desktop no cierra la simulación:
son dos ciclos de vida distintos y eso es deliberado.

## Qué hace

Dos cosas, y están en dos módulos distintos porque son dos riesgos distintos.

**Correr la simulación** (`src/supervisor.rs`). Supervisa los tres procesos: el
motor (`mars-sim-server`), la ventana del mundo (`mars-sim-gui`) y el bridge
(`mars-bridge`). Ninguno se puede lanzar "a secas" —  necesitan el entorno conda
en el PATH para sus DLLs, las rutas de los plugins de gz-sim y gz-gui, la de los
RenderSystem de OGRE, y el directorio de trabajo correcto para que las rutas de
los mundos resuelvan.

**Escribir lo que la simulación come** (`src/estudio.rs`). Los mundos, los props
que hay en ellos, y la lectura de los robot-map. Un fallo escribiendo un SDF no
tiene por qué poder tocar el código que mata procesos, así que no comparten
módulo.

## Qué NO hace

**No dibuja el robot.** Eso lo hace la ventana de Gazebo, que muestra la física,
y mars-desktop, que recibe las poses por NT4 igual que de un robot real.
Duplicar el visor aquí sería mantener dos.

## Mundos gestionados y mundos externos

Un mundo creado desde el Studio se guarda **dos veces**: el `.sdf` que come
Gazebo y un `.studio.json` al lado con las propiedades que lo generaron. Ese
JSON es lo que permite reabrir el árbol de propiedades y reescribir el SDF sin
perder nada.

Un `.sdf` sin su JSON es un mundo **externo**: se corre, se lee y se edita como
XML, pero el árbol de propiedades no lo toca. Regenerar un SDF escrito a mano a
partir de lo poco que un regex puede sacar de él destruiría trabajo ajeno en
silencio, que es peor que no ofrecer el botón.

El `<world name>` que genera siempre es `mars`. No es un valor por defecto: es
contrato. Los tópicos estándar de gz-sim lo llevan embebido
(`/world/mars/clock`) y `sim/protocol/check.py` rechaza cualquier SDF de
`worlds/` que declare otro.

## La cancha FRC

`sim/fields/<nombre>/` guarda una cancha en formato de AdvantageScope
(`config.json` + `model.glb`), el mismo que consume el Field 3D de
mars-desktop. La pagina **Field Library** encuentra sola las que el dashboard
tenga instaladas en `%APPDATA%/MARS/assets3d/` y las copia al proyecto.

Entra al mundo como **visual y nada mas**. La cancha 2026 son ~2.9 M
triangulos: como colision pondria al solver a resolver contacto malla-malla y
el real-time factor se hundiria. La fisica la siguen dando el plano del suelo y
los muros, asi que el robot atraviesa los elementos de campo --- son decorado.

Instalar tambien **prepara la malla**: los modelos oficiales declaran casi
todos sus materiales como metalicos, y un metal bajo un renderizador PBR sin
mapa de entorno refleja negro. La cancha cargaba, la fisica iba, y en pantalla
habia una mancha negra con forma de cancha. `aplanar_metales` pone el factor
metalico a cero, que es el mismo arreglo que hace AdvantageScope forzando
`MeshPhongMaterial`.

> El parche es **a nivel de bytes, conservando la longitud**. Reserializar el
> JSON del glTF deja un archivo valido que **cuelga la ventana de Gazebo**
> (probado: mas de ocho minutos sin abrir contra los treinta segundos del
> original). Sustituir el numero por otro de la misma longitud no mueve un solo
> offset del archivo.

**El origen es el CENTRO.** El robot arranca en `0,0` de Gazebo, que es el
centro de la cancha; el origen de esquina que usa WPILib lo produce el bridge
sumando media cancha (`../bridge/src/field.rs`). Por eso la malla va en
`0 0 0` y no desplazada: moverla para que su esquina caiga en el origen
descuadraria media cancha todas las poses, sin ningun error.

## La interfaz

Sigue sin bundler y sin framework: `ui/` son módulos ES que el navegador resuelve
solo, así que `cargo build` es todo el build que hay. Lo que sí hay ahora es
estructura —  `css/tokens.css` es copia literal de la paleta de mars-desktop, y
`js/ui.js` reimplementa como funciones los mismos componentes (Panel,
PropertyRow, AlertBanner, StatusBadge) que allá son React. Los dos productos
tienen que verse como el mismo programa.

Cada control que necesita explicación lleva un `?` al lado; los textos viven en
`js/help.js` y se leen enteros en la página **Help Topics**.

> **La UI se empotra en el binario.** `tauri-build` solo vigila
> `tauri.conf.json`, así que sin el `rerun-if-changed` que emite nuestro
> `build.rs` sobre `ui/`, editar un `.js` y recompilar no recompila nada: cargo
> dice "Finished", la app abre con la versión anterior y el cambio no aparece,
> sin ningún error.

### Matar de verdad

En Windows **matar al padre no mata a los hijos**. Si esta app se cierra sin
pasar por `detener`, quedan un motor y un bridge vivos ocupando los tópicos de
gz-transport, y el siguiente arranque descubre dos motores publicando en
`/mars/state/pose`: las poses se pisan sin ningún error.

Por eso se mata en tres sitios —  en `detener`, en `Drop`, y en el evento de
cierre de ventana. Los tres hacen falta y ninguno cubre a los otros.

**Límite conocido:** si la app muere de golpe (matada desde el administrador de
tareas, o un crash del proceso), ninguno de los tres corre y los huérfanos
quedan. La salida robusta sería un Job Object de Windows; no está.

### Detección de caídas

`estado()` llama a `try_wait` en cada hijo. Sin eso la UI diría "Running" para
siempre después de un crash, que es la peor forma de fallar: silenciosa. Cuando
uno de los dos se muere, se para el otro —  no tiene con quién hablar.

## Modo headless

```
mars-sim-app --headless [segundos]
```

Arranca, espera y para, con código de salida. Existe para que el supervisor sea
verificable en CI, donde no hay pantalla. Es el paso 8 de `simulationstudio/verify.ps1`.

Comprueba además que después de `detener` no quede ningún proceso vivo, que es
lo que distingue "pedimos que pararan" de "pararon".

## Dónde busca las cosas

| Qué | Orden de búsqueda |
|---|---|
| `sim/` | `MARS_SIM_DIR`, luego subiendo desde el ejecutable y desde el directorio actual |
| entorno conda | `MARS_CONDA_ENV`, `CONDA_PREFIX`, luego `~/miniforge3/envs/mars-sim` y equivalentes |

El ejecutable se consulta antes que el directorio actual porque es lo único
fiable cuando la app la lanza otro proceso —  que es justo lo que hace el botón
de mars-desktop.

La página **Diagnostics** comprueba todo esto una cosa a la vez y dice cómo
arreglar lo que falte: casi todos los fallos de esta app son de instalación y
ninguno se explica solo.

## Estado local

`sim/build/studio-prefs.json` guarda lo que la UI recuerda entre sesiones —
última página, mundo y robot elegidos, host NT4, mundos recientes y si el portal
de bienvenida se abre al arrancar. Va en `build/` porque es local, no algo que
vaya al repositorio.
