# Bridge de simulación

Traduce entre gz-transport (el motor), HALSim WebSocket (el código del robot) y
NT4 (la app). El contrato está en [`sim/protocol/`](../protocol/README.md).

**Estado:** telemetría y lazo de hardware del perfil `vendor` funcionando y
verificados, incluido el swerve con control de posición en el motor. Falta el
perfil `hal` (HALSim WebSocket) entero.

## Compilar y correr

Necesita el entorno conda `mars-sim` por las librerías de C++:

```
conda activate mars-sim
$env:PKG_CONFIG_PATH = "$env:CONDA_PREFIX\Library\lib\pkgconfig"
cargo build --bins
```

O `..\verify.ps1`, que compila todo y corre las cinco capas de verificación.

```
mars-sim-server worlds/testbot.sdf run
mars-bridge --robot-map models/testbot/robot-map.json
```

## Binarios

| Binario | Para qué |
|---|---|
| `mars-bridge` | El bridge. Telemetría hacia NT4 y, en perfil `vendor`, el lazo de hardware con el código del robot. |
| `drive-test` | Prueba el lazo de actuadores: publica comandos y verifica que el robot avanza. |
| `fake-robot.py` | Hace de código del robot: publica duty, lee el estado y verifica que el círculo cerró. |
| `gz-topics` | Diagnóstico: lista lo que el discovery ve. Para cuando un tópico "no existe" aunque el motor lo publique. |

## Módulos

| | |
|---|---|
| `nt4.rs` | Cliente NT4 mínimo: publicar y suscribirse por prefijo. |
| `field.rs` | Traslación Gazebo (origen al centro) ⇄ WPILib (origen en la esquina azul). |
| `wpistruct.rs` | Serialización de Pose2d/Pose3d y sus schemas. |
| `glue.rs` | El lazo de hardware del perfil `vendor`, sobre NT4. |
| `robotmap.rs` | Lectura del robot-map, la única entrada que cambia por robot. |
| `protocol` | Generado por `build.rs` desde `topics.toml`. |

### Por qué no se reutiliza el cliente NT4 de la app

`desktop/src-tauri/src/nt4/client.rs` es un cliente de CONSUMO con Tauri tejido por todo
su bucle de reconexión: emite cinco eventos al frontend y saca su instancia de
`state::<NT4State>()`. Desacoplarlo sería refactorizar código que funciona, con
riesgo de regresión en la app.

**Esta decisión ya se revisó**, al llegar el perfil `vendor` -- que sí necesita
suscribirse, y era el disparador anotado. Se mantuvo: añadir suscripción por
prefijo a este cliente fueron ~60 líneas, mientras que sacar Tauri del bucle de
reconexión del otro sigue siendo un refactor con riesgo y no deja nada mejor.

## Verificación

`nt-probe.py` levanta un servidor NT4 con **`ntcore` de WPILib**, la
implementación de referencia -- la misma que corre en un roboRIO. Es deliberado:
un test escrito por nosotros podría compartir el mismo malentendido del formato
de cable que el bridge, y ntcore no. Hace de servidor porque en simulación ese
papel lo ocupa el código del robot.

```
pip install pyntcore
python nt-probe.py [segundos] [avance_minimo_m]
```

Con `avance_minimo_m` exige además que la pose SIGA al robot, y hay que
conducirlo en paralelo. Sin eso, una pose estática no distingue "el bridge
funciona" de "el bridge publicó una vez y se quedó pegado".

## Por qué el FFI y no el Rust puro

Se evaluaron los dos crates que hablan gz-transport desde Rust. **Se eligió
`gz-transport` 0.10 (envoltorio FFI del C++)** después de que el camino puro
resultara inviable.

`gz-transport-rs` 0.1.0 es una reimplementación pura del protocolo, atractiva
porque evita enlazar contra C++. Leer funciona perfectamente. **Publicar no**:
anuncia su dirección de *bind* en vez de una de destino.

```
C++  /mars/state/pose      ->  tcp://10.48.71.132:57408
Rust /mars/cmd/actuators   ->  tcp://0.0.0.0:57416     <-- no es conectable
```

`0.0.0.0` significa "cualquier interfaz" para quien hace bind, pero no es un
destino válido: el suscriptor de C++ intenta conectarse y falla sin emitir
ningún error. El motor nunca recibe comandos aunque `gz-topics` muestre el
tópico anunciado con el tipo correcto.

El bug está en `src/transport/publisher.rs`, que hace
`socket.bind("tcp://0.0.0.0:0")` y anuncia el resultado tal cual. El propio
crate ya lo resuelve bien para los sockets de servicio, con
`get_local_ip_for_endpoint(endpoint, host_ip)` en `src/transport/service.rs`,
que además respeta `GZ_IP`. `Publisher::bind` no la usa y ni siquiera recibe la
`Config`, así que **`GZ_IP` no sirve como rodeo**. Vale la pena reportarlo
upstream: la corrección es de una línea.

