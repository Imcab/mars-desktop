// MARS Installer — el asistente.
//
// Un objeto `estado` y una función por pantalla. Cada pantalla se dibuja
// entera cuando se entra en ella (`pintar*`) y configura sus propios botones
// del pie: así no hay ningún lugar donde el botón "Siguiente" tenga que
// adivinar en qué paso está.

import { invoke, escuchar, elegirCarpeta, cerrar } from "./tauri.js"
import { $, el, caja, resumen, mostrarPaso, pie, bitacora, progreso, mb, fecha } from "./ui.js"

const NOMBRES_SO = { windows: "Windows", linux: "Linux", macos: "macOS" }

const estado = {
  /** Lo que devolvió `estado_instalacion`. */
  sistema: null,
  /** "full" | "tools" */
  edicion: "full",
  carpeta: "",
  accesoEscritorio: true,
  /** El plan de descarga de la release consultada. */
  plan: null,
  /** Resultado de la instalación. */
  registro: null,
}

// --- Arranque ---------------------------------------------------------------

async function arrancar() {
  try {
    estado.sistema = await invoke("estado_instalacion")
  } catch (e) {
    mostrarPaso("inicio")
    $("inicio-titulo").textContent = "No pude leer el estado del sistema"
    caja($("inicio-avisos"), "error", String(e))
    pie({ cancelar: { texto: "Cerrar", al: cerrar } })
    return
  }

  estado.carpeta = estado.sistema.destino_sugerido
  $("marca-sub").textContent =
    `INSTALADOR v${estado.sistema.version_instalador} · ${NOMBRES_SO[estado.sistema.so] ?? estado.sistema.so} ${estado.sistema.arch}`

  // Windows llama al desinstalador con --uninstall desde la lista de
  // aplicaciones instaladas: ahí se entra directo a esa pantalla.
  const modo = await invoke("modo_inicial").catch(() => "instalar")
  if (modo === "desinstalar" && estado.sistema.instalado) {
    pintarDesinstalar()
  } else {
    pintarInicio()
  }

  escuchar("instalador://progreso", ({ payload }) => aplicarProgreso(payload))
}

// --- 1. Inicio --------------------------------------------------------------

function pintarInicio() {
  mostrarPaso("inicio")
  const inst = estado.sistema.instalado

  if (!inst) {
    $("inicio-titulo").textContent = "Instalar MARS Desktop"
    $("inicio-lede").textContent =
      "Este asistente descarga MARS desde su repositorio oficial y lo deja listo para usar. " +
      "No hace falta ser administrador: todo se instala en tu usuario."
    resumen($("inicio-resumen"), [
      ["Sistema", `${NOMBRES_SO[estado.sistema.so] ?? estado.sistema.so} · ${estado.sistema.arch}`],
      ["Origen", `github.com/${estado.sistema.repo}`],
      ["Se instalará en", estado.sistema.destino_sugerido],
    ])
    caja(
      $("inicio-avisos"),
      "aviso",
      estado.sistema.falta_webview2
        ? "Falta el runtime WebView2 de Microsoft, que es lo que dibuja la ventana de la app. " +
          "El instalador lo va a instalar primero (descarga chica, sin reiniciar)."
        : "",
    )
    pie({
      cancelar: { texto: "Cancelar", al: cerrar },
      siguiente: { texto: "Empezar", al: () => pintarEdicion() },
    })
    return
  }

  // Ya hay algo instalado: la pantalla cambia de "instalar" a "administrar".
  estado.edicion = inst.edicion
  $("inicio-titulo").textContent = `MARS ${inst.version} está instalado`
  $("inicio-lede").textContent =
    "Podés actualizarlo, reinstalarlo con otra edición o quitarlo de esta computadora."
  resumen($("inicio-resumen"), [
    ["Edición", inst.edicion === "tools" ? "Solo herramientas" : "MARS completo"],
    ["Versión", inst.version],
    ["Carpeta", inst.carpeta],
    ["Componentes", inst.componentes.map(nombreComponente).join(", ")],
    ["Instalado el", fecha(inst.instalado_en)],
  ])
  $("inicio-avisos").replaceChildren()

  pie({
    cancelar: { texto: "Cerrar", al: cerrar },
    desinstalar: { texto: "Desinstalar", al: () => pintarDesinstalar() },
    siguiente: { texto: "Actualizar o cambiar", al: () => pintarEdicion() },
  })

  // La comprobación de versión va después de pintar: si GitHub no contesta, la
  // pantalla ya está completa y solo falta una línea.
  buscarActualizacion(inst)
}

