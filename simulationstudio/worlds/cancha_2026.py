#!/usr/bin/env python3
"""Todo lo que se saca de la malla de la cancha 2026: FUEL y hitboxes.

    python sim/worlds/cancha_2026.py

La cancha 2026 lleva 456 FUEL HORNEADAS en el glTF: son nodos del modelo, sin
colision y sin masa, puro decorado. Para simularlas de verdad hacen falta dos
cosas y las dos viven aqui:

  1. SABER DONDE ESTAN. Las posiciones staged salen del propio .glb, no de una
     tabla escrita a mano: asi las pelotas fisicas caen exactamente donde el
     modelo oficial las dibuja, y si se instala otra version de la cancha las
     posiciones se mueven solas.

  2. QUITARLAS DEL VISUAL. Si no, se ven dos pelotas en cada sitio --- la
     horneada, que no se mueve nunca, y la fisica encima. Se escribe una copia
     del .glb sin esos nodos; el original no se toca porque los otros mundos lo
     siguen usando como decorado.

EL RECORTE: los nodos de FUEL son hijos directos de la raiz de la escena, sin
hijos propios, asi que basta con sacar sus indices de `children`. No se
reindexa nada ni se borran mallas: una malla que ningun nodo referencia no se
dibuja, y reindexar 3363 nodos por 456 que sobran es la clase de operacion que
rompe un archivo de 18 MB sin decir donde.

Y HITBOXES. La malla de la cancha entra al mundo como VISUAL y nada mas: son
2.9 M de triangulos y usarla de colision pondria al solver a resolver contacto
malla-malla, que es lo mas caro que hace un motor de fisica. Sin colision, el
robot atraviesa la pared de la estacion, el HUB y todo lo demas. Las cajas de
aqui son la fisica de la cancha, y sus medidas salen de los AABB de los nodos
del propio glTF: no hay un solo numero escrito a mano que pueda quedar
desfasado del modelo.

MARCOS: el glTF viene Y-arriba y el mundo lo pone con roll de 90 grados, o sea
que un punto (x, y, z) del glTF cae en (x, -z, y) de Gazebo. La conversion pasa
aqui y en ningun otro sitio.
"""
import io
import json
import math
import struct
import sys
from pathlib import Path

AQUI = Path(__file__).parent
SIM = AQUI.parent

# El prefijo del nombre de nodo de las FUEL en la cancha 2026. El nombre
# completo es "GE-26900: Fuel", con el numero de parte del manual delante.
PREFIJO_FUEL = "GE-26900"

# Dimensiones de la cancha, las mismas de protocol/topics.toml. Deciden que es
# "dentro": lo que queda fuera del perimetro son las pelotas del FEEDER, que
# estan del otro lado de la pared y apiladas a casi un metro de alto.
CANCHA = (16.54, 8.21)

# Radio del FUEL, de models/fuel/model.sdf. Sirve para apoyarlas en el suelo
# cuando el nodo del glTF viene con una z ligeramente distinta.
RADIO_FUEL = 0.075


def leer_glb(ruta):
    """Devuelve (json, offset_json, largo_json, bytes) de un .glb."""
    datos = Path(ruta).read_bytes()
    magia, version, _ = struct.unpack_from("<III", datos, 0)
    if magia != 0x46546C67 or version != 2:
        raise ValueError(f"{ruta} no es un glTF binario version 2")
    largo, tipo = struct.unpack_from("<II", datos, 12)
    if tipo != 0x4E4F534A:
        raise ValueError(f"{ruta}: el primer chunk no es JSON")
    js = json.loads(datos[20:20 + largo].decode("utf-8"))
    return js, 20, largo, datos


def indices_fuel(js):
    """Indices de los nodos que son FUEL."""
    return [i for i, n in enumerate(js["nodes"])
            if n.get("name", "").startswith(PREFIJO_FUEL)]


