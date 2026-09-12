#!/usr/bin/env python3
"""Verifica que el contrato del protocolo sea consistente consigo mismo.

    python sim/protocol/check.py [robot-map.json ...]

Sin argumentos valida el manifiesto y todos los robot-map del repositorio.
Existe porque un contrato que se contradice es peor que no tener contrato: los
dos lados creen estar de acuerdo. Correrlo en CI antes de compilar cualquiera
de los dos.

Necesita Python 3.11+ por tomllib. El del entorno mars-sim sirve.
"""
import io
import json
import re
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).parent
SIM = HERE.parent
GROUPS = ("gz", "nt", "glue")
REQUIRED_KEYS = {"topic", "type", "dir", "desc"}


def check_manifest(manifest, readme, fails):
    """El manifiesto y el README no pueden decir cosas distintas."""
    version = manifest["protocol_version"]
    declared = {t["topic"] for g in GROUPS for t in manifest[g]}

    # El README es documentación, el manifiesto es la verdad. Si el README cita
    # un tópico que no existe, alguien lo renombró en un solo lado.
    for cited in set(re.findall(r"`(/(?:mars|MARS|SmartDashboard)/[^`]+)`", readme)):
        if cited not in declared:
            fails.append(f"README cita {cited}, que no está en topics.toml")
    if f"**{version}**" not in readme:
        fails.append(f"README no declara la versión {version} del manifiesto")

    for group in GROUPS:
        for entry in manifest[group]:
            topic = entry.get("topic", "?")
            missing = REQUIRED_KEYS - set(entry)
            if missing:
                fails.append(f"[[{group}]] {topic}: falta {sorted(missing)}")
            if entry.get("dir") not in ("in", "out"):
                fails.append(f"{topic}: dir inválido {entry.get('dir')!r}")
            # Los tópicos estándar de gz-sim llevan el nombre del mundo
            # embebido. Si el del manifiesto y el del tópico se separan, el
            # bridge se suscribe a un nombre que nadie publica y no hay error,
            # solo silencio hasta que vence el timeout de discovery.
            en_topico = re.match(r"/world/([^/]+)/", topic)
            if en_topico and en_topico.group(1) != manifest["world"]:
                fails.append(
                    f"{topic}: lleva el mundo '{en_topico.group(1)}',"
                    f" el manifiesto dice '{manifest['world']}'"
                )

    return declared


def check_worlds(manifest, fails):
    """El nombre del mundo en el SDF es parte del contrato.

    Los tópicos estándar de gz-sim lo llevan embebido (/world/<w>/pose/info).
    Si no coincide, el bridge se suscribe a un tópico que nadie publica y no
    hay error en ningún lado, solo un timeout de discovery.
    """
    sdfs = sorted((SIM / "worlds").glob("*.sdf"))
    if not sdfs:
        fails.append(f"no hay ningún .sdf en {SIM / 'worlds'}")
    for sdf in sdfs:
        text = io.open(sdf, encoding="utf-8").read()
        names = re.findall(r'<world\s+name="([^"]+)"', text)
        if not names:
            fails.append(f"{sdf.name}: no declara ningún <world name=...>")
        for n in names:
            if n != manifest["world"]:
                fails.append(
                    f"{sdf.name}: mundo '{n}' != manifiesto '{manifest['world']}'"
                )

        # Las dimensiones de la cancha las necesitan los dos lados: el SDF para
        # el plano del suelo y el bridge para trasladar del marco de Gazebo al
        # de WPILib. Si divergen las poses salen desplazadas por la mitad de la
        # diferencia, sin ningun error en ninguna parte.
        campo = manifest["field"]
        for size in re.findall(r"<plane>.*?<size>([^<]+)</size>.*?</plane>", text, re.S):
            try:
                largo, ancho = (float(v) for v in size.split())
            except ValueError:
                fails.append(f"{sdf.name}: <size> del plano no son dos numeros: {size!r}")
                continue
            if abs(largo - campo["length_m"]) > 1e-6 or abs(ancho - campo["width_m"]) > 1e-6:
                fails.append(
                    f"{sdf.name}: plano {largo}x{ancho} != manifiesto "
                    f"{campo['length_m']}x{campo['width_m']}"
                )