async function buscarActualizacion(inst) {
  const aviso = $("inicio-avisos")
  aviso.replaceChildren()
  const linea = el("div", "lede")
  linea.append(el("span", "girando"), document.createTextNode("Buscando actualizaciones…"))
  aviso.appendChild(linea)

  try {
    const plan = await invoke("consultar_release", { edicion: inst.edicion })
    estado.plan = plan
    if (plan.mas_nueva) {
      caja(aviso, "ok", `Hay una versión nueva: ${plan.release.version} (tenés la ${inst.version}).`)
    } else if (plan.release.version === inst.version) {
      caja(aviso, "ok", `Tenés la última versión publicada (${plan.release.version}).`)
    } else {
      // Pasa con una compilación local más nueva que lo publicado. Decir
      // "estás al día" ahí sería mentira, y ofrecer "actualizar" a una versión
      // anterior, peor.
      caja(aviso, "aviso", `Tenés la ${inst.version}, más nueva que la última publicada (${plan.release.version}).`)
    }
  } catch (e) {
    caja(aviso, "aviso", `No pude consultar si hay actualizaciones:\n${e}`)
  }
}

// --- 2. Edición -------------------------------------------------------------

function pintarEdicion() {
  mostrarPaso("edicion")

  const hayStudio = estado.sistema.hay_simulation_studio
  $("ed-full-lista").replaceChildren(
    ...[
      "Dashboard completo: NetworkTables, campo 2D y 3D, swerve, mecanismos, gráficas, SysId, logs .wpilog",
      "Framework MARS: proyectos, paquetes, manifiesto, wizard de subsistemas, features",
      hayStudio
        ? "MARS Simulation Studio (simulador con física)"
        : `MARS Simulation Studio — todavía no está disponible en ${NOMBRES_SO[estado.sistema.so] ?? estado.sistema.so}`,
    ].map((t, i) => el("li", i === 2 && !hayStudio ? "no" : null, t)),
  )
  $("ed-tools-lista").replaceChildren(
    ...[
      "Dashboard completo: NetworkTables, campo 2D y 3D, swerve, mecanismos, gráficas, SysId, logs .wpilog",
      "Sin framework MARS: no se compila ni se instala nada de proyectos, paquetes ni subsistemas",
      "Sin simulador",
    ].map((t, i) => el("li", i > 0 ? "no" : null, t)),
  )

  const marcar = () => {
    $("ed-full").classList.toggle("elegida", estado.edicion === "full")
    $("ed-tools").classList.toggle("elegida", estado.edicion === "tools")
  }
  for (const id of ["ed-full", "ed-tools"]) {
    $(id).onclick = () => {
      estado.edicion = $(id).dataset.edicion
      marcar()
    }
  }
  marcar()

  $("ruta").value = estado.carpeta
  $("ruta").oninput = (e) => { estado.carpeta = e.target.value }
  $("btn-examinar").onclick = async () => {
    const elegida = await elegirCarpeta(estado.carpeta)
    if (elegida) {
      estado.carpeta = elegida
      $("ruta").value = elegida
    }
  }
  $("chk-escritorio").checked = estado.accesoEscritorio
  $("chk-escritorio").onchange = (e) => { estado.accesoEscritorio = e.target.checked }

  caja(
    $("edicion-avisos"),
    "aviso",
    estado.sistema.instalado && estado.sistema.instalado.edicion !== estado.edicion
      ? "Vas a cambiar de edición: se quita la instalación actual y se instala la nueva. Tus preferencias y layouts se conservan."
      : "",
  )

  pie({
    atras: { texto: "Atrás", al: () => pintarInicio() },
    cancelar: { texto: "Cancelar", al: cerrar },
    siguiente: { texto: "Siguiente", al: () => pintarConfirmar() },
  })
}

// --- 3. Confirmación --------------------------------------------------------

