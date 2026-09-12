#!/usr/bin/env python3
"""Genera swerve.sdf y el robot-map que le corresponde.

    python sim/worlds/gen_swerve.py

Existe porque un swerve son cuatro modulos identicos salvo por su esquina:
escribirlos a mano son ~400 lineas de XML repetido donde un signo cambiado no
se ve, y las inercias hay que calcularlas igual. Generar los dos archivos del
mismo script tambien garantiza que el ORDEN de los actuadores coincida, que es
lo que check.py verifica despues.

Reejecutarlo pisa los dos archivos; si hay que tocar el robot a mano, tocar
este script y volver a correrlo.
"""
import io
import json
import math
from pathlib import Path

from cancha_2026 import (
    RADIO_FUEL, asegurar_optimizado, asegurar_sin_fuel, dentro_de_la_cancha,
    hitboxes, posiciones, separar_de_cajas,
)

AQUI = Path(__file__).parent
SIM = AQUI.parent

# La cancha 3D, relativa a sim/. Si no esta instalada (Field Library del Studio)
# el mundo se genera igual, con el suelo liso de siempre.
CAMPO = "fields/2026-rebuilt/model.glb"

# Que malla de la cancha entra al mundo. Es lo mas caro que dibuja la ventana de
# Gazebo, con diferencia.
#
#   "lite"      la cancha recortada: fuera las FUEL horneadas y fuera todo lo
#               que mida menos de 12 cm --- tuercas PEM, remaches, bujes,
#               tornilleria. 2929 instancias y 4.28 M de triangulos pasan a 1321
#               y 2.29 M, y no se nota mirando: nada de 5 mm se ve desde una
#               camara que encuadra un robot de 70 cm. La genera cancha_2026.py.
#   "completo"  la malla oficial entera, con cada remache modelado.
#   "ninguno"   sin cancha: el suelo liso de siempre. Es la palanca de verdad
#               para una maquina que va justa.
#
# Las HITBOXES no dependen de esto y siempre salen del modelo OFICIAL, no del
# recortado: la fisica tiene que ser la de la cancha de verdad aunque el dibujo
# lleve seis milimetros menos de tornillo.
CAMPO_VISUAL = "lite"

# --- FUEL con fisica ------------------------------------------------------
# CUANTAS FUEL con fisica lleva el mundo. 0 = ninguna.
#
# El numero importa mas que ninguna otra cosa de este archivo, porque cada
# pelota es un cuerpo dinamico y son lo unico que crece de a cientos. Medido en
# esta maquina, 10 s de simulacion descontando el arranque:
#
#   FUEL = 0 o 1     10 s de pared  ->  RTF 1.00
#   FUEL = 408       21 s de pared  ->  RTF 0.48
#
# Con RTF 0.48 el mundo no solo va a medio tiempo real: la ventana de Gazebo
# tiene que dibujar 408 cuerpos que se mueven, y entre las dos cosas el robot no
# responde. Sembrar la cancha entera se ve muy bien en una captura y no se puede
# conducir.
#
# Se eligen las mas cercanas al punto de spawn, saltando las que caerian debajo
# del robot: con FUEL = 1 sale la que tenes justo delante para probar un intake.
FUEL = 1

# Si la malla de la cancha conserva sus 456 FUEL HORNEADAS (nodos del glTF, sin
# colision y sin masa). Con False se usa una copia sin ellas, que es lo correcto
# cuando las de verdad las pone este generador: si no, en cada sitio hay dos
# pelotas, la de mentira que no se mueve nunca y la fisica encima.
#
# Ponerlo en True solo tiene sentido con FUEL = 0 y CAMPO_VISUAL = "completo",
# para ver la cancha entera como decorado.
FUEL_DECORATIVAS = False

# --- hitboxes de la cancha ------------------------------------------------
# La malla de la cancha es SOLO visual: 2.9 M de triangulos, y usarla de
# colision pondria al solver a resolver contacto malla-malla, que es lo mas
# caro que hace un motor de fisica. Sin esto el robot atraviesa la pared de la
# estacion, el HUB y todo lo demas conduciendo.
#
# Son cajas, y salen de los AABB del propio glTF --- ver cancha_2026.py, que
# tambien explica cuales entran y por que el trench y los bumps no.
#
# HITBOXES_VISIBLES las dibuja translucidas encima de la malla. Es para
# comprobar que cada caja cae donde va; para conducir, estorban. (Gazebo
# tambien las muestra desde el arbol de entidades, boton derecho > View >
# Collisions, pero eso hay que hacerlo en cada arranque.)
HITBOXES = True
HITBOXES_VISIBLES = False