def posiciones(ruta_glb):
    """Las FUEL staged de la cancha, en metros y en el marco de GAZEBO.

    Devuelve una lista de (x, y, z). La z es la del modelo, que para las que
    estan en el suelo ya es el radio.
    """
    js, _, _, _ = leer_glb(ruta_glb)
    fuera = []
    for i in indices_fuel(js):
        t = js["nodes"][i].get("translation", [0.0, 0.0, 0.0])
        fuera.append((t[0], -t[2], t[1]))
    return fuera


def dentro_de_la_cancha(p):
    """Si la pelota esta dentro del perimetro.

    Las que no lo estan son las del FEEDER: viven detras de la pared de la
    estacion, apiladas en una rampa que el mundo no modela. Simularlas seria
    tirar 48 cuerpos dinamicos dentro de una pared que no existe.
    """
    x, y, _ = p
    return abs(x) <= CANCHA[0] / 2 and abs(y) <= CANCHA[1] / 2


def escribir_sin_fuel(origen, destino):
    """Copia el .glb sin los nodos de FUEL. Devuelve cuantos quito."""
    js, off, largo, datos = leer_glb(origen)
    quitar = set(indices_fuel(js))
    if not quitar:
        raise ValueError(f"{origen}: no tiene ningun nodo {PREFIJO_FUEL}*")

    for nodo in js["nodes"]:
        if "children" in nodo:
            nodo["children"] = [c for c in nodo["children"] if c not in quitar]
            if not nodo["children"]:
                del nodo["children"]
    for escena in js.get("scenes", []):
        escena["nodes"] = [n for n in escena.get("nodes", []) if n not in quitar]

    # El chunk JSON se rellena con ESPACIOS hasta multiplo de 4; el BIN, con
    # ceros. Lo dice la especificacion y no es cosmetico: un visor que valide
    # el alineamiento rechaza el archivo entero.
    nuevo = json.dumps(js, separators=(",", ":")).encode("utf-8")
    nuevo += b" " * (-len(nuevo) % 4)
    binario = datos[off + largo:]   # cabecera del chunk BIN incluida, intacta

    salida = bytearray()
    salida += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(nuevo) + len(binario))
    salida += struct.pack("<II", len(nuevo), 0x4E4F534A)
    salida += nuevo
    salida += binario
    Path(destino).write_bytes(salida)
    return len(quitar)


def asegurar_sin_fuel(campo_rel):
    """Genera la copia sin FUEL si falta o si el original es mas nuevo.

    Devuelve la ruta relativa a `sim/` de la copia, o None si la cancha no
    esta instalada.
    """
    origen = SIM / campo_rel
    if not origen.is_file():
        return None
    destino = origen.with_name(origen.stem + "-sin-fuel.glb")
    if not destino.is_file() or destino.stat().st_mtime < origen.stat().st_mtime:
        n = escribir_sin_fuel(origen, destino)
        print(f"escrito {destino.relative_to(SIM)} ({n} FUEL quitadas del visual)")
    return str(destino.relative_to(SIM)).replace("\\", "/")


# --- la cancha optimizada -------------------------------------------------
#
# La malla oficial son 4.28 M de triangulos en 2929 mallas, y el reparto no es
# el que uno esperaria:
#
#     679 k   410 tuercas PEM de 5 mm
#     422 k     4 piezas REV-21-2246, de 11 cm
#     395 k   220 remaches de 3/16"
#     295 k   456 FUEL
#     289 k    32 bujes de rueda
#     ...
#
# Es un modelo de CAD con cada remache modelado. Quitar piezas GRANDES no sirve
# de nada --- el HUB entero es el 47% de los triangulos y es justo lo que hay
# que ver. Lo que sobra es lo que no se ve: nada de 5 mm es visible desde una
# camara que mira un robot de 70 cm, pero cada tuerca cuesta sus 1656
# triangulos y su draw call igual.
#
# Asi que el filtro es por TAMANO, no por pieza. Todo lo que mida menos de
# `minimo` en su diagonal se va. Medido sobre esta cancha:
#
#     umbral   mallas fuera   triangulos fuera   quedan
#      2 cm        586             985 k          3.29 M
#      5 cm        870           1 266 k          3.01 M
#      8 cm        964           1 596 k          2.68 M
#     12 cm       1162           2 112 k          2.16 M
#
# Y ademas se COMPACTA el binario: una malla que ya no se dibuja sigue ocupando
# sus vertices en el archivo, y el .glb entero se carga en memoria igual. Se
# reescribe el buffer con solo lo que queda.
MINIMO_VISIBLE = 0.12