async function pintarConfirmar() {
  if (!estado.carpeta.trim()) {
    caja($("edicion-avisos"), "error", "Hace falta una carpeta de instalación.")
    return
  }

  mostrarPaso("confirmar")
  $("confirmar-lede").textContent = "Consultando la última versión publicada…"
  $("confirmar-resumen").replaceChildren()
  $("confirmar-notas").replaceChildren()
  $("confirmar-avisos").replaceChildren()
  pie({
    atras: { texto: "Atrás", al: () => pintarEdicion() },
    cancelar: { texto: "Cancelar", al: cerrar },
    siguiente: { texto: "Instalar", deshabilitado: true },
  })

  let plan
  try {
    plan = await invoke("consultar_release", { edicion: estado.edicion })
  } catch (e) {
    $("confirmar-lede").textContent = "No pude preparar la instalación."
    caja($("confirmar-avisos"), "error", String(e))
    pie({
      atras: { texto: "Atrás", al: () => pintarEdicion() },
      cancelar: { texto: "Cerrar", al: cerrar },
      siguiente: { texto: "Reintentar", al: () => pintarConfirmar() },
    })
    return
  }

  estado.plan = plan
  const total = plan.artefactos.reduce((s, a) => s + (a.tamano || 0), 0)

  $("confirmar-lede").textContent = "Revisá que esté todo bien antes de empezar."
  resumen($("confirmar-resumen"), [
    ["Edición", estado.edicion === "tools" ? "Solo herramientas" : "MARS completo"],
    ["Versión", `${plan.release.version} (${plan.release.etiqueta})`],
    ["Componentes", plan.artefactos.map((a) => nombreComponente(a.componente)).join(", ")],
    ["Descarga", mb(total) ?? "tamaño no informado"],
    ["Carpeta", estado.carpeta],
    ["Acceso en el escritorio", estado.accesoEscritorio ? "Sí" : "No"],
    ["Integridad", plan.release.verificable ? "sha256 publicado — se verifica" : "la release no publica checksums"],
  ])

  if (plan.release.notas.trim()) {
    const encabezado = el("div", "lede", "Novedades de esta versión — ")
    const verMas = el("span", "enlace", "ver la release completa")
    verMas.onclick = () => invoke("abrir_url", { url: plan.release.url_release }).catch(() => {})
    encabezado.appendChild(verMas)
    $("confirmar-notas").replaceChildren(encabezado, el("div", "notas", plan.release.notas))
  }

  const avisos = []
  if (plan.faltantes.length) {
    avisos.push(`La release no publica para esta plataforma: ${plan.faltantes.join(", ")}. Se instala el resto.`)
  }
  if (!plan.release.verificable) {
    avisos.push("Esta release no trae checksums, así que no puedo verificar lo que se descargue.")
  }
  caja($("confirmar-avisos"), "aviso", avisos.join("\n\n"))

  pie({
    atras: { texto: "Atrás", al: () => pintarEdicion() },
    cancelar: { texto: "Cancelar", al: cerrar },
    siguiente: { texto: "Instalar", al: () => correrInstalacion() },
  })
}

// --- 4. Progreso ------------------------------------------------------------

async function correrInstalacion() {
  mostrarPaso("progreso")
  $("progreso-titulo").textContent = "Instalando MARS"
  $("bitacora").replaceChildren()
  progreso(0, "Preparando…")
  // Durante la instalación no hay botones: cancelar a mitad de una extracción
  // deja archivos a medias, y "cerrar la ventana" ya es la salida de emergencia.
  pie({})

  try {
    estado.registro = await invoke("instalar", {
      opciones: {
        edicion: estado.edicion,
        carpeta: estado.carpeta,
        acceso_escritorio: estado.accesoEscritorio,
      },
    })
    pintarFinal()
  } catch (e) {
    progreso(100, "La instalación falló")
    bitacora(String(e), "error")
    $("progreso-titulo").textContent = "No se pudo instalar"
    pie({
      cancelar: { texto: "Cerrar", al: cerrar },
      siguiente: { texto: "Reintentar", al: () => correrInstalacion() },
    })
  }
}

function aplicarProgreso(p) {
  progreso(p.porcentaje, p.mensaje)
  if (p.fase === "aviso") bitacora(`aviso: ${p.mensaje}`, "aviso")
  else if (p.fase === "listo") bitacora(p.mensaje, "ok")
  else if (p.fase !== "descargar") bitacora(p.mensaje)
  // La fase "descargar" emite muchas veces por segundo: va en la línea de
  // estado y en la barra, no en la bitácora.
}