# --- geometria del robot -------------------------------------------------
# TODOS estos numeros salen de TunerConstants.java del proyecto del robot. Si
# alli cambian, aqui tambien: una simulacion con otra reduccion o otro radio de
# rueda da velocidades que no son las del robot, y afinar contra eso no sirve.
#
#   kFrontLeftXPos/YPos  = 10.8545 in = 0.27570 m
#   kWheelRadius         = 2 in       = 0.05080 m
#   kDriveGearRatio      = 5.2734375
#   kSteerGearRatio      = 26.09090909090909
POS = 0.27570           # media distancia entre ruedas, en X y en Y
ESQUINAS = [("fl", POS, POS), ("fr", POS, -POS),
            ("bl", -POS, POS), ("br", -POS, -POS)]

R_RUEDA = 0.0508        # kWheelRadius: 2 pulgadas de RADIO
ANCHO_RUEDA = 0.045
M_RUEDA = 0.8
M_STEER = 1.2           # el cuerpo del modulo que gira
M_CHASIS = 45.0
# Chasis algo mayor que la huella de las ruedas, como un bumper real.
CHASIS = (0.72, 0.72, 0.15)
Z_CHASIS = 0.20

# Donde nace el robot. Ademas de escribirse en el <include>, decide que FUEL se
# siembran: son las mas cercanas a este punto.
ROBOT_POSE = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

RED_TRACCION = 5.2734375            # kDriveGearRatio
RED_DIRECCION = 26.09090909090909   # kSteerGearRatio
CPR = 2048              # encoder integrado de Kraken

# --- limite de corriente --------------------------------------------------
# La CORRIENTE DE DESLIZAMIENTO: la que hace que la rueda entregue justo la
# fuerza que la alfombra aguanta. Es el mismo numero que CTRE llama
# kSlipCurrent en TunerConstants, y es lo que separa un arranque de robot de un
# arranque quemando rueda.
#
# Sin limite, el modelo DC entrega los 366 A de calado del Kraken: 736 N por
# rueda contra ~117 N de agarre. El robot simulado patina SIEMPRE al arrancar y
# el real no, porque su TalonFX tiene el limite puesto y la simulacion no se
# habia enterado.
#
# Se calcula aqui y no se escribe a mano para que siga siendo verdad si cambian
# la masa, el radio o la reduccion.
MU_ALFOMBRA = 0.9       # el mu del suelo; la rueda declara 1.1 y manda el menor
KT_KRAKEN = 7.09 / 366  # par de calado / corriente de calado, de MarsLink.cc


def corriente_de_deslizamiento():
    masa = M_CHASIS + 4 * (M_RUEDA + M_STEER)
    fuerza_por_rueda = MU_ALFOMBRA * masa * 9.81 / 4
    par_motor = fuerza_por_rueda * R_RUEDA / RED_TRACCION
    return par_motor / KT_KRAKEN


LIMITE_TRACCION = round(corriente_de_deslizamiento())

# La direccion no tiene que traccionar nada: su limite es el del hardware, no
# el del suelo. 60 A es lo que pone la plantilla de swerve de CTRE, y con la
# inercia reflejada del joint sigue llegando a 90 grados en ~0.15 s.
LIMITE_DIRECCION = 60

# Que hace el motor de traccion cuando no se le pide nada.
#
#   "coast"  circuito abierto: la rueda gira libre. Es el de fabrica de un
#            TalonFX y es lo que hace que el robot ruede al soltar el stick.
#   "brake"  cortocircuita el motor y su contraelectromotriz lo frena. Medido:
#            frena a 8.8 m/s^2, que es TODO el agarre de la alfombra, o sea un
#            frenazo de emergencia cada vez que se centra el stick.
#
# La direccion no lo lleva: un modulo en modo posicion siempre esta pidiendo
# algo, asi que su neutro no existe en la practica.
NEUTRO_TRACCION = "coast"

# Inercia del rotor del Kraken X60, en kg*m^2. Aproximada: el valor exacto no
# esta publicado y este es del orden correcto para un rotor de esa clase.
#
# NO es un detalle. MarsLink multiplica el PAR por la reduccion, pero la
# INERCIA que el motor le presenta al joint va con la reduccion AL CUADRADO
# (J_reflejada = J_rotor * n^2), y eso tiene que salir del modelo porque el
# motor no puede tocar las inercias del ECS.
#
# Sin esto, una direccion 12.8:1 recibe 90 N*m sobre un cuerpo de 0.0015
# kg*m^2: 60000 rad/s^2, o sea 240 rad/s en un solo paso de 4 ms. El solver
# diverge en el primer ciclo y el robot sale disparado. Con la reflejada, esa
# misma direccion tiene 164 veces mas inercia y se comporta.
J_ROTOR = 4.2e-5

