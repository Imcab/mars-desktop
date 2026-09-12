# Protocolo de simulación de MARS

Contrato entre tres procesos. Congelarlo primero es lo que permite escribir el
motor en C++ y el bridge en Rust en paralelo sin que se pisen.

- **`topics.toml`** — fuente única de verdad de los nombres de tópico y de las
  dimensiones de la cancha. No es una aspiración: el `build.rs` del bridge lo
  lee en tiempo de compilación y emite las constantes, así que renombrar un
  tópico aquí rompe la compilación del bridge.
- **`check.py`** — verifica que el contrato no se contradiga: nombres de mundo,
  dimensiones de cancha, orden de actuadores y tópicos citados en este README.
- **`robot-map.example.json`** — la traducción entre canales del roboRIO y
  joints del SDF. Es lo único que cambia entre robots.

Estado: implementadas y verificadas la telemetría (motor → app) y el lazo de
hardware del perfil `vendor` (código del robot ⇄ motor), con los dos modos de
control. El perfil `hal` no está.

Versión actual: **0.1.0**. El bridge se niega a operar contra un motor cuyo
major no coincida, y lo comprueba en el handshake de `/mars/meta/hello`.

## Los tres saltos

```
 código del robot                bridge (Rust)              motor (C++)
 ────────────────                ─────────────              ───────────
 simulateJava / roboRIO                                     gz-sim headless

        │  (2) HALSim WS               │  (1) gz-transport        │
        │  ws://localhost:3300         │  protobuf, IPC local     │
        │  JSON, robot = cliente  ◄────┤  bridge = suscriptor ◄───┤
        │                              │                          │
        │  (3) NT4 :5810               │                          │
        └──► robot = SERVIDOR   ◄──────┤                          │
                    ▲                  │
                    │                  │
              app MARS (cliente)  ──────┘
```

Tres decisiones de rol que conviene no revisar a la ligera:

**El bridge es el servidor de WebSocket, no el cliente.** El código del robot
carga `halsim_ws_client` y se conecta hacia nosotros. Al revés también
funciona, pero el código del robot se reinicia cada vez que el equipo compila,
y la app es el proceso largo. Que el efímero sea el que se conecta significa
que reiniciar robot code no tira la simulación.

**El servidor NT4 no es nuestro.** Lo levanta el código del robot en `:5810`,
como en un robot real. El bridge y la app son ambos clientes. Esto mantiene la
simulación indistinguible de un partido real desde el punto de vista de la
app: el mismo cliente NT4 de `src-tauri/src/nt4/` sirve para los dos casos, sin
una rama de código para "modo sim".

**El motor no habla NT4 ni WebSocket.** Solo gz-transport. Todo el pegamento
vive en el bridge. Así el motor se puede probar solo, con un script que le
publique actuadores y lea joints, sin levantar nada de WPILib.

## Los dos perfiles

Aquí está el detalle que define el proyecto: **el protocolo HALSim WS no cubre
motores CAN.** Cubre PWM, DIO, AnalogIn, Encoder, Relay, SimDevice y
DriverStation — todo lo nativo del roboRIO. Un TalonFX o un SparkMax se simulan
por la API de sim de su vendor (`TalonFXSimState`, `SparkSim`), que vive dentro
del proceso del robot y no se asoma a wpilibws.

### Perfil `hal` — transparente

Para mecanismos sobre PWM y sensores conectados al RIO. Cero cambios en el
código del robot: se carga la extensión y ya. Es el caso ideal y el que hay que
usar siempre que se pueda.

### Perfil `vendor` — con glue

Para drivetrains sobre CAN, que es donde está casi todo FRC hoy. Requiere unas
50 líneas en el código del robot que, en el `simulationPeriodic`:

1. leen lo que el vendor le está pidiendo al motor y lo publican: el duty en
   `/MARS/Glue/out/<name>/duty`, o el ángulo en
   `/MARS/Glue/out/<name>/setpoint` si ese actuador cierra posición;
2. leen `/MARS/Glue/in/<name>/position` y `/MARS/Glue/in/<name>/velocity` y
   las inyectan al vendor con `setRawRotorPosition` / `setRotorVelocity`.