def check_actuator_order(rm, tag, fails):
    """Lo más frágil del contrato: el ORDEN de los actuadores.

    En el SDF es el orden de los <actuator> del <plugin>; en el robot-map, el
    orden de la lista. Ese índice es la posición dentro del campo `normalized`
    de gz.msgs.Actuators, así que si divergen el robot recibe los comandos
    cruzados -- la rueda izquierda con el valor de la derecha -- sin un solo
    error en ningún lado.
    """
    if not rm.get("sdf"):
        return
    sdf_path = SIM / rm["sdf"]
    if not sdf_path.exists():
        fails.append(f"{tag}: sdf {rm['sdf']} no existe")
        return

    text = io.open(sdf_path, encoding="utf-8").read()
    plugin = re.search(r'<plugin[^>]*name="mars::MarsLink".*?</plugin>', text, re.S)
    if not plugin:
        fails.append(f"{tag}: {rm['sdf']} no declara el plugin mars::MarsLink")
        return

    entries = re.findall(r"<actuator\s+([^>]*?)/>", plugin.group(0))
    sdf_joints, sdf_inverted = [], []
    for attrs in entries:
        joint = re.search(r'joint="([^"]+)"', attrs)
        sdf_joints.append(joint.group(1) if joint else "?")
        inv = re.search(r'inverted="([^"]+)"', attrs)
        sdf_inverted.append(inv is not None and inv.group(1) == "true")

    map_joints = [a["joint"] for a in rm["actuators"]]
    if sdf_joints != map_joints:
        fails.append(
            f"{tag}: el orden de actuadores no coincide"
            f" | sdf={sdf_joints} | map={map_joints}"
        )
        return

    # `inverted` vive en los dos lados y tiene que decir lo mismo, o el robot
    # gira sobre sí mismo cuando se le pide avanzar.
    map_inverted = [bool(a.get("inverted", False)) for a in rm["actuators"]]
    if sdf_inverted != map_inverted:
        fails.append(
            f"{tag}: 'inverted' no coincide"
            f" | sdf={sdf_inverted} | map={map_inverted}"
        )

    # El MODO DE CONTROL también vive en los dos lados, y divergir es peor que
    # `inverted`: el bridge llena el campo de `gz.msgs.Actuators` que dice el
    # robot-map, y el motor lee el que dice el SDF. Si no coinciden, el motor
    # lee un arreglo de ceros y el actuador se queda quieto sin un solo error.
    sdf_control = []
    for attrs in entries:
        modo = re.search(r'control="([^"]+)"', attrs)
        sdf_control.append(modo.group(1) if modo else "duty")
    map_control = [a.get("control", "duty") for a in rm["actuators"]]
    if sdf_control != map_control:
        fails.append(
            f"{tag}: el modo de control no coincide"
            f" | sdf={sdf_control} | map={map_control}"
        )
    for m in map_control:
        if m not in ("duty", "position"):
            fails.append(f"{tag}: modo de control invalido {m!r}")


def check_robot_map(path, manifest, fails):
    rm = json.load(io.open(path, encoding="utf-8"))
    tag = Path(path).name

    if rm["protocol"] != manifest["protocol_version"]:
        fails.append(
            f"{tag}: protocol {rm['protocol']} != manifiesto"
            f" {manifest['protocol_version']}"
        )
    if rm["world"] != manifest["world"]:
        fails.append(f"{tag}: world {rm['world']} != manifiesto {manifest['world']}")
    if rm["profile"] not in ("hal", "vendor"):
        fails.append(f"{tag}: profile inválido {rm['profile']!r}")

    # Cada encoder saca su gearRatio del actuador que comparte joint. Sin ese
    # actuador el bridge no puede convertir cuentas a metros.
    joints = {a["joint"] for a in rm["actuators"]}
    for e in rm["encoders"]:
        if e["joint"] not in joints:
            fails.append(f"{tag}: encoder {e['name']} apunta a {e['joint']}, sin actuador")

    # Dos dispositivos en el mismo canal HAL: el segundo pisa al primero y el
    # síntoma aparece a metros de la causa.
    for label, items in (("actuadores", rm["actuators"]), ("encoders", rm["encoders"])):
        seen = {}
        for i in items:
            key = json.dumps(i["hal"], sort_keys=True)
            if key in seen:
                fails.append(
                    f"{tag}: {label} {seen[key]} y {i['name']} comparten canal {key}"
                )
            seen[key] = i["name"]

    names = [i["name"] for i in rm["actuators"] + rm["encoders"]]
    if len(names) != len(set(names)):
        fails.append(f"{tag}: nombres duplicados entre actuadores y encoders")

    check_actuator_order(rm, tag, fails)


def check(robot_maps):
    manifest = tomllib.load(open(HERE / "topics.toml", "rb"))
    readme = io.open(HERE / "README.md", encoding="utf-8").read()
    fails = []

    declared = check_manifest(manifest, readme, fails)
    check_worlds(manifest, fails)
    for path in robot_maps:
        check_robot_map(path, manifest, fails)

    return fails, len(declared)


def default_maps():
    """Todos los robot-map del repo, para que agregar uno no lo deje sin validar."""
    found = [HERE / "robot-map.example.json"]
    found += sorted((SIM / "models").rglob("robot-map*.json"))
    return [str(p) for p in found]


if __name__ == "__main__":
    maps = sys.argv[1:] or default_maps()
    fails, n = check(maps)
    for f in fails:
        print(f"FALLA: {f}", file=sys.stderr)
    if fails:
        sys.exit(1)
    print(f"protocolo consistente: {n} tópicos, {len(maps)} robot-map(s)")