# Friccion viscosa de los joints, en N*m*s/rad.
#
# CUIDADO CON ESTE NUMERO. El amortiguamiento dominante de un motor no es la
# friccion del reductor: es su propia fuerza contraelectromotriz, y MarsLink ya
# la aplica. Para el Kraken en la direccion vale
#
#   b_bemf = Kt * n^2 / (Kv * R) = 0.0194 * 26.09^2 / (52.7 * 0.0328)
#          = 7.6 N*m*s/rad
#
# o sea que el joint YA llega amortiguado de fabrica. Esto de aqui es solo la
# perdida mecanica del reductor, que es chica.
#
# Aqui habia 1.5, que sonaba conservador y no lo era: sumado a los 7.6 del motor
# dejaba el lazo de posicion con una constante de tiempo de 1.7 s --- medido con
# `bridge/src/bin/swerve-step.rs`, la direccion llegaba a 73 de 90 grados en
# TRES segundos. Un robot cuyas ruedas tardan un segundo en apuntar arrastra las
# ruedas de lado en cada cambio de direccion: se ve como que patina y se siente
# como una inercia que el robot no tiene.
DAMPING_DIRECCION = 0.05
#
# Y el de traccion tampoco es libre: 0.02 N*m*s/rad son 2.2 N*m por rueda a
# velocidad punta, o sea 177 N contra un robot de 53 kg --- 3.3 m/s^2 de
# frenado solo por el amortiguamiento del joint, con el motor sin pedir nada. Un
# tren de traccion real arrastra bastante menos: 0.004 deja unos 0.7 m/s^2, que
# es lo que pierde un swerve rodando en punto muerto.
DAMPING_TRACCION = 0.004

# Ganancias del lazo de posicion que cierra el motor, en duty por radian y por
# rad/s DEL JOINT.
#
# Dimensionadas contra lo que hay de verdad en el joint de direccion: inercia
# reflejada J = J_rotor * n^2 + lo del cuerpo = 0.031 kg*m^2, y 185 N*m por
# unidad de duty (7.09 N*m de calado por 26.09 de reduccion).
#
#   k  = KP * 185 = 166 N*m/rad
#   b  = 7.6 (bemf) + KD * 185 (1.9) + 0.05 (joint) = 9.5 N*m*s/rad
#   -> zeta = b / (2*sqrt(k*J)) = 2.1   (sobreamortiguado, sin sobrepaso)
#   -> polo lento k/b = 17.5 1/s, o sea ~0.06 s de constante de tiempo
#
# KP=0.9 satura el duty para errores mayores a ~64 grados, y eso es CORRECTO:
# un TalonFX real le mete voltaje completo a un error de 90 grados y llega en
# ~0.15 s, limitado por la velocidad libre del motor (24 rad/s en el joint), no
# por la ganancia.
KP_DIRECCION = 0.9
KD_DIRECCION = 0.01


def inercia_caja(m, x, y, z):
    return (m / 12 * (y * y + z * z), m / 12 * (x * x + z * z), m / 12 * (x * x + y * y))


def inercia_cilindro(m, r, h):
    """Eje en Z local: axial = m r^2/2, perpendicular = m(3r^2 + h^2)/12."""
    perp = m * (3 * r * r + h * h) / 12
    return (perp, perp, m * r * r / 2)


def con_reflejada(ix, iy, iz, j_ref):
    """Suma la inercia reflejada del rotor sin romper el tensor.

    La reflejada actua SOLO sobre el eje del joint, pero ningun cuerpo rigido
    puede tener un tensor asi: los momentos principales tienen que cumplir la
    desigualdad triangular (cada uno <= la suma de los otros dos). Sumarla solo
    a izz da `Error Code 19: A link has invalid inertia` y el mundo no carga.

    La salida es subir tambien los perpendiculares hasta el minimo que hace
    valido el tensor. Exagera la inercia del link fuera de su eje, pero se trata
    de piezas de ~1 kg junto a un chasis de 45: al lado de la reflejada que se
    estaba perdiendo, el error es despreciable.
    """
    iz += j_ref
    # El 2% de margen no es cosmetico: los valores se imprimen redondeados y
    # con un margen mas fino el redondeo mismo vuelve a violar la desigualdad.
    minimo = iz / 2 * 1.02
    return (max(ix, minimo), max(iy, minimo), iz)


def elegir_fuel(cuantas):
    """Las `cuantas` FUEL staged mas cercanas al spawn del robot.

    Por cercania y no por orden del archivo porque con pocas pelotas lo unico
    que importa es tenerlas A MANO: con una sola, la que sale es la que el robot
    tiene delante para probar un intake, no una perdida en la otra punta.

    Se saltan las que caerian DEBAJO del robot. La banda del centro pasa justo
    por el spawn, y una pelota que nace dentro del chasis sale disparada en el
    primer paso --- el solver tiene que separarlos y solo puede hacerlo a
    empujones.
    """
    # Media diagonal del chasis mas el radio de la pelota: el circulo que el
    # robot ocupa de verdad, no su lado.
    libre = math.hypot(CHASIS[0], CHASIS[1]) / 2 + RADIO_FUEL

    def lejos(p):
        return math.hypot(p[0] - ROBOT_POSE[0], p[1] - ROBOT_POSE[1])

    dentro = [p for p in posiciones(SIM / CAMPO)
              if dentro_de_la_cancha(p) and lejos(p) > libre]
    dentro.sort(key=lejos)
    return dentro[:cuantas]