# Tamanos de la especificacion de glTF, para copiar un accessor sin adivinar.
TAM_COMPONENTE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENTES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
               "MAT2": 4, "MAT3": 9, "MAT4": 16}


def _diagonal(js, idx, m):
    """Diagonal del AABB del nodo en el mundo, en metros."""
    caja = _acumular(js, idx, m, [[math.inf] * 3, [-math.inf] * 3])
    if caja[0][0] > caja[1][0]:
        return 0.0
    return math.dist(caja[0], caja[1])


def escribir_optimizado(origen, destino, minimo=MINIMO_VISIBLE, sin_fuel=True):
    """Escribe una copia de la cancha con solo lo que se ve.

    Devuelve (mallas, triangulos, bytes) de la copia.

    Quita los nodos con malla mas chicos que `minimo` y, si `sin_fuel`, las
    FUEL horneadas. Despues reconstruye accessors, bufferViews y el binario con
    lo que sobrevive: sin eso el archivo seguiria pesando 18 MB de vertices que
    nadie dibuja, y el tiempo de carga --- que es lo que se siente al abrir el
    mundo --- no bajaria nada.
    """
    js, off, largo, datos = leer_glb(origen)
    binario = datos[off + largo + 8:]
    nodos = js["nodes"]

    identidad = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    vivos = set()

    def podar(idx, m):
        """True si el nodo se queda. Poda de abajo a arriba."""
        n = nodos[idx]
        m_hijo = _multiplicar(m, _matriz(n))
        hijos = [h for h in n.get("children", []) if podar(h, m_hijo)]
        if hijos:
            n["children"] = hijos
        else:
            n.pop("children", None)

        if sin_fuel and n.get("name", "").startswith(PREFIJO_FUEL):
            n.pop("mesh", None)
            return False
        if "mesh" in n and _diagonal(js, idx, m) < minimo:
            n.pop("mesh", None)
        # Un nodo sin malla y sin hijos no pinta nada: es un grupo vacio que
        # solo sirve para que el motor lo recorra en cada cuadro.
        if "mesh" not in n and not hijos:
            return False
        vivos.add(idx)
        return True

    js["scenes"][0]["nodes"] = [i for i in js["scenes"][0]["nodes"]
                                if podar(i, identidad)]

    # --- compactar: mallas, accessors, bufferViews y el binario ------------
    mallas_usadas, accs_usados = {}, {}
    nuevas_mallas, nuevos_accs, nuevas_vistas = [], [], []
    binario_nuevo = bytearray()

    def vista_de(i_acc):
        """Copia UN accessor a su propio bufferView. Devuelve el indice nuevo.

        Por accessor y no por bufferView, que es lo que parecia natural: esta
        cancha mete sus 4000 accessors dentro de TRES bufferViews de 17 MB, asi
        que copiar la vista entera por cada accessor daria un archivo de varios
        gigabytes --- y el primer intento lo hizo, hasta que el tamano no entro
        en el u32 de la cabecera del glb.

        Copiar por elemento tambien deshace el entrelazado: si el bufferView
        tenia byteStride, aqui sale apretado y ocupa menos.
        """
        if i_acc in accs_usados:
            return accs_usados[i_acc]
        a = dict(js["accessors"][i_acc])
        if "sparse" in a:
            raise ValueError("accessor sparse: no soportado")
        if "bufferView" in a:
            v = js["bufferViews"][a["bufferView"]]
            elem = TAM_COMPONENTE[a["componentType"]] * COMPONENTES[a["type"]]
            paso = v.get("byteStride") or elem
            base = v.get("byteOffset", 0) + a.get("byteOffset", 0)
            trozo = b"".join(binario[base + i * paso: base + i * paso + elem]
                             for i in range(a["count"]))
            # Todo bufferView arranca en multiplo de 4: si no, un Float32Array
            # montado encima se lee corrido un byte y la malla sale explotada.
            binario_nuevo.extend(b"\x00" * (-len(binario_nuevo) % 4))
            nuevas_vistas.append({"buffer": 0,
                                  "byteOffset": len(binario_nuevo),
                                  "byteLength": len(trozo)})
            if "target" in v:
                nuevas_vistas[-1]["target"] = v["target"]
            binario_nuevo.extend(trozo)
            a["bufferView"] = len(nuevas_vistas) - 1
            a.pop("byteOffset", None)
        nuevos_accs.append(a)
        accs_usados[i_acc] = len(nuevos_accs) - 1
        return accs_usados[i_acc]

    for idx in sorted(vivos):
        n = nodos[idx]
        if "mesh" not in n:
            continue
        i_malla = n["mesh"]
        if i_malla not in mallas_usadas:
            malla = {"primitives": []}
            if "name" in js["meshes"][i_malla]:
                malla["name"] = js["meshes"][i_malla]["name"]
            for prim in js["meshes"][i_malla]["primitives"]:
                nuevo = dict(prim)
                nuevo["attributes"] = {k: vista_de(v)
                                       for k, v in prim["attributes"].items()}
                if "indices" in prim:
                    nuevo["indices"] = vista_de(prim["indices"])
                malla["primitives"].append(nuevo)
            nuevas_mallas.append(malla)
            mallas_usadas[i_malla] = len(nuevas_mallas) - 1
        n["mesh"] = mallas_usadas[i_malla]

    js["meshes"] = nuevas_mallas
    js["accessors"] = nuevos_accs
    js["bufferViews"] = nuevas_vistas
    js["buffers"] = [{"byteLength": len(binario_nuevo)}]

    texto = json.dumps(js, separators=(",", ":")).encode("utf-8")
    texto += b" " * (-len(texto) % 4)
    binario_nuevo.extend(b"\x00" * (-len(binario_nuevo) % 4))

    salida = bytearray()
    salida += struct.pack("<III", 0x46546C67, 2,
                          12 + 8 + len(texto) + 8 + len(binario_nuevo))
    salida += struct.pack("<II", len(texto), 0x4E4F534A)
    salida += texto
    salida += struct.pack("<II", len(binario_nuevo), 0x004E4942)
    salida += binario_nuevo
    Path(destino).write_bytes(salida)

    triangulos = 0
    for malla in nuevas_mallas:
        for prim in malla["primitives"]:
            i = prim.get("indices", prim["attributes"]["POSITION"])
            triangulos += nuevos_accs[i]["count"] // 3
    return len(nuevas_mallas), triangulos, len(salida)


