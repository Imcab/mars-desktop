# El cambio en `CommandSwerveDrivetrain.java`

Dos sitios. Nada más de tu código cambia.

## 1. El campo y los constructores

```java
+   MarsSimGlue m_marsGlue;
```

En **cada uno** de los tres constructores, dentro del `if` que ya tienes:

```java
    if (Utils.isSimulation()) {
+       m_marsGlue = new MarsSimGlue(this);
        startSimThread();
    }
```

## 2. El hilo de simulación

```java
    private void startSimThread() {
        m_lastSimTime = Utils.getCurrentTimeSeconds();

        m_simNotifier = new Notifier(() -> {
            final double currentTime = Utils.getCurrentTimeSeconds();
            m_lastSimTime = currentTime;

-           double deltaTime = currentTime - m_lastSimTime;
-           updateSimState(deltaTime, RobotController.getBatteryVoltage());
+           // La física la resuelve Gazebo cuando MARS Simulation Studio está corriendo; si
+           // no, el glue llama a updateSimState por su cuenta. El delta lo
+           // calcula él, así que aquí ya no hace falta.
+           m_marsGlue.update();
        });
        m_simNotifier.startPeriodic(kSimLoopPeriod);
    }
```

`RobotController` puede quedarse sin usar en este archivo. Es solo un aviso del
compilador, pero conviene quitar el import.

## Por qué esto y no otra cosa

`updateSimState` es donde CTRE simula los módulos: modela los motores, aplica
sus ganancias e integra la pose con la cinemática del swerve. Es una simulación
*cinemática* — el robot va exactamente a donde las ecuaciones dicen que iría,
sin masa que acelerar, sin ruedas que patinen y sin paredes contra las que
chocar.

Sustituir esa llamada basta porque es el único punto donde entra el estado
simulado del hardware. Todo lo de encima — las peticiones de
`SwerveRequestFactory`, el lazo de dirección de Phoenix, la odometría, tu
binding del control — sigue igual, porque los encoders y el giroscopio siguen
dando valores; solo que ahora salen de un robot con masa apoyado en el suelo.

## Trabajar sin la simulación

`m_marsGlue.update()` detecta si MARS Simulation Studio está publicando. Si no lo está, llama
a `updateSimState` él mismo y todo se comporta como antes de instalar nada.
Arrancar o cerrar MARS Simulation Studio a mitad de sesión funciona sin reiniciar el robot, y
lo dice en la consola:

```
[MARS] simulacion conectada; la fisica manda
[MARS] simulacion ausente; volviendo a la de CTRE
```

Se mira la **marca de tiempo** de los datos, no su valor: un robot parado
publica ceros que no se distinguen de "nadie publicó nunca", y con eso el robot
se quedaría congelado al arrancar sin que nada lo explicara.

## Si no pasa nada: el árbol de diagnóstico

El glue publica su propio estado en `MARS/Glue/diag`. Mira ese nodo en el árbol
de NetworkTables de mars-desktop y lee la tabla de abajo. Cada fila descarta un
tramo distinto del camino, así que la primera que falle es la causa.

| en `MARS/Glue/diag` | qué significa |
|---|---|
| no existe el nodo | La clase **no se construyó**. El `if (Utils.isSimulation())` no entró, o el robot que corre es de antes de recompilar. |
| `creado = true`, `ticks` **no sube** | Se construyó pero el hilo no corre: `startSimThread()` no se llamó, o el `Notifier` murió. Mira `error`. |
| hay `error` | `update()` lanzó. El texto y el stack están en la consola del robot. |
| `ticks` sube, `conectado = false` | El glue va bien; **la que no contesta es la simulación**. Revisa que MARS Simulation Studio esté arrancada y que el bridge diga `NT4 conectado`. |
| `ticks` sube y `conectado = true` | El lazo está cerrado. Si aun así no se mueve, es un problema de nombres o de unidades. |

`creado` aparece también en la consola del robot como `[MARS] glue creado`.

## Cómo se comprueba que funciona

Con la simulación corriendo y el robot en teleoperado:

1. **El robot se mueve en la ventana de MARS Simulation Studio.** Si no, mirá el árbol de
   NetworkTables bajo `/MARS/Glue/` — el fallo más común es un nombre de módulo
   que no coincide con el robot-map.
2. **Acelerá a fondo desde parado.** Las ruedas patinan y la odometría se
   adelanta a la pose real. Comparar `/MARS/Sim/truthPose` contra la pose de tu
   odometría es exactamente lo que esta simulación existe para enseñarte, y lo
   que ninguna simulación cinemática puede mostrar.
3. **Chocá contra algo** (cuando el mundo tenga perímetro). Con `updateSimState`
   lo atraviesa; con esto se para.

## El acoplamiento

`kCoupleRatio = 3.375` del `TunerConstants`: en un MK4, girar el azimut arrastra
el motor de tracción. Gazebo no lo modela — sus dos joints son independientes —
así que el glue lo suma al convertir a unidades de rotor.

Sin eso, el encoder de tracción no se movería al girar los módulos y la
odometría del robot simulado saldría **más limpia** que la del real justo en la
maniobra donde peor se porta. Una simulación que miente a favor es peor que
ninguna.