def generar_sdf():
    ix, iy, iz = inercia_caja(M_CHASIS, *CHASIS)
    rix, riy, riz = inercia_cilindro(M_RUEDA, R_RUEDA, ANCHO_RUEDA)
    six, siy, siz = inercia_cilindro(M_STEER, 0.05, 0.12)
    # El eje del joint es Z local en los dos casos.
    six, siy, siz = con_reflejada(six, siy, siz, J_ROTOR * RED_DIRECCION ** 2)
    rix, riy, riz = con_reflejada(rix, riy, riz, J_ROTOR * RED_TRACCION ** 2)
    cx, cy, cz = CHASIS

    L = []
    w = L.append
    w('<?xml version="1.0" ?>')
    w("<!--")
    w("  Swerve de cuatro modulos sobre Kraken X60.")
    w("")
    w("  GENERADO por sim/worlds/gen_swerve.py. Para cambiar el robot se toca el")
    w("  script y se vuelve a correr, no este archivo.")
    w("")
    w("  Cada modulo son DOS joints: uno de direccion sobre Z (el cuerpo del")
    w("  modulo gira entero) y uno de traccion sobre el eje de la rueda. El link")
    w("  de la rueda cuelga del de direccion y no del chasis, porque girar la")
    w("  direccion tiene que arrastrar la rueda con ella.")
    w("")
    w("  Las direcciones NO tienen tope ni resorte: con par cero quedan libres y")
    w("  las fuerzas laterales las mueven, igual que un modulo real sin")
    w("  corriente. El codigo del robot tiene que cerrar el lazo de posicion.")
    w("  sim/bridge/fake-robot.py lo hace con un P para poder probarlo.")
    w("")
    w("  Los limites de la cancha son cajas de colision sacadas del modelo")
    w("  oficial: guardrails, los seis driver stations, las torres, los")
    w("  outposts y los dos HUB. Se apagan con HITBOXES en el generador.")
    w("-->")
    w('<sdf version="1.11">')
    w('  <world name="mars">')
    w("")
    w('    <physics name="250hz" type="ignored">')
    w("      <max_step_size>0.004</max_step_size>")
    w("      <real_time_factor>1.0</real_time_factor>")
    w("    </physics>")
    w("")
    w('    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>')
    w('    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>')
    w('    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>')
    w("")
    w("    <gravity>0 0 -9.8</gravity>")
    w("")
    w('    <light type="directional" name="sun">')
    w("      <pose>0 0 10 0 0 0</pose>")
    w("      <diffuse>0.8 0.8 0.8 1</diffuse>")
    w("      <direction>-0.5 0.1 -0.9</direction>")
    w("    </light>")
    w("")
    # La cancha FRC de verdad, si esta instalada en sim/fields/. Es un VISUAL y
    # nada mas: son ~2.9 M de triangulos y usarla como colision pondria al
    # solver a resolver contacto malla-malla, que es lo mas caro que hace un
    # motor de fisica. La colision la siguen dando el plano y, si hicieran
    # falta, los muros. El robot arranca en 0,0 que es el CENTRO de la cancha;
    # el bridge es quien traslada al origen de esquina de WPILib.
    hay_campo = (SIM / CAMPO).is_file()
    campo = None
    if hay_campo and CAMPO_VISUAL != "ninguno":
        if CAMPO_VISUAL == "lite":
            campo = asegurar_optimizado(CAMPO)
        elif FUEL_DECORATIVAS:
            campo = CAMPO
        else:
            campo = asegurar_sin_fuel(CAMPO)

    # Las FUEL fisicas sustituyen a las horneadas: el visual pasa a ser la copia
    # sin ellas, o se verian dos pelotas en cada sitio --- la del glTF, que no se
    # mueve nunca, y la de verdad encima.
    fuel = []
    if FUEL > 0 and hay_campo:
        fuel = elegir_fuel(FUEL)
        if HITBOXES:
            # Doce de las que estan contra la pared de la estacion caen 12 mm
            # dentro de su hitbox. Ver separar_de_cajas().
            cajas_previas = hitboxes(SIM / CAMPO)
            fuel = [separar_de_cajas(p, cajas_previas) for p in fuel]

    w('    <model name="ground_plane">')
    w("      <static>true</static>")
    w('      <link name="link">')
    w('        <collision name="collision">')
    w("          <geometry><plane><normal>0 0 1</normal></plane></geometry>")
    w("          <surface><friction><ode><mu>0.9</mu><mu2>0.9</mu2></ode></friction></surface>")
    w("        </collision>")
    if campo is None:
        # Con la cancha puesta el suelo pierde su visual: dos superficies en
        # z = 0 producen z-fighting, ese parpadeo a franjas que parece un fallo
        # del renderizador y es geometria duplicada.
        w('        <visual name="visual">')
        w("          <geometry><plane><normal>0 0 1</normal><size>16.54 8.21</size></plane></geometry>")
        w("          <material><ambient>0.16 0.17 0.19 1</ambient><diffuse>0.30 0.32 0.36 1</diffuse></material>")
        w("        </visual>")
    w("      </link>")
    w("    </model>")
    w("")

    if campo is not None:
        # 90 grados de roll porque el glTF viene Y-arriba y Gazebo es Z-arriba.
        w('    <model name="frc_field">')
        w("      <static>true</static>")
        w("      <pose>0 0 0 1.570796 0 0</pose>")
        w('      <link name="link">')
        w('        <visual name="visual">')
        w("          <cast_shadows>false</cast_shadows>")
        w(f"          <geometry><mesh><uri>{campo}</uri></mesh></geometry>")
        w("        </visual>")
        w("      </link>")
        w("    </model>")
        w("")

    if HITBOXES and hay_campo:
        cajas = hitboxes(SIM / CAMPO)
        w("    <!-- La FISICA de la cancha: la malla de arriba no tiene colision")
        w("         ninguna, asi que sin estas cajas el robot atraviesa la pared")
        w("         de la estacion y el HUB conduciendo.")
        w("")
        w("         Las medidas salen de los AABB de los nodos del glTF oficial,")
        w("         no de una tabla a mano. Cuales entran y por que el trench y")
        w("         los bumps NO estan: worlds/cancha_2026.py. -->")
        w('    <model name="field_collision">')
        w("      <static>true</static>")
        w('      <link name="link">')
        # OJO con los nombres: `cx, cy, cz` son el tamano del CHASIS y se usan
        # mas abajo. Reusarlos aqui le daba al robot una caja de colision de
        # 3.49 x -0.005 x 1.54 --- que sdformat rechaza por negativa y sustituye
        # por 1x1x1, o sea un chasis de un metro medio enterrado en el suelo. El
        # robot se quedaba clavado quemando rueda y el unico rastro era un
        # warning de sdformat en medio del arranque.
        for nombre, (hx, hy, hz), (dx, dy, dz), (rr, rp, ry) in cajas:
            caja = f"<box><size>{dx:.4f} {dy:.4f} {dz:.4f}</size></box>"
            pose = f"{hx:.4f} {hy:.4f} {hz:.4f} {rr:.5f} {rp:.5f} {ry:.5f}"
            w(f'        <collision name="{nombre}">')
            w(f"          <pose>{pose}</pose>")
            w(f"          <geometry>{caja}</geometry>")
            w("        </collision>")
            if HITBOXES_VISIBLES:
                w(f'        <visual name="{nombre}_visual">')
                w(f"          <pose>{pose}</pose>")
                w(f"          <geometry>{caja}</geometry>")
                w("          <transparency>0.65</transparency>")
                w("          <material>")
                w("            <ambient>0.91 0.39 0.16 0.35</ambient>")
                w("            <diffuse>0.91 0.39 0.16 0.35</diffuse>")
                w("          </material>")
                w("        </visual>")
        w("      </link>")
        w("    </model>")
        w("")

    if fuel:
        w(f"    <!-- {len(fuel)} FUEL con fisica, en el sitio exacto en el que la")
        w("         malla de la cancha las dibujaba: las posiciones salen de los")
        w("         nodos del glTF, no de una tabla escrita a mano. Son las mas")
        w("         cercanas al spawn del robot; las del feeder no estan.")
        w("")
        w("         Cada una es un cuerpo dinamico: con 408 el mundo va a medio")
        w("         tiempo real y no se puede conducir. La cuenta esta en FUEL,")
        w("         en gen_swerve.py. -->")
        for i, (x, y, z) in enumerate(fuel, 1):
            w("    <include>")
            w("      <uri>model://fuel</uri>")
            w(f"      <name>fuel_{i:03d}</name>")
            w(f"      <pose>{x:.4f} {y:.4f} {max(z, RADIO_FUEL):.4f} 0 0 0</pose>")
            w("    </include>")
        w("")
    w('    <model name="robot">')
    w(f"      <pose>{' '.join(str(v) for v in ROBOT_POSE)}</pose>")
    w("")
    w('      <link name="chassis">')
    w(f"        <pose>0 0 {Z_CHASIS} 0 0 0</pose>")
    w("        <inertial>")
    w(f"          <mass>{M_CHASIS}</mass>")
    w(f"          <inertia><ixx>{ix:.4f}</ixx><iyy>{iy:.4f}</iyy><izz>{iz:.4f}</izz>")
    w("            <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz></inertia>")
    w("        </inertial>")
    w(f'        <collision name="collision"><geometry><box><size>{cx} {cy} {cz}</size></box></geometry></collision>')
    w('        <visual name="visual">')
    w(f"          <geometry><box><size>{cx} {cy} {cz}</size></box></geometry>")
    w("          <material>")
    w("            <ambient>0.35 0.15 0.06 1</ambient>")
    w("            <diffuse>0.91 0.39 0.16 1</diffuse>")
    w("            <specular>0.3 0.3 0.3 1</specular>")
    w("          </material>")
    w("        </visual>")
    w("      </link>")

    for lado, x, y in ESQUINAS:
        w("")
        w(f"      <!-- modulo {lado} -->")
        w(f'      <link name="{lado}_steer">')
        w(f"        <pose>{x} {y} 0.12 0 0 0</pose>")
        w("        <inertial>")
        w(f"          <mass>{M_STEER}</mass>")
        w(f"          <inertia><ixx>{six:.6f}</ixx><iyy>{siy:.6f}</iyy><izz>{siz:.6f}</izz>")
        w("            <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz></inertia>")
        w("        </inertial>")
        w('        <visual name="visual">')
        w("          <geometry><cylinder><radius>0.05</radius><length>0.12</length></cylinder></geometry>")
        w("          <material><ambient>0.25 0.26 0.3 1</ambient><diffuse>0.62 0.65 0.72 1</diffuse></material>")
        w("        </visual>")
        w("      </link>")
        w("")
        w(f'      <link name="{lado}_wheel">')
        w(f"        <pose>{x} {y} {R_RUEDA} -1.5707963 0 0</pose>")
        w("        <inertial>")
        w(f"          <mass>{M_RUEDA}</mass>")
        w(f"          <inertia><ixx>{rix:.6f}</ixx><iyy>{riy:.6f}</iyy><izz>{riz:.6f}</izz>")
        w("            <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz></inertia>")
        w("        </inertial>")
        w('        <collision name="collision">')
        w(f"          <geometry><cylinder><radius>{R_RUEDA}</radius><length>{ANCHO_RUEDA}</length></cylinder></geometry>")
        w("          <surface><friction><ode><mu>1.1</mu><mu2>1.1</mu2></ode></friction></surface>")
        w("        </collision>")
        w('        <visual name="visual">')
        w(f"          <geometry><cylinder><radius>{R_RUEDA}</radius><length>{ANCHO_RUEDA}</length></cylinder></geometry>")
        w("          <material><ambient>0.05 0.05 0.06 1</ambient><diffuse>0.13 0.13 0.15 1</diffuse></material>")
        w("        </visual>")
        w("      </link>")
        w("")
        w(f'      <joint name="{lado}_steer_joint" type="revolute">')
        w(f"        <parent>chassis</parent><child>{lado}_steer</child>")
        w("        <axis><xyz>0 0 1</xyz>")
        w(f"          <dynamics><damping>{DAMPING_DIRECCION}</damping></dynamics>")
        w("          <limit><lower>-1e16</lower><upper>1e16</upper></limit></axis>")
        w("      </joint>")
        w(f'      <joint name="{lado}_drive_joint" type="revolute">')
        w(f"        <parent>{lado}_steer</parent><child>{lado}_wheel</child>")
        w("        <axis><xyz>0 0 1</xyz>")
        w(f"          <dynamics><damping>{DAMPING_TRACCION}</damping></dynamics>")
        w("          <limit><lower>-1e16</lower><upper>1e16</upper></limit></axis>")
        w("      </joint>")

    w("")
    w("      <!-- El ORDEN es el contrato: define el indice dentro de")
    w("           gz.msgs.Actuators.normalized. El robot-map lista los suyos en")
    w("           el mismo orden y check.py lo verifica.")
    w("")
    w(f"           Limite de corriente: {LIMITE_TRACCION} A en traccion (la de")
    w("           deslizamiento, calculada de la masa y el mu) y")
    w(f"           {LIMITE_DIRECCION} A en direccion.")
    w("")
    w(f"           Reducciones reales del robot: {RED_TRACCION} de traccion,")
    w(f"           {RED_DIRECCION:.3f} de direccion. Salen de TunerConstants.java. -->")
    w('      <plugin filename="MarsLink" name="mars::MarsLink">')
    for lado, _, _ in ESQUINAS:
        # neutralMode="coast": sin comando, el motor abre el circuito y la
        # rueda gira libre, como un TalonFX de fabrica. Con "brake" el robot
        # frena al limite de agarre en cuanto el piloto suelta el stick.
        w(f'        <actuator joint="{lado}_drive_joint" motor="kraken_x60"'
          f' gearRatio="{RED_TRACCION}" currentLimit="{LIMITE_TRACCION}"'
          f' neutralMode="{NEUTRO_TRACCION}"/>')
        # La direccion cierra POSICION en el motor, como un TalonFX real. El
        # codigo del robot le manda un angulo, no un duty.
        w(f'        <actuator joint="{lado}_steer_joint" motor="kraken_x60"'
          f' gearRatio="{RED_DIRECCION}" control="position"'
          f' currentLimit="{LIMITE_DIRECCION}"'
          f' kp="{KP_DIRECCION}" kd="{KD_DIRECCION}"/>')
    w("      </plugin>")
    w("    </model>")
    w("")
    w("  </world>")
    w("</sdf>")
    return "\n".join(L) + "\n"