def asegurar_optimizado(campo_rel, minimo=MINIMO_VISIBLE):
    """Genera la copia optimizada si falta o si el original es mas nuevo."""
    origen = SIM / campo_rel
    if not origen.is_file():
        return None
    destino = origen.with_name(origen.stem + "-lite.glb")
    if not destino.is_file() or destino.stat().st_mtime < origen.stat().st_mtime:
        mallas, tris, tam = escribir_optimizado(origen, destino, minimo)
        print(f"escrito {destino.relative_to(SIM)} "
              f"({mallas} mallas, {tris:,} triangulos, {tam / 1e6:.1f} MB)")
    return str(destino.relative_to(SIM)).replace("\\", "/")


# --- hitboxes -------------------------------------------------------------
#
# Que entra y que no. Cada entrada es (nombre en el SDF, nombre del nodo en el
# glTF); la caja sale del AABB de ese nodo, con todos sus hijos y todas sus
# transformaciones aplicadas.
#
# LOS SEIS DRIVER STATIONS Y LOS DOS GUARDRAILS son el perimetro. Los tres DS
# de cada punta no cierran la pared solos: entre ellos quedan dos huecos, y los
# tapan el TOWER (que ademas se mete 1.2 m dentro de la cancha, o sea que es un
# obstaculo de verdad) y el OUTPOST. Con los cinco por punta la pared queda
# cerrada de banda a banda, menos un dedo de 11 cm en cada esquina que en la
# cancha real tapa el corner support.
#
# LOS DOS HUB son la estructura de puntuacion: 1.53 x 1.49 m y 3.08 de alto.
#
# LO QUE NO ESTA, y a proposito:
#
#   Trench   su AABB es 1.19 x 8.37 x 1.02, o sea que cruza la cancha entera de
#            banda a banda. Como caja maciza no seria un obstaculo, seria un
#            MURO que parte el campo en dos --- y por debajo del trench se
#            conduce. Necesita varias cajas (las patas y el techo), no una.
#   Depot    3 cm. Es marca en el suelo, no obstaculo.
#
# LOS CUATRO BUMP van aparte, en BUMPS, porque no son cajas: son rampas y cada
# uno sale como dos losas inclinadas. Ver _rampas().
#
# Los nombres llevan el sufijo del modelo oficial (<1>, <2>) en vez de rojo y
# azul: son los que se ven en el arbol de entidades de Gazebo, y asi no hay que
# creerle a nadie de que lado esta cada alianza. Para ubicarse: en la
# convencion de WPILib el origen es la esquina AZUL, o sea que la pared azul es
# la de x negativa en el marco de Gazebo, que tiene el origen en el centro.
PIEZAS = [
    ("guardrail_1", "Configurable Guardrail <1>"),
    ("guardrail_2", "Configurable Guardrail <2>"),
    ("driver_station_1", "Driver Station <1>"),
    ("driver_station_2", "Driver Station <2>"),
    ("driver_station_3", "Driver Station <3>"),
    ("driver_station_4", "Driver Station <4>"),
    ("driver_station_5", "Driver Station <5>"),
    ("driver_station_6", "Driver Station <6>"),
    ("tower_1", "GE-26500: Tower <1>"),
    ("tower_2", "GE-26500: Tower <2>"),
    ("outpost_1", "GE-26000: Outpost <1>"),
    ("outpost_2", "GE-26000: Outpost <2>"),
    ("hub_1", "GE-26300: Hub <1>"),
    ("hub_2", "GE-26300: Hub <2>"),
]

