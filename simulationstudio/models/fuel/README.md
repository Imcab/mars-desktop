# FUEL

El elemento de puntuación de REBUILT (FRC 2026): una pelota de espuma de alta
densidad de 15 cm, la AndyMark am-5801.

Este directorio es el modelo con **física**. Las 456 FUEL que se ven en la
cancha 2026 están horneadas en el glTF como decorado: no tienen colisión ni
masa y no se pueden empujar ni recoger. Las de verdad las siembra el World
Editor (grupo *FUEL (game pieces)*), que escribe un `<include>` de
`model://fuel` por pelota.

## De dónde sale cada número

| Magnitud | Valor | Fuente |
|---|---|---|
| Diámetro | 15.0 cm (5.91 in) | manual de juego, 5.10.1 |
| Masa | 0.215 kg | manual: 0.448–0.500 lb, nominal |
| Inercia | 4.8375e-4 kg·m² | esfera sólida, `2/5·m·r²` |
| Color | 0.956 0.597 0.056 | `baseColorFactor` del material de las 456 FUEL del `.glb` oficial |
| Fricción | μ = 0.85 | **punto de partida, no una medida** |

La esfera sólida no es una simplificación: una pelota de espuma es
prácticamente homogénea. Importa más de lo que parece — esa inercia es la que
decide cuánto gira al rozar contra un rodillo de intake.

## Lo que hay que calibrar

**μ = 0.85** es lo único del modelo que no sale del manual. Decide si la FUEL
rueda o se arrastra cuando un robot la empuja, y si un intake la agarra o
patina contra ella. La espuma de alta densidad agarra más que un plástico liso
y menos que el caucho de una rueda; la alfombra FRC del suelo está en 0.9.

`worlds/fuel-drop.sdf` es el banco: su cuarta pelota baja por una rampa de 20°.
Con μ correcto rueda; con μ bajo se desliza y llega abajo girando menos de lo
que debería.

## El rebote no existe, y está medido

El modelo llevaba `<bounce><restitution_coefficient>0.35</...>`. Se quitó
después de medirlo: con `bridge/src/bin/fuel-bounce.rs` contra
`worlds/fuel-drop.sdf`, las tres pelotas dan **e = 0.000** tanto con DART como
con bullet-featherstone. Este build de gz-physics ignora `<bounce>` por
completo.

Dejarlo puesto habría sido peor que no tenerlo: un número que se puede
"afinar" durante una tarde entera sin que cambie nada.

Consecuencia práctica: la FUEL cae y se queda. Para una pelota de espuma sobre
alfombra eso se parece bastante a la realidad, pero **no sirve para estudiar un
tiro que rebota en el borde del HUB**. Conseguir rebote de verdad requiere
fijar la restitución por contacto desde un system en C++ — gz-physics expone
`SetContactPropertiesCallbackFeature` —, o sea trabajo para `MarsLink`, no una
etiqueta del SDF.

## Coste

Cada FUEL sembrada es un cuerpo dinámico más en el lazo del solver. Es la
primera cosa que hay que recortar si el real-time factor baja de ~0.95: por
debajo de ahí el lazo de control ya no es representativo del robot real, y las
ganancias que se afinen contra esta simulación no transfieren.