def generar_robot_map():
    actuadores, encoders = [], []
    for lado, _, _ in ESQUINAS:
        # El orden tiene que ser el mismo que el de los <actuator> del SDF.
        for tipo, red in (("drive", RED_TRACCION), ("steer", RED_DIRECCION)):
            nombre = f"{lado}_{tipo}"
            actuadores.append({
                "name": nombre,
                "joint": f"{nombre}_joint",
                "motor": "kraken_x60",
                "gearRatio": red,
                "inverted": False,
                # La direccion va en modo posicion; la traccion, a duty. Tiene
                # que coincidir con el atributo `control` del SDF y check.py lo
                # verifica: si divergen, el motor lee un campo que el bridge no
                # llena y el actuador se queda quieto sin ningun error.
                "control": "position" if tipo == "steer" else "duty",
                "hal": {"kind": "pwm", "channel": len(actuadores)},
            })
            encoders.append({
                "name": f"{nombre}_enc",
                "joint": f"{nombre}_joint",
                "countsPerRevolution": CPR,
                "hal": {"kind": "encoder", "index": len(encoders)},
            })

    return {
        "$comment": "GENERADO por sim/worlds/gen_swerve.py junto con swerve.sdf. "
                    "Se generan del mismo script para que el ORDEN de actuadores "
                    "no pueda divergir entre los dos.",
        "protocol": "0.1.0",
        "robot": "swerve",
        "world": "mars",
        "model": "robot",
        "profile": "vendor",
        "$comment_profile": "vendor: motores CAN (Kraken sobre TalonFX). El lazo "
                            "de hardware va por el glue sobre NT4 porque HALSim "
                            "WebSocket no cubre CAN.",
        "sdf": "worlds/swerve.sdf",
        "base_link": "chassis",
        "actuators": actuadores,
        "encoders": encoders,
        "$comment_imu": "Sin IMU todavia: el yaw sale de la pose real. Un "
                        "giroscopio perfecto esconde errores de odometria, asi "
                        "que agregar el <sensor type=\"imu\"> con ruido es el "
                        "siguiente paso de fidelidad.",
        "imu": None,
    }