# Los BUMP: las lomas por las que se pasa por encima. Cada uno da dos cajas.
BUMPS = [
    ("bump_1", "GE-26100: Bump <1>"),
    ("bump_2", "GE-26100: Bump <2>"),
    ("bump_3", "GE-26100: Bump <3>"),
    ("bump_4", "GE-26100: Bump <4>"),
]


def _multiplicar(a, b):
    return [sum(a[i * 4 + k] * b[k * 4 + j] for k in range(4))
            for i in range(4) for j in range(4)]


def _matriz(n):
    """La transformacion local de un nodo, en fila-mayor."""
    if "matrix" in n:
        # glTF guarda las matrices en COLUMNA-mayor. Leerlas como filas da una
        # transpuesta que casi funciona: las traslaciones caen donde no es y
        # las rotaciones salen invertidas.
        m = n["matrix"]
        return [m[0], m[4], m[8], m[12],
                m[1], m[5], m[9], m[13],
                m[2], m[6], m[10], m[14],
                m[3], m[7], m[11], m[15]]
    t = n.get("translation", [0, 0, 0])
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
         2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
         2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    return [r[0] * s[0], r[1] * s[1], r[2] * s[2], t[0],
            r[3] * s[0], r[4] * s[1], r[5] * s[2], t[1],
            r[6] * s[0], r[7] * s[1], r[8] * s[2], t[2],
            0, 0, 0, 1]


def _aplicar(m, p):
    return (m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
            m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
            m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11])


