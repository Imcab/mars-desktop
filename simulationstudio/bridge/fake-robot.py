#!/usr/bin/env python3
"""Codigo de robot de mentira: hace el papel del glue del perfil `vendor`.

    python simulationstudio/bridge/fake-robot.py <robot-map.json> [segundos]

Ocupa el lugar del `simulationPeriodic` de un robot real:

  1. levanta el servidor NT4, como hace ntcore dentro del codigo del robot;
  2. publica el duty que "el vendor le esta aplicando" a cada motor;
  3. lee de vuelta posicion, velocidad y yaw que devuelve la fisica.

Y despues verifica que el circulo se cerro. Ese circulo es lo unico que este
arnes prueba y lo unico que no se puede probar por partes:

    robot -> bridge -> motor -> fisica -> motor -> bridge -> robot

En un swerve, las direcciones van en modo `position`: el arnes les manda un
angulo y el MOTOR cierra el lazo, igual que un TalonFX. Comprobar que el modulo
llega al angulo pedido y se queda ahi es lo que verifica que la consigna viaja,
que las unidades son las que dice el contrato y que el lazo del motor funciona.

Requiere:  pip install pyntcore
"""
import json
import math
import os
import sys
import time

import ntcore

# Los prefijos son parte del contrato; viven en [[glue]] de topics.toml.
SALIDA = "/MARS/Glue/out"
ENTRADA = "/MARS/Glue/in"

# Las direcciones en modo `position` NO llevan lazo aqui: se les manda un angulo
# y el motor cierra el lazo a la tasa de la fisica, igual que un TalonFX con
# Motion Magic. Esta es la diferencia entre este arnes y el intento anterior,
# que trataba de sujetarlas con duty desde aqui y no podia: una direccion 12.8:1
# con Kraken tiene 90 N*m sobre 0.008 kg*m^2, y ningun lazo sobre la red -- ni a
# 50 Hz ni a 250 -- tiene autoridad sobre eso.
#
# Consigna mientras se conduce: modulos al frente.
ANGULO_DIRECCION_RAD = 0.0

# Despues se les pide girar a este angulo, con el robot quieto. Sujetar el cero
# ya prueba bastante -- las direcciones sufren una perturbacion real cuando el
# robot acelera -- pero solo pedirles un angulo DISTINTO prueba que la consigna
# viaja de verdad y que las unidades son las que dice el contrato. Un lazo que
# ignorara la consigna y sujetara siempre el cero pasaria la primera prueba.
ANGULO_OBJETIVO_RAD = 0.6           # 34 grados
TOLERANCIA_OBJETIVO_RAD = 0.05      # 3 grados

# Cuanto puede desviarse una direccion y seguir considerandose sujeta.
TOLERANCIA_DIRECCION_RAD = 0.35

# El robot conduce recto, asi que el yaw no deberia moverse mucho. Margen
# amplio: las ruedas patinan al arrancar a plena potencia.
YAW_MAX_DEG = 25.0

# 20 ms, el ciclo de un robot de WPILib. Se puede bajar con MARS_PERIODO para
# distinguir "el lazo es lento" de "el modelo esta mal".
PERIODO_S = float(os.environ.get("MARS_PERIODO", "0.02"))