# --- las opciones, declaradas una sola vez --------------------------------
#
# Esta lista es la fuente de la que salen LAS TRES formas de tocar el mundo: las
# banderas de la linea de comandos, el `--opciones` que lee MARS Simulation
# Studio para dibujar su panel, y los valores por defecto de arriba.
#
# Declararlas una vez y generar el resto no es comodidad: una opcion que existe
# en la terminal y no en la app --- o al reves --- es una opcion que alguien va
# a buscar donde no esta. `tipo` es lo que la app necesita para saber que
# control pintar.
OPCIONES = [
    {
        "nombre": "fuel",
        "etiqueta": "Physical FUEL",
        "tipo": "entero",
        "min": 0,
        "max": 408,
        "unidad": "balls",
        "ayuda": "How many FUEL are seeded with real physics, nearest the robot"
                 " first. 408 is every one inside the field and takes the"
                 " real-time factor down to 0.48, which is not driveable.",
    },
    {
        "nombre": "fuel_decorativas",
        "etiqueta": "Keep the painted FUEL",
        "tipo": "bool",
        "ayuda": "The field mesh ships 456 FUEL baked in: no collision, no mass."
                 " Only worth it with 0 physical ones, or you see two balls in"
                 " every spot.",
    },
    {
        "nombre": "campo_visual",
        "etiqueta": "Field mesh",
        "tipo": "opcion",
        "opciones": [
            ["lite", "Lite - trimmed, 2.3 M triangles"],
            ["completo", "Full - every modelled rivet, 4.0 M"],
            ["ninguno", "None - plain carpet"],
        ],
        "ayuda": "The visual only. Collision boxes are the same in all three:"
                 " with None you still have walls, HUB and ramps, just nothing"
                 " drawn. It is the lever for a machine that struggles.",
    },
    {
        "nombre": "hitboxes",
        "etiqueta": "Field collision",
        "tipo": "bool",
        "ayuda": "Guardrails, the six driver stations, towers, outposts, both"
                 " HUBs and the four ramps. Off means the robot drives through"
                 " the field.",
    },
    {
        "nombre": "hitboxes_visibles",
        "etiqueta": "Draw the collision boxes",
        "tipo": "bool",
        "ayuda": "Translucent over the mesh, to check a box lands where it"
                 " should. In the way while driving.",
    },
    {
        "nombre": "neutro_traccion",
        "etiqueta": "Drive neutral mode",
        "tipo": "opcion",
        "opciones": [["coast", "Coast - the wheel spins free"],
                     ["brake", "Brake - the motor shorts itself"]],
        "ayuda": "What the drive motors do with no command. Coast is a stock"
                 " TalonFX. Brake stops the robot at 8.8 m/s^2 -- the whole grip"
                 " of the carpet -- every time the stick is centred, and that"
                 " reads as a robot made of lead.",
    },
]


