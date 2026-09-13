# -*- coding: utf-8 -*-
"""Genera el juego de iconos de MARS Simulation Studio a partir de mss.svg.

    python sim/app/icons/make-icons.py

La fuente es `public/icons/mss.svg` del repositorio --- la misma marca que
mars-desktop pone en la fila "Simulation Studio" de su sidebar --- y de ahi
salen:

    icons/icon.ico          el que empotra tauri-build en el ejecutable de
                            Windows; SIN el, `cargo build` falla
    icons/icon.png          512x512, para el bundle en Linux/macOS
    icons/32x32.png
    icons/128x128.png
    icons/128x128@2x.png

Por que el SVG y no el PNG: el vector se rasteriza a la medida exacta de cada
icono, asi que el .ico de 16 px sale nitido en vez de ser una reduccion de una
reduccion. El PNG (`public/mss.png`) sigue siendo la fuente de `ui/mss.png`,
el logo que la interfaz muestra en la bienvenida, el About y la pantalla de
carga: ese se ve grande y sobre fondo oscuro, y ahi la version en rojo es la
que el equipo ya reconoce. Un icono de barra de tareas es otro problema.

Rasterizar un SVG necesita un motor. En vez de sumar cairosvg --- que en
Windows arrastra las DLL de cairo y falla mas de lo que funciona --- se usa el
Chrome que ya esta instalado, en modo headless, que es exactamente lo que hace
el webview de la app al pintar el mismo archivo.

Por que hace falta recortar: el arte ocupa solo la parte central del lienzo. Un
icono de 32 px generado a partir de eso deja la marca en ~24 px reales y se ve
diminuto en la barra de tareas. Se recorta al bounding box del canal alfa y se
le devuelve un margen del 6 %, que es lo que hace que respire sin desperdiciar
el cuadro.

Volver a correrlo cuando el logo cambie. No hay nada automatico que lo haga: es
una dependencia de Pillow mas un Chrome, y no vale la pena meter eso en el
build.
"""
import os
import shutil
import subprocess
import sys
import tempfile

try:
    from PIL import Image
except ImportError:
    sys.exit("hace falta Pillow:  pip install pillow")

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(AQUI, "..", "..", ".."))
FUENTE = os.path.join(REPO, "public", "icons", "mss.svg")
UI = os.path.abspath(os.path.join(AQUI, "..", "ui"))

# El lienzo del rasterizado. No es el tamano de ningun icono: es el original
# del que salen todos, grande para que el recorte no quede corto de pixeles.
LIENZO = 2048
MARGEN = 0.06
TAMANOS_ICO = [16, 24, 32, 48, 64, 128, 256]

# Donde suele estar Chrome en Windows. `MARS_CHROME` gana sobre todo esto por
# si el navegador vive en otro lado o se prefiere Edge/Chromium.
CANDIDATOS = [
    os.environ.get("MARS_CHROME"),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def buscar_navegador():
    for ruta in CANDIDATOS:
        if ruta and os.path.isfile(ruta):
            return ruta
    for nombre in ("google-chrome", "chromium", "chrome", "msedge"):
        ruta = shutil.which(nombre)
        if ruta:
            return ruta
    sys.exit(
        "no se encontro Chrome/Edge para rasterizar el SVG.\n"
        "Apunta MARS_CHROME al ejecutable, por ejemplo:\n"
        '  set MARS_CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"'
    )


def rasterizar(svg, lado):
    """El SVG pintado por Chrome en un cuadrado de `lado` px, con fondo
    transparente."""
    navegador = buscar_navegador()
    trabajo = tempfile.mkdtemp(prefix="mss-icon-")
    try:
        shutil.copyfile(svg, os.path.join(trabajo, "marca.svg"))
        # El <img> va con medidas explicitas: el SVG trae width/height propios y
        # sin esto Chrome lo pinta a ese tamano y no al del lienzo.
        with open(os.path.join(trabajo, "marca.html"), "w", encoding="utf-8") as f:
            f.write(
                "<style>html,body{margin:0;padding:0;background:transparent}"
                "img{display:block;width:%dpx;height:%dpx}</style>"
                '<img src="marca.svg">' % (lado, lado)
            )
        salida = os.path.join(trabajo, "marca.png")
        subprocess.run(
            [
                navegador,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                # Sin esto el "fondo" del screenshot es blanco opaco y el icono
                # sale con un cuadro blanco alrededor en vez de transparencia.
                "--default-background-color=00000000",
                "--window-size=%d,%d" % (lado, lado),
                "--screenshot=%s" % salida,
                "file:///%s" % os.path.join(trabajo, "marca.html").replace("\\", "/"),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not os.path.isfile(salida):
            sys.exit("Chrome no escribio el screenshot: %s" % salida)
        return Image.open(salida).convert("RGBA")
    finally:
        shutil.rmtree(trabajo, ignore_errors=True)


def cuadrado_recortado(im):
    """Recorta al contenido y lo centra en un lienzo cuadrado con margen."""
    caja = im.getchannel("A").getbbox()
    if caja is None:
        return im
    marca = im.crop(caja)
    lado = max(marca.size)
    lienzo = int(round(lado * (1 + 2 * MARGEN)))
    fondo = Image.new("RGBA", (lienzo, lienzo), (0, 0, 0, 0))
    fondo.paste(marca, ((lienzo - marca.width) // 2, (lienzo - marca.height) // 2))
    return fondo


def main():
    if not os.path.isfile(FUENTE):
        sys.exit("no esta %s" % FUENTE)

    base = cuadrado_recortado(rasterizar(FUENTE, LIENZO))
    escalar = lambda n: base.resize((n, n), Image.LANCZOS)

    escalar(512).save(os.path.join(AQUI, "icon.png"))
    escalar(32).save(os.path.join(AQUI, "32x32.png"))
    escalar(128).save(os.path.join(AQUI, "128x128.png"))
    escalar(256).save(os.path.join(AQUI, "128x128@2x.png"))

    # El .ico lleva TODAS las medidas dentro: Windows elige la que necesita
    # para la barra de tareas, el explorador y el Alt+Tab. Uno de un solo
    # tamano se ve borroso en el resto.
    escalar(256).save(
        os.path.join(AQUI, "icon.ico"),
        format="ICO",
        sizes=[(n, n) for n in TAMANOS_ICO],
    )

    print("iconos escritos en %s" % AQUI)
    for n in sorted(os.listdir(AQUI)):
        if n.endswith((".png", ".ico")):
            print("  %-16s %d KB" % (n, os.path.getsize(os.path.join(AQUI, n)) // 1024))
    print("ui/mss.png no se toca: el logo de la interfaz sale de public/mss.png")
    print("(ver el encabezado de este archivo) y se mantiene como esta.")


if __name__ == "__main__":
    main()
