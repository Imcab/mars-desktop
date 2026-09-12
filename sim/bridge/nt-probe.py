#!/usr/bin/env python3
"""Levanta un servidor NT4 de verdad y verifica lo que publica el bridge.

    python sim/bridge/nt-probe.py [segundos] [avance_minimo_m]

Con `avance_minimo_m` exige ademas que la pose SIGA al robot: hay que conducirlo
en paralelo. Sin ese argumento solo comprueba la pose estatica.

Usa `ntcore` de WPILib -- la implementacion de REFERENCIA, la misma que corre
en un roboRIO -- en vez de comprobar el bridge contra codigo nuestro. Si el
formato de cable tuviera un error, un test escrito por nosotros podria
compartir el mismo malentendido; ntcore no.

Hace de servidor porque en simulacion el servidor NT4 lo levanta el codigo del
robot, no el bridge ni la app. Aqui ocupa ese lugar.

Requiere:  pip install pyntcore
"""
import os
import struct
import sys
import time

import ntcore

# Estos valores salen de sim/protocol/topics.toml y de las dimensiones de la
# cancha. El robot arranca en el origen de Gazebo, que es el CENTRO del campo,
# asi que en el marco de WPILib le toca la mitad de cada dimension.
CENTRO_X = 16.54 / 2
CENTRO_Y = 8.21 / 2
TOLERANCIA_M = 0.30  # el robot se asienta unos centimetros al aparecer

SCHEMAS_ESPERADOS = [
    "Translation2d", "Rotation2d", "Pose2d",
    "Translation3d", "Quaternion", "Rotation3d", "Pose3d",
]