def _valores():
    """Los valores actuales de todo lo que declara OPCIONES."""
    aqui = globals()
    return {o["nombre"]: aqui[o["nombre"].upper()] for o in OPCIONES}


def _aplicar(valores):
    """Mete valores del manifiesto en las constantes del modulo."""
    aqui = globals()
    for o in OPCIONES:
        if o["nombre"] not in valores:
            continue
        v = valores[o["nombre"]]
        if o["tipo"] == "entero":
            v = max(o.get("min", 0), min(o.get("max", 10 ** 9), int(v)))
        elif o["tipo"] == "bool":
            v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes")
        elif o["tipo"] == "opcion":
            validos = [x[0] for x in o["opciones"]]
            if v not in validos:
                raise SystemExit(f"{o['nombre']}: {v!r} no es uno de {validos}")
        aqui[o["nombre"].upper()] = v


if __name__ == "__main__":
    # Las banderas son para no tener que editar el archivo cada vez que se
    # quiere mirar una cosa: los valores de arriba son el defecto.
    import argparse

    cli = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    cli.add_argument("--fuel", dest="fuel", type=int, metavar="N", default=None,
                     help=f"how many physical FUEL to seed (default {FUEL}); "
                          "408 is every one inside the field and drops the "
                          "real-time factor to 0.48")
    cli.add_argument("--no-fuel", dest="fuel", action="store_const", const=0,
                     help="no physical FUEL")
    cli.add_argument("--decorative-fuel", dest="deco", action="store_true", default=None,
                     help="keep the 456 FUEL baked into the field mesh (visual only)")
    cli.add_argument("--hitboxes", dest="hitboxes", action="store_true", default=None,
                     help="field collision boxes (default)")
    cli.add_argument("--no-hitboxes", dest="hitboxes", action="store_false",
                     help="no field collision: the robot drives through walls")
    cli.add_argument("--field-mesh", dest="malla", default=None,
                     choices=("lite", "full", "none"),
                     help="lite (default): the trimmed field, half the triangles "
                          "and half the draw calls. full: every modelled rivet. "
                          "none: no field visual at all -- collision boxes stay "
                          "either way")
    cli.add_argument("--no-field-mesh", dest="malla", action="store_const", const="none",
                     help="same as --field-mesh none")
    cli.add_argument("--show-hitboxes", dest="ver", action="store_true", default=None,
                     help="draw the collision boxes translucent over the mesh")
    cli.add_argument("--hide-hitboxes", dest="ver", action="store_false",
                     help="collision only, nothing drawn (default)")
    cli.add_argument("--neutral-mode", dest="neutro", default=None,
                     choices=("coast", "brake"),
                     help="what the drive motors do with no command (default "
                          f"{NEUTRO_TRACCION})")
    # Las dos de abajo son para MARS Simulation Studio, no para escribirlas a
    # mano: con --opciones lee que se puede tocar y con --set lo cambia.
    cli.add_argument("--opciones", action="store_true",
                     help="print this generator's options as JSON and exit")
    cli.add_argument("--set", dest="sets", action="append", metavar="CLAVE=VALOR",
                     default=[], help="set one option by name; repeatable")
    args = cli.parse_args()

    if args.opciones:
        # Solo el JSON por stdout: lo parsea la app.
        print(json.dumps({
            "archivo": "swerve",
            "genera": ["worlds/swerve.sdf", "models/swerve/robot-map.json"],
            "opciones": [dict(o, defecto=_valores()[o["nombre"]]) for o in OPCIONES],
        }, indent=2))
        raise SystemExit(0)

    if args.fuel is not None:
        FUEL = max(0, args.fuel)
    if args.deco is not None:
        FUEL_DECORATIVAS = args.deco
    if args.malla is not None:
        CAMPO_VISUAL = {"lite": "lite", "full": "completo",
                        "none": "ninguno"}[args.malla]
    if args.hitboxes is not None:
        HITBOXES = args.hitboxes
    if args.ver is not None:
        HITBOXES_VISIBLES = args.ver
    if args.neutro is not None:
        NEUTRO_TRACCION = args.neutro

    if args.sets:
        crudos = {}
        for par in args.sets:
            if "=" not in par:
                raise SystemExit(f"--set espera CLAVE=VALOR, no {par!r}")
            clave, _, valor = par.partition("=")
            crudos[clave.strip()] = valor.strip()
        _aplicar(crudos)

    sdf = SIM / "worlds" / "swerve.sdf"
    io.open(sdf, "w", encoding="utf-8", newline="\n").write(generar_sdf())
    print(f"escrito {sdf.relative_to(SIM)}")

    mapa = SIM / "models" / "swerve" / "robot-map.json"
    mapa.parent.mkdir(parents=True, exist_ok=True)
    io.open(mapa, "w", encoding="utf-8", newline="\n").write(
        json.dumps(generar_robot_map(), indent=2, ensure_ascii=False) + "\n"
    )
    print(f"escrito {mapa.relative_to(SIM)}")