// --- 5. Final ---------------------------------------------------------------

function pintarFinal() {
  mostrarPaso("final")
  const reg = estado.registro
  $("final-titulo").textContent = `MARS ${reg.version} quedó instalado`
  $("final-lede").textContent =
    reg.atajos.length > 0
      ? "Ya está en el menú de aplicaciones. También podés abrirlo desde acá."
      : "Está instalado. No pude crear accesos directos, así que se abre desde su carpeta."

  resumen($("final-resumen"), [
    ["Edición", reg.edicion === "tools" ? "Solo herramientas" : "MARS completo"],
    ["Componentes", reg.componentes.map(nombreComponente).join(", ")],
    ["Carpeta", reg.carpeta],
    ["Archivos instalados", reg.archivos.length],
  ])

  const nota = el("div", "lede")
  nota.style.marginTop = "14px"
  const verCarpeta = el("span", "enlace", "Abrir la carpeta")
  verCarpeta.onclick = () => invoke("abrir_carpeta", { ruta: reg.carpeta }).catch((e) => caja($("final-avisos"), "error", String(e)))
  nota.append(
    verCarpeta,
    document.createTextNode(". Para quitarlo más adelante, volvé a abrir este instalador"),
    document.createTextNode(
      estado.sistema.so === "windows"
        ? " o usá Aplicaciones instaladas de Windows."
        : ".",
    ),
  )
  $("final-avisos").replaceChildren(nota)

  pie({
    cancelar: { texto: "Cerrar", al: cerrar },
    siguiente: { texto: "Abrir MARS Desktop", al: () => invoke("abrir_instalado", { componente: "mars-desktop" }).catch((e) => caja($("final-avisos"), "error", String(e))) },
  })
}

// --- 6. Desinstalar ---------------------------------------------------------

function pintarDesinstalar() {
  mostrarPaso("desinstalar")
  const inst = estado.sistema.instalado
  if (!inst) {
    caja($("desinstalar-aviso"), "error", "No hay ninguna instalación registrada.")
    pie({ cancelar: { texto: "Cerrar", al: cerrar } })
    return
  }

  resumen($("desinstalar-resumen"), [
    ["Edición", inst.edicion === "tools" ? "Solo herramientas" : "MARS completo"],
    ["Versión", inst.version],
    ["Carpeta", inst.carpeta],
    ["Se borrarán", `${inst.archivos.length} archivos y ${inst.atajos.length} accesos directos`],
  ])

  $("chk-datos").checked = false
  const pintarAviso = () => {
    $("desinstalar-aviso").textContent = $("chk-datos").checked
      ? "Se van a borrar también tus preferencias, los layouts guardados y los packs de assets 3D descargados. Esto no se puede deshacer."
      : "Tus preferencias, layouts y assets 3D se conservan por si volvés a instalar."
  }
  $("chk-datos").onchange = pintarAviso
  pintarAviso()

  pie({
    atras: { texto: "Atrás", al: () => pintarInicio() },
    cancelar: { texto: "Cerrar", al: cerrar },
    desinstalar: { texto: "Desinstalar ahora", al: () => correrDesinstalacion() },
  })
}

async function correrDesinstalacion() {
  mostrarPaso("progreso")
  $("progreso-titulo").textContent = "Desinstalando"
  $("bitacora").replaceChildren()
  progreso(30, "Quitando archivos y accesos directos…")
  pie({})

  try {
    const mensaje = await invoke("desinstalar", { borrarDatos: $("chk-datos").checked })
    progreso(100, "Listo")
    mostrarPaso("final")
    $("final-titulo").textContent = "MARS se desinstaló"
    $("final-lede").textContent = mensaje
    $("final-resumen").replaceChildren()
    $("final-avisos").replaceChildren()
    pie({ cancelar: { texto: "Cerrar", al: cerrar } })
  } catch (e) {
    progreso(100, "No se pudo desinstalar")
    bitacora(String(e), "error")
    pie({
      cancelar: { texto: "Cerrar", al: cerrar },
      siguiente: { texto: "Reintentar", al: () => correrDesinstalacion() },
    })
  }
}

// --- Auxiliares -------------------------------------------------------------

function nombreComponente(id) {
  return id === "mars-simulation-studio" ? "MARS Simulation Studio" : "MARS Desktop"
}

arrancar()