def main(duracion_s: float, avance_minimo_m: float) -> int:
    inst = ntcore.NetworkTableInstance.getDefault()
    inst.startServer()
    print(f"[nt] servidor NT4 escuchando, {duracion_s:.0f} s")

    pose2d = inst.getRawTopic("/MARS/Sim/truthPose").subscribe("struct:Pose2d", b"")
    pose3d = inst.getRawTopic("/MARS/Sim/truthPose3d").subscribe("struct:Pose3d", b"")
    field = inst.getDoubleArrayTopic("/SmartDashboard/Field/Robot").subscribe([])
    estado = inst.getStringTopic("/MARS/Sim/state").subscribe("")
    rtf = inst.getDoubleTopic("/MARS/Sim/realTimeFactor").subscribe(0.0)
    sim_t = inst.getDoubleTopic("/MARS/Sim/simTime").subscribe(0.0)
    schemas = {
        n: inst.getRawTopic(f"/.schema/struct:{n}").subscribe("structschema", b"")
        for n in SCHEMAS_ESPERADOS
    }

    xs, rtfs, tiempos = [], [], []
    fin = time.time() + duracion_s
    while time.time() < fin:
        time.sleep(0.1)
        raw = pose2d.get()
        if len(raw) == 24:
            x, _y, _th = struct.unpack("<ddd", raw)
            xs.append(x)
        if (v := rtf.get()) > 0:
            rtfs.append(v)
        if (t := sim_t.get()) > 0:
            tiempos.append(t)

    fallos = []

    # --- schemas ---------------------------------------------------------
    # Sin descriptor publicado, la app recibe un blob que no puede decodificar.
    for nombre, sub in schemas.items():
        d = sub.get()
        if not d:
            fallos.append(f"falta el schema de {nombre}")
        else:
            print(f"[nt] schema {nombre}: {d.decode()}")

    # --- Pose2d ----------------------------------------------------------
    raw = pose2d.get()
    if len(raw) != 24:
        fallos.append(f"truthPose son {len(raw)} bytes, se esperaban 24")
    else:
        x, y, th = struct.unpack("<ddd", raw)
        print(f"[nt] Pose2d = ({x:.3f}, {y:.3f}, {th:.3f} rad)")
        # El robot puede haberse movido en X si algo lo condujo, pero en Y no
        # deberia irse del centro.
        if abs(y - CENTRO_Y) > TOLERANCIA_M:
            fallos.append(f"y={y:.3f} lejos del centro {CENTRO_Y:.3f}")

    # La traslacion se comprueba contra la PRIMERA muestra, no contra la
    # ultima: el robot arranca en el origen de Gazebo, que es el centro del
    # campo, y de ahi sale el valor exacto que debe publicar el bridge. Un
    # rango amplio no sirve porque el mundo no tiene muros -- el plano de
    # colision es infinito -- y el robot puede salirse de la cancha
    # legitimamente.
    if xs:
        if abs(xs[0] - CENTRO_X) > TOLERANCIA_M:
            fallos.append(
                f"la primera x fue {xs[0]:.3f}, se esperaba el centro"
                f" {CENTRO_X:.3f}: la traslacion esta mal"
            )
        if min(xs) < -TOLERANCIA_M:
            fallos.append(
                f"x llego a {min(xs):.3f}: en el marco de WPILib el origen es"
                " la esquina, no el centro"
            )

    # --- Pose3d ----------------------------------------------------------
    raw3 = pose3d.get()
    if len(raw3) != 56:
        fallos.append(f"truthPose3d son {len(raw3)} bytes, se esperaban 56")
    else:
        x3, y3, z3, qw, qx, qy, qz = struct.unpack("<ddddddd", raw3)
        print(f"[nt] Pose3d = ({x3:.3f}, {y3:.3f}, {z3:.3f}) q=({qw:.3f},{qx:.3f},{qy:.3f},{qz:.3f})")
        # Un quaternion que no sea unitario significa que se mando otra cosa
        # (por ejemplo roll/pitch/yaw) en el hueco de la rotacion.
        norma = (qw * qw + qx * qx + qy * qy + qz * qz) ** 0.5
        if abs(norma - 1.0) > 1e-6:
            fallos.append(f"el quaternion no es unitario (norma {norma:.6f})")
        if abs(x3 - x) > 1e-9 or abs(y3 - y) > 1e-9:
            fallos.append("Pose2d y Pose3d no coinciden en X/Y")

    # --- Field2d ---------------------------------------------------------
    f = field.get()
    if len(f) != 3:
        fallos.append(f"Field/Robot tiene {len(f)} elementos, se esperaban 3")
    else:
        print(f"[nt] Field2d = [{f[0]:.3f}, {f[1]:.3f}, {f[2]:.1f} deg]")
        if abs(f[0] - x) > 1e-9:
            fallos.append("Field2d y truthPose no coinciden en X")
        # Field2d va en GRADOS y el struct en radianes: si alguien copia el
        # valor de uno al otro, esto lo atrapa.
        import math
        if abs(f[2] - math.degrees(th)) > 1e-6:
            fallos.append(f"Field2d theta={f[2]:.3f} no son los grados de {th:.3f} rad")

    # --- salud -----------------------------------------------------------
    print(f"[nt] estado = {estado.get()!r}")
    if estado.get() not in ("running", "paused"):
        fallos.append(f"estado inesperado: {estado.get()!r}")
    if not tiempos:
        fallos.append("nunca llego simTime")
    elif tiempos[-1] <= tiempos[0]:
        fallos.append("simTime no avanzo: la simulacion esta detenida")
    if not rtfs:
        fallos.append("nunca llego realTimeFactor")
    else:
        medio = sum(rtfs) / len(rtfs)
        print(f"[nt] real-time factor medio = {medio:.2f} ({len(rtfs)} muestras)")

    if xs:
        recorrido = max(xs) - min(xs)
        print(f"[nt] x recorrio [{min(xs):.3f}, {max(xs):.3f}] = {recorrido:.3f} m"
              f" en {len(xs)} muestras")
        # Con algo conduciendo el robot en paralelo, una pose que no cambia
        # significa que el bridge publico una vez y se quedo pegado -- un fallo
        # que una comprobacion estatica no distingue de funcionar bien.
        if avance_minimo_m > 0 and recorrido < avance_minimo_m:
            fallos.append(
                f"la pose no siguio al robot: {recorrido:.3f} m < {avance_minimo_m} m"
            )

    for f_ in fallos:
        print(f"FALLA: {f_}", file=sys.stderr)
    if fallos:
        return 1
    print("[nt] OK: el bridge habla NT4 correctamente contra ntcore de WPILib")
    return 0


if __name__ == "__main__":
    codigo = main(
        float(sys.argv[1]) if len(sys.argv) > 1 else 12.0,
        float(sys.argv[2]) if len(sys.argv) > 2 else 0.0,
    )
    # os._exit en vez de sys.exit: ntcore es una extension nativa que deja un
    # servidor corriendo en hilos de C++, y su teardown durante la finalizacion
    # del interprete devuelve un codigo de salida que no es el nuestro. El
    # veredicto ya esta impreso y las salidas vaciadas; lo que queda por hacer
    # es solo apagar, y no queremos que apagar cambie el resultado.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(codigo)