def main(ruta_mapa: str, duracion_s: float) -> int:
    mapa = json.load(open(ruta_mapa, encoding="utf-8"))
    if mapa["profile"] != "vendor":
        print(f"FALLA: este arnes es del perfil vendor, no de {mapa['profile']!r}",
              file=sys.stderr)
        return 1

    # Las direcciones se controlan en posicion y las tracciones a potencia
    # abierta. Se distinguen por el nombre del joint, que es lo que el robot-map
    # ya usa como convencion.
    direcciones = [a for a in mapa["actuators"] if "steer" in a["name"]]
    tracciones = [a for a in mapa["actuators"] if a not in direcciones]
    print(f"[robot] {mapa['robot']}: {len(tracciones)} tracciones,"
          f" {len(direcciones)} direcciones")

    # Comprobar el puerto ANTES de arrancar. `startServer` sobre un puerto
    # ocupado no falla ni avisa: se queda callado, los clientes se conectan al
    # OTRO servidor --- normalmente el codigo del robot de verdad --- y no ven
    # ninguno de estos topicos. El sintoma aparece a metros de la causa.
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", 5810)) == 0:
            print(
                "FALLA: ya hay un servidor NT4 en el puerto 5810."
                + "\n       Casi seguro es tu codigo del robot (simulateJava)."
                + "\n       Este arnes HACE de codigo del robot, asi que no pueden"
                + "\n       correr los dos: cerra uno.",
                file=sys.stderr,
            )
            return 1

    inst = ntcore.NetworkTableInstance.getDefault()
    inst.startServer()
    print("[robot] servidor NT4 escuchando")

    nombres = [a["name"] for a in mapa["actuators"]]
    reduccion = {a["name"]: a.get("gearRatio", 1.0) for a in mapa["actuators"]}

    # --- lo que el glue PUBLICA (lo que el vendor aplica a cada motor) ----
    habilitado = inst.getBooleanTopic(f"{SALIDA}/enabled").publish()
    duty = {n: inst.getDoubleTopic(f"{SALIDA}/{n}/duty").publish() for n in nombres}
    setpoint = {n: inst.getDoubleTopic(f"{SALIDA}/{n}/setpoint").publish() for n in nombres}

    # --- lo que el glue LEE (lo que la fisica devuelve) -------------------
    pos = {n: inst.getDoubleTopic(f"{ENTRADA}/{n}/position").subscribe(0.0) for n in nombres}
    vel = {n: inst.getDoubleTopic(f"{ENTRADA}/{n}/velocity").subscribe(0.0) for n in nombres}
    yaw = inst.getDoubleTopic(f"{ENTRADA}/gyro/yaw").subscribe(0.0)

    def angulo_modulo(nombre: str) -> float:
        """Posicion del modulo en radianes, deshaciendo la reduccion.

        El contrato entrega las posiciones en el eje del MOTOR; el lazo de
        direccion razona en el angulo del modulo, que es lo fisico.
        """
        return pos[nombre].get() / reduccion[nombre]

    # Deshabilitado primero, a proposito: si algo se moviera aqui seria que el
    # motor ignora el estado de partido. Un robot con el DS apagado rueda libre.
    #
    # Las direcciones reciben su consigna ya aqui, para que al habilitar el
    # motor no arranque persiguiendo un objetivo que nadie le dio.
    habilitado.set(False)
    for a in tracciones:
        duty[a["name"]].set(1.0)
    for a in direcciones:
        setpoint[a["name"]].set(0.0)
    time.sleep(2.0)
    pos_quieto = {n: pos[n].get() for n in nombres}
    vel_quieto = max(abs(vel[n].get()) for n in nombres)
    print(f"[robot] deshabilitado con duty 1.0: velocidad maxima {vel_quieto:.3f} rad/s")

    # --- habilitar y conducir --------------------------------------------
    habilitado.set(True)
    print(f"[robot] habilitado, conduciendo {duracion_s:.0f} s")
    fin = time.time() + duracion_s
    vel_max = 0.0
    desvio_max = 0.0
    ultimo_debug = 0.0
    while time.time() < fin:
        for a in tracciones:
            duty[a["name"]].set(1.0)
        # A las direcciones se les manda la CONSIGNA, en radianes del motor.
        # Que el modulo llegue y se quede es trabajo del motor.
        for a in direcciones:
            n = a["name"]
            setpoint[n].set(ANGULO_DIRECCION_RAD * reduccion[n])
            desvio_max = max(desvio_max, abs(angulo_modulo(n) - ANGULO_DIRECCION_RAD))

        time.sleep(PERIODO_S)
        vel_max = max(vel_max, max(abs(vel[a["name"]].get()) for a in tracciones))

        if os.environ.get("MARS_DEBUG") and direcciones:
            ahora = time.time()
            if ahora - ultimo_debug > 0.5:
                ultimo_debug = ahora
                n = direcciones[0]["name"]
                print(f"[dbg] {n}: ang={math.degrees(angulo_modulo(n)):+8.1f} deg"
                      f"  vel={vel[n].get() / reduccion[n]:+7.2f} rad/s"
                      f"  duty={duty[n].get() if hasattr(duty[n], 'get') else float('nan'):+.3f}"
                      f"  yaw={yaw.get():+7.1f}")

    pos_final = {n: pos[n].get() for n in nombres}
    yaw_final = yaw.get()

    # --- apuntar a un angulo distinto -------------------------------------
    # Con la traccion parada, para que el unico movimiento sea el de las
    # direcciones y el resultado no dependa de la dinamica del chasis.
    angulos_alcanzados = {}
    if direcciones:
        for a in tracciones:
            duty[a["name"]].set(0.0)
        for a in direcciones:
            setpoint[a["name"]].set(ANGULO_OBJETIVO_RAD * reduccion[a["name"]])
        print(f"[robot] apuntando a {math.degrees(ANGULO_OBJETIVO_RAD):.0f} grados")
        time.sleep(2.0)
        angulos_alcanzados = {a["name"]: angulo_modulo(a["name"]) for a in direcciones}

    habilitado.set(False)
    time.sleep(0.3)

    fallos = []

    # --- el estado de partido se respeta ---------------------------------
    if vel_quieto > 1.0:
        fallos.append(f"deshabilitado giraba a {vel_quieto:.2f} rad/s:"
                      " el motor ignora /mars/cmd/match")

    # --- el circulo se cerro ---------------------------------------------
    print(f"[robot] velocidad maxima de traccion: {vel_max:.1f} rad/s (eje del motor)")
    if vel_max < 10.0:
        fallos.append(f"las ruedas apenas giraron ({vel_max:.2f} rad/s): el duty"
                      " no llego al motor, o su estado no volvio")

    for a in tracciones:
        n = a["name"]
        avance = pos_final[n] - pos_quieto[n]
        vueltas = avance / (2 * math.pi)
        print(f"[robot] {n}: {vueltas:+.1f} vueltas de motor (reduccion {reduccion[n]})")
        if avance <= 0.0:
            fallos.append(f"{n} no avanzo ({avance:+.3f} rad)")

    # --- el lazo de posicion sujeto ---------------------------------------
    if direcciones:
        print(f"[robot] desvio maximo de direccion: {math.degrees(desvio_max):.1f} grados")
        if desvio_max > TOLERANCIA_DIRECCION_RAD:
            fallos.append(
                f"el lazo de direccion no sujeto: {math.degrees(desvio_max):.1f}"
                " grados de desvio. La realimentacion de posicion llega mal, o"
                " en otras unidades"
            )

    for n, ang in angulos_alcanzados.items():
        error = ang - ANGULO_OBJETIVO_RAD
        print(f"[robot] {n}: llego a {math.degrees(ang):+.1f} grados"
              f" ({math.degrees(error):+.1f} de error)")
        if abs(error) > TOLERANCIA_OBJETIVO_RAD:
            fallos.append(
                f"{n} no alcanzo la consigna: {math.degrees(ang):+.1f} grados"
                f" en vez de {math.degrees(ANGULO_OBJETIVO_RAD):.0f}"
            )

    print(f"[robot] yaw = {yaw_final:.1f} grados")
    if abs(yaw_final) > YAW_MAX_DEG:
        fallos.append(f"el robot giro {yaw_final:.1f} grados conduciendo recto")

    for f in fallos:
        print(f"FALLA: {f}", file=sys.stderr)
    if fallos:
        return 1
    print("[robot] OK: el circulo robot -> bridge -> fisica -> bridge -> robot cerro")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    codigo = main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 4.0)
    # os._exit: ntcore deja hilos de C++ corriendo y su teardown durante la
    # finalizacion del interprete devuelve un codigo que no es el nuestro.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(codigo)
