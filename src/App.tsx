import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import "./styles/global.css"
import MenuBar from "./components/layout/MenuBar"
import Sidebar, { TOOL_KIND_META } from "./components/layout/Sidebar"
import StatusBar from "./components/layout/StatusBar"
import WelcomePage from "./pages/WelcomePage"
import SettingsPage from "./pages/SettingsPage"
import PhonePage from "./pages/PhonePage"
import TelemetryPage from "./pages/TelemetryPage"
import DisplayPage from "./pages/DisplayPage"
import FunctionPage from "./pages/FunctionPage"
import FieldPage from "./pages/FieldPage"
import Field3dPage from "./pages/Field3dPage"
import SwervePage from "./pages/SwervePage"
import Swerve3dPage from "./pages/Swerve3dPage"
import MechanismPage from "./pages/MechanismPage"
import Mechanism3dPage from "./pages/Mechanism3dPage"
import NTSessionPage from "./pages/NTSessionPage"
import EquationsPage from "./pages/EquationsPage"
import TimelineGlobal from "./components/layout/TimelineGlobal"

// Todo lo que depende del framework MARS entra por acá. En la edición Tools el
// alias `@mars` resuelve a un stub y ninguna de esas páginas llega al bundle
// (ver src/mars/README.md).
import { MARS_ENABLED, renderMarsPage } from "@mars"
import { MARS_PRODUCT_NAME } from "./constants/edition"

import {
  defaultState, AppState, Page, TopicAnnounce, DashboardWidget, FunctionSeriesConfig,
  ToolKind, WorkspaceTab, FieldObjectConfig, FieldSettings, defaultFieldSettings,
  Field3dObjectConfig, Field3dSettings, defaultField3dSettings,
  SwerveSourceConfig, SwerveSettings, defaultSwerveSettings,
  Swerve3dSettings, defaultSwerve3dSettings,
  FunctionSettings, defaultFunctionSettings,
  MechanismSourceConfig, MechanismSettings, defaultMechanismSettings,
  Mechanism3dPart, Mechanism3dSettings, defaultMechanism3dSettings,
  NTSessionEntry, NTSessionSettings, defaultNTSessionSettings,
  EquationVariable, EquationConfig, LogSource,
} from "./store/appStore"
import { saveLayout, loadLayout } from "./store/workspacePersistence"
import { SplashProgress } from "./utils/splash"
import { useStructSchemas } from "./hooks/useStructSchemas"
import { useMarkerStore } from "./store/markerStore"
import { useSysIdStore } from "./store/sysidStore"
import { useNTTableTypes } from "./hooks/useNTTableTypes"
import { useSelectionStore } from "./store/selectionStore"
import CommandConsolePage from "./pages/CommandConsolePage"
import JitterAnalyzerPage from "./pages/JitterAnalyzerPage"
import BandwidthPage from "./pages/BandwidthPage"
import SysIdPage from "./pages/SysIdPage"
import PreferencesPage from "./pages/PreferencesPage"

// Contador para ids únicos aunque se generen varios en el mismo tick.
let idCounter = 0
const nextObjectId = () => `${Date.now()}-${idCounter++}`