**Cuál de los dos publica** lo decide el modo de control del actuador, que se
declara en el `<actuator>` del SDF y se repite en el robot-map. Un motor con
lazo propio --- una dirección de swerve --- va en modo `position` y el motor de
la simulación cierra el lazo, igual que el TalonFX real. Ver
[sim/bridge/README.md](../bridge/README.md).

Es intrusivo y es el precio de que los vendors no expongan su sim por fuera del
proceso. El glue va en el repo del robot, no aquí, pero su contrato está en
`topics.toml` bajo `[[glue]]`.

Un robot puede usar los dos perfiles a la vez: `vendor` para el swerve y `hal`
para un elevador sobre PWM. El `robot-map` lo declara por robot, y los
actuadores llevan su bloque `hal` de todas formas para poder migrar sin
reescribir el mapa.

## Quién manda el tiempo

**Nadie, y hay que saberlo.** El protocolo wpilibws no tiene mensaje de reloj:
no hay forma de que la simulación le imponga su tiempo al HAL del robot. Los
dos relojes corren sobre tiempo de pared, en paralelo, sin sincronizar.

En la práctica funciona si y solo si Gazebo sostiene un real-time factor de
1.0. Por eso el RTF se publica en `/MARS/Sim/realTimeFactor` y no es un dato
decorativo: es la métrica de validez del lazo. Sostenido por debajo de ~0.95,
el código del robot está corriendo su ciclo de 20 ms contra una física que va
más lenta, y cualquier ganancia de PID que se afine ahí no va a transferir al
robot real. La app debe avisarlo de forma visible, no esconderlo en un log.

Esto pone un techo duro al detalle del modelo: si el robot es tan pesado de
simular que no llega a 1.0, hay que simplificarlo, no bajar el RTF.

## Convenciones que muerden

**Ejes.** Gazebo usa ENU con Z arriba y yaw CCW positivo desde X. WPILib usa
el mismo sentido de yaw pero mide desde el eje que apunta al muro contrario
del campo, y su origen es la esquina de la alianza. El bridge hace la
conversión completa (origen y rotación) para que ni el motor ni el glue tengan
que saber de qué alianza somos.

**Unidades.** En gz-transport todo va en SI y radianes, siempre. La conversión
a grados y a las convenciones de WPILib pasa una sola vez, en el borde NT4 del
bridge. Un valor en grados dentro del motor es un bug.

**Reducciones.** `gearRatio` es reducción: vueltas de motor por vuelta de
salida. Los encoders reportan en el eje del motor, antes de la reducción, que
es como lo hacen los integrados de Falcon y Kraken.

**Límite de corriente.** `currentLimit` es un atributo del `<actuator>` del SDF
y vive solo en el motor: el bridge no lo necesita porque no cambia ningún
mensaje. Es la corriente de estator en amperios, y sin él el modelo DC entrega
la de calado entera --- 366 A en un Kraken, o sea varias veces el agarre
disponible en una tracción. El número correcto es la corriente de
deslizamiento, `I_slip = mu * m * g / ruedas * r_rueda / (Kt * reducción)`, la
misma que CTRE llama `kSlipCurrent`. Recorta también la corriente negativa, así
que además convierte el frenado por contraelectromotriz en uno de motor real.

**El radio de rueda no está en el robot-map.** Sale de la geometría de colisión
del SDF, que es la única que la física respeta. Duplicarlo garantiza que un día
diverjan y que el robot simulado maneje distinto de lo que dice su odometría.

## Fuera de alcance en 0.1.0

Deliberadamente, para que la primera versión cierre:

- **Cámaras y visión.** Requiere `gz-sensors` con rendering y OGRE2. El
  entorno ya las tiene instaladas como dependencia, pero el motor no carga
  esos plugins. Cuando toque, es un perfil nuevo, no un cambio de protocolo.
- **Game pieces y scoring.** El mundo es el robot y el suelo.
- **Múltiples robots.** El namespace `/mars/` no lleva índice de robot todavía.
  Añadirlo después es un cambio de major.
- **Introspección dinámica de mensajes.** El descriptor `gz-msgs12.gz_desc`
  del paquete de conda-forge no se parsea (desajuste de protobuf), así que
  `gz topic --echo` sobre tipos arbitrarios no funciona en este entorno. Por
  eso el protocolo se limita a tipos `gz.msgs` estándar: el pub/sub estático de
  C++ no pasa por el descriptor y no le afecta.