El argumento original contra el FFI --- no enlazar contra las libs de conda ---
resultó no sostenerse: el motor obliga a distribuir el entorno conda de todas
formas, así que el enlace no añade ninguna dependencia nueva en tiempo de
ejecución.

### Lo que se descartó por el camino

Cada uno costó una vuelta entera; están aquí para que nadie los repita:

- **No era la partición.** Los dos lados calculan `hostname:username` igual, y
  con `GZ_PARTITION` fija el problema empeora (se rompe también la lectura).
- **No era el tiempo de discovery.** Con 12 segundos de espera pasa lo mismo.
- **No era que el anuncio no saliera.** Un tercer nodo veía
  `/mars/cmd/actuators [gz.msgs.Actuators]` perfectamente.
- **No era el plugin.** Con `MARS_VERBOSE=3` el motor confirmaba
  `[MarsLink] protocolo 0.1.0, 4 actuadores` y publicaba su estado sin problema.

## El shim de nombres de librería

Además de generar el protocolo, `build.rs` crea alias de librerías. Los `.pc` de
conda-forge están escritos con la convención de Unix y piden `-lprotobuf` y
`-lzmq`, contando con que el enlazador anteponga `lib`. MSVC no lo hace: busca
`protobuf.lib` literal, mientras que el archivo instalado es `libprotobuf.lib`.

Los `cargo:rustc-link-lib=` los emite `gz-transport-sys` y no se le pueden
quitar, así que `build.rs` le da lo que pide: un enlace duro con el nombre
correcto en `OUT_DIR`. Si aparece un `LNK1181` nuevo, se añade el nombre a la
lista `ALIAS` y ya.

## El motor cierra el lazo de posición

Cada actuador declara su modo de control en el `<actuator>` del SDF:

| modo | lee de `gz.msgs.Actuators` | quién cierra el lazo |
|---|---|---|
| `duty` | `normalized` (-1..1) | nadie; se aplica tal cual |
| `position` | `position` (radianes del joint) | **el motor**, con un PD a la tasa de la física |

El modo posición no es una comodidad: es la única forma de simular un motor CAN
con fidelidad. Un TalonFX cierra su lazo **dentro** del controlador, a ~1 kHz, y
el código del robot solo le manda la consigna.

Un swerve lo obliga. Se intentó primero sujetar las direcciones desde el código
del robot, con duty, y no funciona: una dirección MK4 de 12.8:1 con Kraken tiene
~90 N·m sobre ~0.008 kg·m² de inercia reflejada, o sea 10 700 rad/s². En los 20
ms de un ciclo de robot eso son 214 rad/s. Se probó a 50 Hz (269° de desvío) y a
250 Hz (145°): más rápido ayuda, pero el problema no es el periodo — es que
ningún lazo sobre la red tiene autoridad sobre algo tan rápido.

Con el lazo en el motor, el mismo swerve mantiene las direcciones dentro de
**0.6°** mientras acelera a fondo, y sigue una consigna de 34° con 1–2.5° de
error.

Ese error residual es de un PD sin término integral, y es esperable. Un TalonFX
real lo elimina con feedforward (`kS`). Si algún día molesta, la salida es
añadir `ki` o un término de fricción estática al actuador, no subir `kp`.

### Las ganancias

`kp` y `kd` son atributos del `<actuator>`, en duty por radián y por rad/s **del
joint**. Los del swerve salen de dimensionar la dirección: con 0.008 kg·m² de
inercia y 90 N·m de autoridad, `kp=0.08` da una frecuencia natural de ~30 rad/s.
`kd` suma al `<damping>` del joint, que ya aporta lo suyo.

La derivada sale de la velocidad **medida**, no de derivar el error. Derivar
numéricamente un error que llega por la red amplifica cualquier salto de la
consigna.

## Dos huecos de modelado que el swerve destapó

Los dos valen para cualquier mecanismo con reducción, no solo swerve.

**Inercia reflejada del rotor.** `MarsLink` multiplica el PAR por la reducción,
pero la INERCIA que el motor le presenta al joint va con la reducción AL
CUADRADO (`J_ref = J_rotor · n²`). Como el motor no puede tocar las inercias del
ECS, eso tiene que salir del modelo. Sin ella, una dirección 12.8:1 recibe 90
N·m sobre 0.0015 kg·m² y el solver diverge en el primer paso: el robot sale
disparado a 5 000 000 rad/s. `gen_swerve.py` la suma.

**El tensor tiene que seguir siendo válido.** Sumar la reflejada solo al eje del
joint viola la desigualdad triangular (cada momento principal ≤ la suma de los
otros dos) y Gazebo rechaza el mundo con `Error Code 19: invalid inertia`. Hay
que subir también los perpendiculares. Y con margen: a 5 decimales el redondeo
mismo vuelve a violarla.