function App() {
  const [state, setState] = useState<AppState>(defaultState)

  const navigate = (page: Page) => setState(prev => ({ ...prev, currentPage: page, activeTabId: null }))

  // Registra los schemas de struct que publica el robot (o que trae el log),
  // para entender tipos que no están en la tabla escrita a mano.
  useStructSchemas(state.topics)

  // Lee los ".type" de las tablas sendable, que es lo que permite reconocer un
  // Field2d (su raíz no es un topic, así que no se puede deducir del announce).
  useNTTableTypes(state.topics)

  // --- LÓGICA DE GESTIÓN DE PESTAÑAS (Telemetry/Display/Function/Visualizer) ---
  // Nunca se crean solas: solo se llega acá desde un click explícito en "+"
  // del Sidebar, el menú View, o el panel "Live Data" del Welcome.
  const createTab = (kind: ToolKind) => {
    const id = Date.now().toString()
    setState(prev => {
      const count = prev.openTabs.filter(t => t.kind === kind).length + 1
      const title = count === 1 ? TOOL_KIND_META[kind].label : `${TOOL_KIND_META[kind].label} ${count}`
      const newTab: WorkspaceTab = {
        id, kind, title,
        widgets: [], functionSeries: [], functionSettings: defaultFunctionSettings,
        fieldObjects: [], fieldSettings: defaultFieldSettings,
        field3dObjects: [], field3dSettings: defaultField3dSettings,
        swerveSources: [], swerveSettings: defaultSwerveSettings,
        swerve3dSettings: defaultSwerve3dSettings,
        mechanismSources: [], mechanismSettings: defaultMechanismSettings,
        mechanism3dParts: [], mechanism3dSettings: defaultMechanism3dSettings,
        ntSessionEntries: [], ntSessionSettings: defaultNTSessionSettings,
        equationVars: [], equations: [],
      }
      return { ...prev, openTabs: [...prev.openTabs, newTab], activeTabId: id }
    })
  }

  const closeTab = (id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.filter(t => t.id !== id),
      activeTabId: prev.activeTabId === id ? null : prev.activeTabId,
    }))
  }

  const renameTab = (id: string, title: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === id ? { ...t, title } : t)
    }))
  }

  const setActiveTab = (id: string) => setState(prev => ({ ...prev, activeTabId: id }))

  // --- LÓGICA DE GESTIÓN DE WIDGETS (por pestaña "display") ---
  const addWidget = (tabId: string, widget: Omit<DashboardWidget, "id">) => {
    const newWidget = { ...widget, id: Date.now().toString() };
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, widgets: [...t.widgets, newWidget] } : t)
    }))
  }

  const removeWidget = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, widgets: t.widgets.filter(w => w.id !== id) } : t)
    }))
  }

  const updateWidget = (tabId: string, id: string, updates: Partial<DashboardWidget>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, widgets: t.widgets.map(w => w.id === id ? { ...w, ...updates } : w) }
        : t)
    }))
  }

  const reorderWidgets = (tabId: string, newOrder: DashboardWidget[]) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, widgets: newOrder } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DE SERIES DE LA FUNCTION PAGE (por pestaña "functions") ---
  const addFunctionSeries = (tabId: string, series: Omit<FunctionSeriesConfig, "id">) => {
    // nextObjectId y no Date.now(): duplicar una serie crea dos en el mismo
    // milisegundo y compartirían el id que React usa como key.
    const newSeries = { ...series, id: nextObjectId() }
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, functionSeries: [...t.functionSeries, newSeries] } : t)
    }))
  }

  const removeFunctionSeries = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, functionSeries: t.functionSeries.filter(s => s.id !== id) } : t)
    }))
  }

  const updateFunctionSettings = (tabId: string, updates: Partial<FunctionSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, functionSettings: { ...t.functionSettings, ...updates } } : t)
    }))
  }

  const updateFunctionSeries = (tabId: string, id: string, updates: Partial<FunctionSeriesConfig>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, functionSeries: t.functionSeries.map(s => s.id === id ? { ...s, ...updates } : s) }
        : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DEL 2D VISUALIZER (por pestaña "visualizer") ---
  const addFieldObject = (tabId: string, object: Omit<FieldObjectConfig, "id">): string => {
    // nextObjectId y no Date.now(): al soltar una tabla Field2d entera se
    // agregan varios objetos dentro del MISMO milisegundo y todos saldrían
    // con el mismo id, que React usa como key.
    const newObject = { ...object, id: nextObjectId() }
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, fieldObjects: [...t.fieldObjects, newObject] } : t)
    }))
    // El id se devuelve porque el 2D Visualizer lo necesita para pasarle al
    // objeto nuevo el historial de estelas del que acaba de duplicar.
    return newObject.id
  }

  const removeFieldObject = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, fieldObjects: t.fieldObjects.filter(o => o.id !== id) } : t)
    }))
  }

  const updateFieldObject = (tabId: string, id: string, updates: Partial<FieldObjectConfig>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, fieldObjects: t.fieldObjects.map(o => o.id === id ? { ...o, ...updates } : o) }
        : t)
    }))
  }

  const updateFieldSettings = (tabId: string, updates: Partial<FieldSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, fieldSettings: { ...t.fieldSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DEL FIELD 3D (por pestaña "field3d") ---
  // Deliberadamente separada de la del 2D: comparten la idea de "lista de
  // objetos sobre una cancha", pero no los tipos ni las opciones, y unificarlas
  // obligaría a que cada campo nuevo de una sirviera para la otra.
  const addField3dObject = (tabId: string, object: Omit<Field3dObjectConfig, "id">): string => {
    const newObject = { ...object, id: nextObjectId() }
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, field3dObjects: [...t.field3dObjects, newObject] } : t)
    }))
    // El id se devuelve porque la página lo necesita para pasarle al objeto
    // nuevo el historial de estelas del que acaba de duplicar.
    return newObject.id
  }

  const removeField3dObject = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? {
            ...t,
            field3dObjects: t.field3dObjects
              .filter(o => o.id !== id)
              // Un componente anclado al robot que se acaba de borrar quedaría
              // apuntando a la nada; se lo suelta para que caiga al primer
              // robot disponible en vez de dejar de dibujarse en silencio.
              .map(o => o.anchorId === id ? { ...o, anchorId: null } : o),
          }
        : t)
    }))
  }

  const updateField3dObject = (tabId: string, id: string, updates: Partial<Field3dObjectConfig>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, field3dObjects: t.field3dObjects.map(o => o.id === id ? { ...o, ...updates } : o) }
        : t)
    }))
  }

  const updateField3dSettings = (tabId: string, updates: Partial<Field3dSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, field3dSettings: { ...t.field3dSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DEL SWERVE VISUALIZER (por pestaña "swerve") ---
  const addSwerveSource = (tabId: string, source: Omit<SwerveSourceConfig, "id">) => {
    const newSource = { ...source, id: Date.now().toString() }
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, swerveSources: [...t.swerveSources, newSource] } : t)
    }))
  }

  const removeSwerveSource = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, swerveSources: t.swerveSources.filter(s => s.id !== id) } : t)
    }))
  }

  const updateSwerveSource = (tabId: string, id: string, updates: Partial<SwerveSourceConfig>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, swerveSources: t.swerveSources.map(s => s.id === id ? { ...s, ...updates } : s) }
        : t)
    }))
  }

  const updateSwerveSettings = (tabId: string, updates: Partial<SwerveSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, swerveSettings: { ...t.swerveSettings, ...updates } } : t)
    }))
  }

  const updateSwerve3dSettings = (tabId: string, updates: Partial<Swerve3dSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, swerve3dSettings: { ...t.swerve3dSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DEL MECHANISM2D (por pestaña "mechanism") ---
  // Una fuente acá es una TABLA entera de NT (prefix), no un topic suelto.
  const addMechanismSource = (tabId: string, source: Omit<MechanismSourceConfig, "id">) => {
    const newSource = { ...source, id: Date.now().toString() }
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, mechanismSources: [...t.mechanismSources, newSource] } : t)
    }))
  }

  const removeMechanismSource = (tabId: string, id: string) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, mechanismSources: t.mechanismSources.filter(s => s.id !== id) } : t)
    }))
  }

  const updateMechanismSource = (tabId: string, id: string, updates: Partial<MechanismSourceConfig>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId
        ? { ...t, mechanismSources: t.mechanismSources.map(s => s.id === id ? { ...s, ...updates } : s) }
        : t)
    }))
  }

  const updateMechanismSettings = (tabId: string, updates: Partial<MechanismSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, mechanismSettings: { ...t.mechanismSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DEL MECHANISM 3D (por pestaña "mechanism3d") ---
  // Las piezas viajan como ARRAY completo y no de a una: agregar, borrar,
  // duplicar y reparentar tocan varias filas a la vez, y la página ya tiene el
  // árbol entero para calcular el resultado.
  const setMechanism3dParts = (tabId: string, parts: Mechanism3dPart[]) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, mechanism3dParts: parts } : t)
    }))
  }

  const updateMechanism3dSettings = (tabId: string, updates: Partial<Mechanism3dSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, mechanism3dSettings: { ...t.mechanism3dSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DE LA NT SESSION (por pestaña "ntsession") ---
  const setNTSessionEntries = (tabId: string, entries: NTSessionEntry[]) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, ntSessionEntries: entries } : t)
    }))
  }

  const updateNTSessionSettings = (tabId: string, updates: Partial<NTSessionSettings>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, ntSessionSettings: { ...t.ntSessionSettings, ...updates } } : t)
    }))
  }

  // --- LÓGICA DE GESTIÓN DE ECUACIONES (por pestaña "equations") ---
  const updateTab = (tabId: string, updater: (tab: WorkspaceTab) => Partial<WorkspaceTab>) => {
    setState(prev => ({
      ...prev,
      openTabs: prev.openTabs.map(t => t.id === tabId ? { ...t, ...updater(t) } : t)
    }))
  }

  const addEquationVariable = (tabId: string, variable: Omit<EquationVariable, "id">) =>
    updateTab(tabId, t => ({ equationVars: [...t.equationVars, { ...variable, id: Date.now().toString() }] }))

  const removeEquationVariable = (tabId: string, id: string) =>
    updateTab(tabId, t => ({ equationVars: t.equationVars.filter(v => v.id !== id) }))

  const updateEquationVariable = (tabId: string, id: string, updates: Partial<EquationVariable>) =>
    updateTab(tabId, t => ({ equationVars: t.equationVars.map(v => v.id === id ? { ...v, ...updates } : v) }))

  const addEquation = (tabId: string, equation: Omit<EquationConfig, "id">) =>
    updateTab(tabId, t => ({ equations: [...t.equations, { ...equation, id: Date.now().toString() }] }))

  const removeEquation = (tabId: string, id: string) =>
    updateTab(tabId, t => ({ equations: t.equations.filter(e => e.id !== id) }))

  const updateEquation = (tabId: string, id: string, updates: Partial<EquationConfig>) =>
    updateTab(tabId, t => ({ equations: t.equations.map(e => e.id === id ? { ...e, ...updates } : e) }))

  // --- PERSISTENCIA DEL WORKSPACE ---
  // Hasta que el layout guardado termine de cargar no se autoguarda nada: si
  // no, el primer render (con openTabs vacio) pisaria el archivo antes de
  // haberlo leido.
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const markers = useMarkerStore(s => s.markers)
  const setMarkers = useMarkerStore(s => s.setMarkers)
  const sysid = useSysIdStore(s => s.config)
  const setSysidConfig = useSysIdStore(s => s.setConfig)
  const saveTimerRef = useRef<number | null>(null)
  const bootRef = useRef<SplashProgress | null>(null)

  // Secuencia de arranque. Cada paso es una llamada real al backend y mueve la
  // barra del splash: el porcentaje cuenta pasos terminados, no tiempo
  // inventado. Ninguno es imprescindible -- la app abre igual sin preferencias,
  // sin proyecto y sin layout guardado -- asi que un fallo se queda marcado en
  // rojo y el arranque sigue.
  useEffect(() => {
    let cancelled = false
    const boot = new SplashProgress()
    bootRef.current = boot

    // tauri.conf.json no sabe de ediciones: el titulo correcto solo se conoce
    // desde el bundle. En Full esto reescribe el mismo texto y no se nota.
    void getCurrentWindow().setTitle(MARS_PRODUCT_NAME).catch(() => {})

    void (async () => {
      const settings = await boot.run(
        "prefs",
        () => invoke<{ workspace_path: string; team_number: string }>("read_mars_settings"),
        s => s.team_number ? `team ${s.team_number}` : "no team number",
      )

      // Sin framework MARS no hay proyecto: el paso ni se lista (ver splash.ts).
      if (MARS_ENABLED) {
        const projectPath = settings?.workspace_path ?? ""
        if (projectPath) {
          await boot.run("project", () => invoke<string>("validate_mars_project", { path: projectPath }), name => name)
        } else {
          boot.skip("project", "not configured")
        }
      }

      await boot.run(
        "assets",
        () => invoke<unknown[]>("list_asset3d_packs"),
        packs => `${packs.length} pack${packs.length === 1 ? "" : "s"}`,
      )

      const layout = await boot.run(
        "layout",
        () => loadLayout(),
        l => l === null ? "nothing saved" : `${l.openTabs.length} tab${l.openTabs.length === 1 ? "" : "s"}`,
      )
      if (!cancelled && layout !== null) {
        setState(prev => ({ ...prev, openTabs: layout.openTabs, activeTabId: layout.activeTabId }))
        setSidebarCollapsed(layout.sidebarCollapsed)
        setMarkers(layout.markers)
        setSysidConfig(layout.sysid)
      }

      await boot.run(
        "link",
        () => invoke<{ address: string; port: number; connected: boolean }>("get_nt_link_status"),
        s => s.connected ? `${s.address}:${s.port}` : "offline",
      )

      if (!cancelled) setLayoutLoaded(true)
    })()

    return () => { cancelled = true }
  }, [])

  // El splash se saca cuando el workspace ya esta restaurado, no cuando React
  // monto: si no, se ve un cuadro de app vacia justo antes de que aparezcan las
  // pestanas guardadas, que es peor que un splash un poco mas largo. El ultimo
  // paso ("Build the interface") se cierra justo aca, que es cuando de verdad
  // termino.
  useEffect(() => {
    if (layoutLoaded) bootRef.current?.end()
  }, [layoutLoaded])

  // Debounce: arrastrar un widget dispara decenas de updates por segundo y no
  // tiene sentido escribir el archivo en cada uno.
  useEffect(() => {
    if (!layoutLoaded) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveLayout({ openTabs: state.openTabs, activeTabId: state.activeTabId, sidebarCollapsed, markers, sysid })
        .catch(err => console.warn("No se pudo guardar el layout:", err))
    }, 700)
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [state.openTabs, state.activeTabId, sidebarCollapsed, markers, sysid, layoutLoaded])

  const handleSaveLayoutAs = async () => {
    try {
      const path = await save({
        title: "Save layout",
        defaultPath: "mars-layout.json",
        filters: [{ name: "MARS layout", extensions: ["json"] }],
      })
      if (!path) return
      await saveLayout({ openTabs: state.openTabs, activeTabId: state.activeTabId, sidebarCollapsed, markers, sysid }, path)
    } catch (error) {
      alert(`Could not save layout:\n${error}`)
    }
  }

  const handleOpenLayout = async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "MARS layout", extensions: ["json"] }] })
      if (!path || typeof path !== "string") return
      const layout = await loadLayout(path)
      if (layout === null) {
        alert("That file does not contain a MARS layout.")
        return
      }
      setState(prev => ({ ...prev, openTabs: layout.openTabs, activeTabId: layout.activeTabId }))
      setSidebarCollapsed(layout.sidebarCollapsed)
      setMarkers(layout.markers)
      setSysidConfig(layout.sysid)
    } catch (error) {
      alert(`Could not open layout:\n${error}`)
    }
  }

  const handleResetLayout = () => {
    if (state.openTabs.length > 0 && !window.confirm("Close every tab and reset the layout?")) return
    setState(prev => ({ ...prev, openTabs: [], activeTabId: null }))
  }

  // --- LOGS (.wpilog) ---
  // El backend carga el log en el MISMO buffer que usa NT4, asi que todas las
  // pestanas (Field, Swerve, Mechanism, Display, Functions) leen del archivo
  // sin cambiar nada: solo cambia de donde salieron los datos.
  const handleOpenLog = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "WPILib data log", extensions: ["wpilog"] }],
      })
      if (!path || typeof path !== "string") return

      const result = await invoke<{ summary: LogSource; topics: TopicAnnounce[] }>("open_wpilog", { path })

      const topics = new Map<string, TopicAnnounce>()
      result.topics.forEach(t => topics.set(t.name, t))

      setState(prev => ({ ...prev, connection: "disconnected", topics, logSource: result.summary }))

      // Un log no tiene "ahora": se arranca parado en su primer sample, si no
      // la timeline se queda esperando datos nuevos que nunca llegan.
      if (result.summary.start_us !== null) {
        useSelectionStore.getState().pauseAt(result.summary.start_us)
      }
    } catch (error) {
      alert(`Could not open log:\n${error}`)
    }
  }

  const handleExportLog = async () => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      const path = await save({
        title: "Export log",
        defaultPath: `mars-${stamp}.wpilog`,
        filters: [{ name: "WPILib data log", extensions: ["wpilog"] }],
      })
      if (!path) return
      const summary = await invoke<{ topic_count: number; sample_count: number; bytes: number }>(
        "export_wpilog", { path },
      )
      alert(
        `Log exported.\n\n${summary.topic_count} topics, ${summary.sample_count} samples\n` +
        `${(summary.bytes / 1024 / 1024).toFixed(2)} MB`,
      )
    } catch (error) {
      alert(`Could not export log:\n${error}`)
    }
  }

  const handleCloseLog = async () => {
    try {
      await invoke("close_log")
      setState(prev => ({ ...prev, topics: new Map(), logSource: null }))
      useSelectionStore.getState().goLive()
    } catch (error) {
      console.error("Failed to close log:", error)
    }
  }

  // --- LISTENER GLOBAL DE NT4 ---
  useEffect(() => {
    const setupListeners = async () => {
      const unlistenDisconnect = await listen("nt-disconnected", () => {
        console.warn("Conexión NT4 perdida o cerrada por el servidor.")
        setState(prev => prev.logSource !== null
          // Abrir un log desconecta NT a propósito: los topics que hay ahora
          // son los del archivo, no los de la sesión que se acaba de cerrar.
          ? { ...prev, connection: "disconnected" }
          : { ...prev, connection: "disconnected", topics: new Map() })
      })

      const unlistenTopics = await listen<TopicAnnounce>("nt-topic-announced", (event) => {
        setState(prev => {
          const newTopics = new Map(prev.topics)
          newTopics.set(event.payload.name, event.payload)
          return { ...prev, topics: newTopics }
        })
      })

      // El servidor avisa cuando un topic deja de existir (su ultimo publicador
      // se fue, o MARS lo retiro desde la NT Session). Sin esto el arbol solo
      // crece y muestra topics que ya no estan.
      const unlistenUnannounce = await listen<string>("nt-topic-unannounced", (event) => {
        setState(prev => {
          if (!prev.topics.has(event.payload)) return prev
          const newTopics = new Map(prev.topics)
          newTopics.delete(event.payload)
          return { ...prev, topics: newTopics }
        })
      })

      // El backend reintenta la conexión solo (con backoff) cuando el socket
      // se cierra de forma inesperada. Este evento avisa cuando lo logró,
      // para que la UI deje de mostrar "disconnected". Los topics se
      // repueblan solos vía nt-topic-announced al re-suscribirse.
      const unlistenReconnect = await listen<string>("nt-reconnected", (event) => {
        setState(prev => ({ ...prev, connection: event.payload === "real" ? "real" : "sim" }))
      })

      return () => {
        unlistenDisconnect()
        unlistenTopics()
        unlistenUnannounce()
        unlistenReconnect()
      }
    }

    let unlistenPromise = setupListeners()
    return () => {
      unlistenPromise.then(cleanup => cleanup())
    }
  }, [])

  const handleOpenProject = async () => {
    try {
      const selectedPath = await open({ directory: true, multiple: false })
      if (selectedPath && typeof selectedPath === "string") {
        const projectName = await invoke<string>("validate_mars_project", { path: selectedPath })
        setState(prev => ({ ...prev, projectName, projectPath: selectedPath }))
      }
    } catch (error) {
      alert(`Invalid Project:\n${error}`)
    }
  } 

  const handleConnectSim = async () => {
    try {
      await invoke<string>("connect_sim")
      // Conectarse reemplaza el buffer, asi que el log que hubiera cargado
      // deja de existir: el estado tiene que reflejarlo.
      setState(prev => ({ ...prev, connection: "sim", logSource: null }))
    } catch (error) {
      console.error("Failed to connect:", error)
      alert(`NT4 Error: ${error}`)
    }
  }

  const handleConnectReal = async () => {
    try {
      // Sin argumento: el backend resuelve dirección y puerto desde Settings
      // (número de equipo, dirección custom y destino NT4).
      await invoke<string>("connect_real")
      setState(prev => ({ ...prev, connection: "real", logSource: null }))
    } catch (error) {
      console.error("Failed to connect:", error)
      alert(`NT4 Error: ${error}`)
    }
  }

  const handleDisconnect = async () => {
    try {
      await invoke("disconnect_nt")
      setState(prev => ({ ...prev, connection: "disconnected", topics: new Map() }))
    } catch (error) {
      console.error(error)
    }
  }

  const renderTab = (tab: WorkspaceTab) => {
    switch (tab.kind) {
      case "telemetry": return <TelemetryPage projectName={state.projectName} projectPath={state.projectPath} topics={state.topics} />
      case "display": return (
        <DisplayPage
          topics={state.topics}
          widgets={tab.widgets}
          onAddWidget={(w) => addWidget(tab.id, w)}
          onRemoveWidget={(id) => removeWidget(tab.id, id)}
          onUpdateWidget={(id, updates) => updateWidget(tab.id, id, updates)}
          onReorderWidgets={(newOrder) => reorderWidgets(tab.id, newOrder)}
        />
      )
      // Graficos de linea (integral/derivada) tipo AdvantageScope
      case "functions": return (
        <FunctionPage
          topics={state.topics}
          series={tab.functionSeries}
          settings={tab.functionSettings}
          onAddSeries={(s) => addFunctionSeries(tab.id, s)}
          onRemoveSeries={(id) => removeFunctionSeries(tab.id, id)}
          onUpdateSeries={(id, updates) => updateFunctionSeries(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateFunctionSettings(tab.id, updates)}
        />
      )
      case "visualizer": return (
        <FieldPage
          topics={state.topics}
          objects={tab.fieldObjects}
          settings={tab.fieldSettings}
          onAddObject={(o) => addFieldObject(tab.id, o)}
          onRemoveObject={(id) => removeFieldObject(tab.id, id)}
          onUpdateObject={(id, updates) => updateFieldObject(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateFieldSettings(tab.id, updates)}
        />
      )
      case "field3d": return (
        <Field3dPage
          topics={state.topics}
          objects={tab.field3dObjects}
          settings={tab.field3dSettings}
          onAddObject={(o) => addField3dObject(tab.id, o)}
          onRemoveObject={(id) => removeField3dObject(tab.id, id)}
          onUpdateObject={(id, updates) => updateField3dObject(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateField3dSettings(tab.id, updates)}
        />
      )
      case "swerve": return (
        <SwervePage
          topics={state.topics}
          sources={tab.swerveSources}
          settings={tab.swerveSettings}
          onAddSource={(s) => addSwerveSource(tab.id, s)}
          onRemoveSource={(id) => removeSwerveSource(tab.id, id)}
          onUpdateSource={(id, updates) => updateSwerveSource(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateSwerveSettings(tab.id, updates)}
        />
      )
      // Misma pestaña que "swerve" pero en 3D: comparte fuentes y tamaño de
      // chasis, y agrega el modelo importado y la ubicación de los módulos.
      case "swerve3d": return (
        <Swerve3dPage
          topics={state.topics}
          sources={tab.swerveSources}
          settings={tab.swerveSettings}
          view={tab.swerve3dSettings}
          onAddSource={(s) => addSwerveSource(tab.id, s)}
          onRemoveSource={(id) => removeSwerveSource(tab.id, id)}
          onUpdateSource={(id, updates) => updateSwerveSource(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateSwerveSettings(tab.id, updates)}
          onUpdateView={(updates) => updateSwerve3dSettings(tab.id, updates)}
        />
      )
      case "mechanism": return (
        <MechanismPage
          topics={state.topics}
          sources={tab.mechanismSources}
          settings={tab.mechanismSettings}
          onAddSource={(s) => addMechanismSource(tab.id, s)}
          onRemoveSource={(id) => removeMechanismSource(tab.id, id)}
          onUpdateSource={(id, updates) => updateMechanismSource(tab.id, id, updates)}
          onUpdateSettings={(updates) => updateMechanismSettings(tab.id, updates)}
        />
      )
      case "mechanism3d": return (
        <Mechanism3dPage
          topics={state.topics}
          parts={tab.mechanism3dParts}
          settings={tab.mechanism3dSettings}
          onSetParts={(parts) => setMechanism3dParts(tab.id, parts)}
          onUpdateSettings={(updates) => updateMechanism3dSettings(tab.id, updates)}
        />
      )
      // Al reves que el resto: esta pestana PUBLICA topics propios en vez de
      // leer los del robot, asi que necesita saber si hay conexion.
      case "ntsession": return (
        <NTSessionPage
          topics={state.topics}
          connection={state.connection}
          entries={tab.ntSessionEntries}
          settings={tab.ntSessionSettings}
          onSetEntries={(entries) => setNTSessionEntries(tab.id, entries)}
          onUpdateSettings={(updates) => updateNTSessionSettings(tab.id, updates)}
        />
      )
      case "equations": return (
        <EquationsPage
          topics={state.topics}
          variables={tab.equationVars}
          equations={tab.equations}
          onAddVariable={(v) => addEquationVariable(tab.id, v)}
          onRemoveVariable={(id) => removeEquationVariable(tab.id, id)}
          onUpdateVariable={(id, updates) => updateEquationVariable(tab.id, id, updates)}
          onAddEquation={(e) => addEquation(tab.id, e)}
          onRemoveEquation={(id) => removeEquation(tab.id, id)}
          onUpdateEquation={(id, updates) => updateEquation(tab.id, id, updates)}
        />
      )
    }
  }

  const renderPage = () => {
    const activeTab = state.activeTabId ? state.openTabs.find(t => t.id === state.activeTabId) : undefined
    if (activeTab) return renderTab(activeTab)

    // Las páginas del framework MARS se resuelven primero y viven en su propio
    // módulo: en la edición Tools esto siempre devuelve null y cae al switch,
    // que ya no tiene esos casos. Ninguna de las dos ediciones se entera.
    const marsPage = renderMarsPage(state.currentPage, {
      projectName: state.projectName,
      projectPath: state.projectPath,
      topics: state.topics,
      connection: state.connection,
      logSource: state.logSource,
    })
    if (marsPage) return marsPage

    switch (state.currentPage) {
      case "welcome": return (
      <WelcomePage
          navigate={navigate}
          onOpenProject={handleOpenProject}
          connection={state.connection}
          onConnectSim={handleConnectSim}
          onConnectReal={handleConnectReal}
          onDisconnect={handleDisconnect}
          onCreateTab={createTab}
          projectName={state.projectName}
        />
      )
      case "settings": return <SettingsPage />
      case "bandwidth": return <BandwidthPage connection={state.connection} logSource={state.logSource} />
      case "sysid": return (
        <SysIdPage topics={state.topics} connection={state.connection} logSource={state.logSource} />
      )
      // Hermana persistente de la NT Session: lo que se escribe en /Preferences
      // sobrevive un reinicio del robot.
      case "preferences": return (
        <PreferencesPage topics={state.topics} connection={state.connection} />
      )
      case "phone": return <PhonePage />
      case "jitter" : return (<JitterAnalyzerPage connection={state.connection} topics={state.topics}></JitterAnalyzerPage>)
      case "console" : return (<CommandConsolePage connection={state.connection} topics={state.topics}></CommandConsolePage>)
      default: return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Page "{state.currentPage}" — coming soon</p>
        </div>
      )
    }
  }

  return (
    <div className="app-root" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <MenuBar
        navigate={navigate}
        currentPage={state.currentPage}
        onOpenProject={handleOpenProject}
        connection={state.connection}
        onConnectSim={handleConnectSim}
        onConnectReal={handleConnectReal}
        onDisconnect={handleDisconnect}
        onCreateTab={createTab}
        logSource={state.logSource}
        onOpenLog={handleOpenLog}
        onExportLog={handleExportLog}
        onCloseLog={handleCloseLog}
        onSaveLayoutAs={handleSaveLayoutAs}
        onOpenLayout={handleOpenLayout}
        onResetLayout={handleResetLayout}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        sidebarCollapsed={sidebarCollapsed}
        projectName={state.projectName}
      />
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <Sidebar
          navigate={navigate}
          currentPage={state.currentPage}
          onOpenProject={handleOpenProject}
          connection={state.connection}
          onConnectSim={handleConnectSim}
          onConnectReal={handleConnectReal}
          onDisconnect={handleDisconnect}
          openTabs={state.openTabs}
          activeTabId={state.activeTabId}
          onCreateTab={createTab}
          onSelectTab={setActiveTab}
          onRenameTab={renameTab}
          onCloseTab={closeTab}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", position: "relative" }}>
          {renderPage()}
        </div>
      </div>

      {/* Panel de tiempo abajo de todo, ancho completo — la misma posición que
          el dock "Time" de RViz (arriba de la barra de estado). */}
      <TimelineGlobal connection={state.connection} hasLog={state.logSource !== null} />
      <StatusBar connection={state.connection} projectName={state.projectName} logSource={state.logSource} />
    </div>
  )
}

export default App