def _acumular(js, idx, m, caja):
    """AABB del subarbol, todavia en el marco del glTF.

    Cada malla trae su propio AABB en el `min`/`max` del accessor de POSITION,
    asi que no hay que leer ni un vertice: son 2929 mallas y recorrer el
    binario entero para esto tardaria mas que cargar la cancha.

    De un AABB girado se toman las OCHO esquinas y se vuelve a encerrar. Eso da
    una caja algo mayor que la ajustada cuando la pieza esta en diagonal; en
    esta cancha todo esta a 0 o 90 grados y la diferencia es cero.
    """
    n = js["nodes"][idx]
    m = _multiplicar(m, _matriz(n))
    if "mesh" in n:
        for prim in js["meshes"][n["mesh"]]["primitives"]:
            a = js["accessors"][prim["attributes"]["POSITION"]]
            lo, hi = a["min"], a["max"]
            for i in range(8):
                q = _aplicar(m, [lo[0] if i & 1 else hi[0],
                                 lo[1] if i & 2 else hi[1],
                                 lo[2] if i & 4 else hi[2]])
                for k in range(3):
                    caja[0][k] = min(caja[0][k], q[k])
                    caja[1][k] = max(caja[1][k], q[k])
    for h in n.get("children", []):
        _acumular(js, h, m, caja)
    return caja


def _buscar(js, nombre):
    """(indice, matriz de los padres) del nodo con ese nombre."""
    identidad = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    def bajar(idx, m):
        n = js["nodes"][idx]
        if n.get("name") == nombre:
            return idx, m
        m_hijo = _multiplicar(m, _matriz(n))
        for h in n.get("children", []):
            hallado = bajar(h, m_hijo)
            if hallado:
                return hallado
        return None

    for raiz in js["scenes"][0]["nodes"]:
        hallado = bajar(raiz, identidad)
        if hallado:
            return hallado
    return None


def hitboxes(ruta_glb):
    """Las cajas de colision de la cancha, en el marco de GAZEBO.

    Devuelve una lista de (nombre, centro, tamano, rpy), en metros y radianes.
    Casi todas van a ejes (rpy = 0,0,0); las rampas de los BUMP llevan pitch.
    Una pieza que no este en el modelo se salta en silencio: la cancha de otro
    ano no tiene por que traer las mismas.
    """
    js, _, _, _ = leer_glb(ruta_glb)
    cajas = []
    for nombre, nodo in PIEZAS:
        caja = _caja_de(js, nodo)
        if caja:
            cajas.append((nombre, caja[0], caja[1], (0.0, 0.0, 0.0)))
    for nombre, nodo in BUMPS:
        caja = _caja_de(js, nodo)
        if caja:
            cajas.extend(_rampas(nombre, *caja))
    return cajas


def _caja_de(js, nodo):
    """(centro, tamano) del AABB de ese nodo, en el marco de Gazebo."""
    hallado = _buscar(js, nodo)
    if not hallado:
        return None
    idx, m = hallado
    lo, hi = _acumular(js, idx, m, [[math.inf] * 3, [-math.inf] * 3])
    # glTF (x, y, z) -> Gazebo (x, -z, y), igual que las FUEL.
    centro = ((lo[0] + hi[0]) / 2, -(lo[2] + hi[2]) / 2, (lo[1] + hi[1]) / 2)
    tamano = (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1])
    return centro, tamano


# Grosor de la losa que hace de rampa. No es la del BUMP real: es el espesor de
# la caja que se inclina, y lo unico que tiene que cumplir es que su cara de
# arriba caiga en la pendiente y que la de abajo quede enterrada.
GROSOR_RAMPA = 0.08


def _rampas(nombre, centro, tamano):
    """Un BUMP como DOS cajas inclinadas, no como una caja.

    El perfil del modelo, medido vertice a vertice, es una loma simetrica: sube
    de 0 a 16.5 cm en los 56 cm de media anchura y vuelve a bajar. Una caja de
    16.5 cm en su lugar seria un ESCALON --- el robot chocaria de frente contra
    una pared de la altura de la rampa en vez de subirla, que es exactamente al
    reves de lo que hace el bump en la cancha.

    Cada mitad es una losa girada su angulo de pendiente, colocada de forma que
    su CARA DE ARRIBA sea la pendiente. La de abajo queda bajo el suelo y no
    molesta: el <plane> del piso es infinito pero los dos son estaticos.
    """
    cx, cy, _ = centro
    ancho, fondo, alto = tamano
    media = ancho / 2
    angulo = math.atan2(alto, media)
    largo = math.hypot(media, alto)      # la hipotenusa: el largo de la losa

    salida = []
    for i, signo in enumerate((-1, 1), start=1):
        # Punto medio de la cara superior de esta mitad.
        mx = cx + signo * media / 2
        mz = alto / 2
        # El centro de la caja esta medio grosor por debajo, en la NORMAL de la
        # pendiente --- no en la vertical, o la losa asoma por el borde de
        # arriba y deja un labio contra el que se traba una rueda.
        # Un pitch p manda el +x local a (cos p, 0, -sin p) y el +z local a
        # (sin p, 0, cos p). La mitad izquierda (signo -1) SUBE hacia +x, o sea
        # que necesita pitch negativo; la derecha baja y lo lleva positivo.
        pitch = signo * angulo
        normal = (math.sin(pitch), math.cos(pitch))
        salida.append((
            f"{nombre}_{i}",
            (mx - normal[0] * GROSOR_RAMPA / 2, cy, mz - normal[1] * GROSOR_RAMPA / 2),
            (largo, fondo, GROSOR_RAMPA),
            (0.0, pitch, 0.0),
        ))
    return salida


def separar_de_cajas(pos, cajas, radio=RADIO_FUEL):
    """Saca una FUEL de dentro de una hitbox, por el lado mas corto.

    Las 14 pelotas que el modelo apoya contra la pared de la estacion quedan
    12 mm dentro del AABB del driver station. Doce milimetros no suenan a nada,
    pero un cuerpo que NACE penetrando a otro es energia que el solver tiene que
    sacar de algun lado, y lo hace escupiendo la pelota. Un mundo que empieza
    con catorce pelotas saliendo disparadas parece roto aunque no lo este.

    Se empuja por el eje de MENOS penetracion, que es el empujon mas corto que
    la deja fuera --- y en este caso la deja justo apoyada contra la pared, que
    es donde el modelo la dibuja.
    """
    pos = list(pos)
    for _, centro, tamano, _rpy in cajas:
        holgura = [abs(pos[k] - centro[k]) - (tamano[k] / 2 + radio)
                   for k in range(3)]
        if max(holgura) >= 0:
            continue    # ya esta fuera por algun eje
        k = max(range(3), key=lambda i: holgura[i])
        signo = 1.0 if pos[k] >= centro[k] else -1.0
        pos[k] = centro[k] + signo * (tamano[k] / 2 + radio + 0.001)
    return tuple(pos)


if __name__ == "__main__":
    campo = SIM / "fields/2026-rebuilt/model.glb"
    if not campo.is_file():
        sys.exit(f"no esta instalada la cancha: {campo}")
    todas = posiciones(campo)
    dentro = [p for p in todas if dentro_de_la_cancha(p)]
    fuera = [p for p in todas if not dentro_de_la_cancha(p)]
    print(f"{len(todas)} FUEL en la malla")
    print(f"  {len(dentro)} dentro del perimetro")
    print(f"  {len(fuera)} en el feeder (x de {min(abs(p[0]) for p in fuera):.2f} "
          f"a {max(abs(p[0]) for p in fuera):.2f}, z hasta {max(p[2] for p in fuera):.2f})")
    centro = [p for p in dentro if abs(p[0]) < 2.0]
    print(f"  de las de dentro, {len(centro)} son la banda del centro y "
          f"{len(dentro) - len(centro)} estan junto a las alianzas")
    print()
    cajas = hitboxes(campo)
    apretadas = [p for p in dentro if separar_de_cajas(p, cajas) != p]
    print(f"{len(apretadas)} FUEL nacen dentro de una hitbox y se separan")
    print(f"{len(cajas)} hitboxes:")
    for nombre, c, tam, rpy in cajas:
        giro = "" if not any(rpy) else f"  pitch {math.degrees(rpy[1]):5.1f} deg"
        print(f"  {nombre:18} centro({c[0]:7.3f},{c[1]:7.3f},{c[2]:6.3f})"
              f"  tamano({tam[0]:6.3f} x {tam[1]:6.3f} x {tam[2]:5.3f}){giro}")
