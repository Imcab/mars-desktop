import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { listen } from "@tauri-apps/api/event"
import "./styles/global.css"
import TitleBar from "./components/layout/TitleBar"
import MenuBar from "./components/layout/MenuBar"
import ToolBar from "./components/layout/ToolBar"
import StatusBar from "./components/layout/StatusBar"
import WelcomePage from "./pages/WelcomePage"
import SettingsPage from "./pages/SettingsPage"
import ProjectBuilderPage from "./pages/ProjectBuilderPage"
import PhonePage from "./pages/PhonePage"
import ProjectVariablesPage from "./pages/ProjectVariablesPage"
import ManifestPage from "./pages/ManifestPage"
import PackagePage from "./pages/PackagePage"
import TelemetryPage from "./pages/TelemetryPage"
import DisplayPage from "./pages/DisplayPage"
import FunctionPage from "./pages/FunctionPage"
import TimelineGlobal from "./components/layout/TimelineGlobal" 

import { defaultState, AppState, Page, TopicAnnounce, DashboardWidget, FunctionSeriesConfig } from "./store/appStore"
import SubsystemWizardPage from "./pages/SubsystemWizardPage"

function App() {
  const [state, setState] = useState<AppState>(defaultState)

  const navigate = (page: Page) => setState(prev => ({ ...prev, currentPage: page }))

  // --- LÓGICA DE GESTIÓN DE WIDGETS ---
  const addWidget = (widget: Omit<DashboardWidget, "id">) => {
    const newWidget = { ...widget, id: Date.now().toString() };
    setState(prev => ({ ...prev, widgets: [...prev.widgets, newWidget] }))
  }

  const removeWidget = (id: string) => {
    setState(prev => ({ ...prev, widgets: prev.widgets.filter(w => w.id !== id) }))
  }

  const updateWidget = (id: string, updates: Partial<DashboardWidget>) => {
    setState(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === id ? { ...w, ...updates } : w)
    }))
  }

  const reorderWidgets = (newOrder: DashboardWidget[]) => {
    setState(prev => ({ ...prev, widgets: newOrder }))
  }

  // --- LÓGICA DE GESTIÓN DE SERIES DE LA FUNCTION PAGE ---
  const addFunctionSeries = (series: Omit<FunctionSeriesConfig, "id">) => {
    const newSeries = { ...series, id: Date.now().toString() }
    setState(prev => ({ ...prev, functionSeries: [...prev.functionSeries, newSeries] }))
  }

  const removeFunctionSeries = (id: string) => {
    setState(prev => ({ ...prev, functionSeries: prev.functionSeries.filter(s => s.id !== id) }))
  }

  const updateFunctionSeries = (id: string, updates: Partial<FunctionSeriesConfig>) => {
    setState(prev => ({
      ...prev,
      functionSeries: prev.functionSeries.map(s => s.id === id ? { ...s, ...updates } : s)
    }))
  }

  // --- LISTENER GLOBAL DE NT4 ---
  useEffect(() => {
    const setupListeners = async () => {
      const unlistenDisconnect = await listen("nt-disconnected", () => {
        console.warn("Conexión NT4 perdida o cerrada por el servidor.")
        setState(prev => ({ ...prev, connection: "disconnected", topics: new Map() }))
      })

      const unlistenTopics = await listen<TopicAnnounce>("nt-topic-announced", (event) => {
        setState(prev => {
          const newTopics = new Map(prev.topics)
          newTopics.set(event.payload.name, event.payload)
          return { ...prev, topics: newTopics }
        })
      })

      return () => {
        unlistenDisconnect()
        unlistenTopics()
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
      setState(prev => ({ ...prev, connection: "sim" }))
    } catch (error) {
      console.error("Failed to connect:", error)
      alert(`NT4 Error: ${error}`)
    }
  }

  const handleConnectReal = async () => {
    try {
      await invoke<string>("connect_real", { teamNumber: "3472" })
      setState(prev => ({ ...prev, connection: "real" }))
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

  const renderPage = () => {
    switch (state.currentPage) {
      case "welcome": return (
      <WelcomePage 
          navigate={navigate} 
          onOpenProject={handleOpenProject}
          connection={state.connection}
          onConnectSim={handleConnectSim}
          onConnectReal={handleConnectReal}
          onDisconnect={handleDisconnect}
          projectName={state.projectName}
        />
      )
      case "settings": return <SettingsPage />
      case "creator": return <ProjectBuilderPage />
      case "phone": return <PhonePage />
      case "variables": return <ProjectVariablesPage projectName={state.projectName} projectPath={state.projectPath} />
      case "manifest": return <ManifestPage projectName={state.projectName} projectPath={state.projectPath} />
      case "packages": return <PackagePage projectName={state.projectName} projectPath={state.projectPath} />
      case "telemetry": return <TelemetryPage projectName={state.projectName} topics={state.topics} /> 
      case "display": return (
        <DisplayPage 
          topics={state.topics} 
          widgets={state.widgets} 
          onAddWidget={addWidget} 
          onRemoveWidget={removeWidget} 
          onUpdateWidget={updateWidget} 
          onReorderWidgets={reorderWidgets}
        />
      )
      // NUEVA PAGINA: graficos de linea (integral/derivada) tipo AdvantageScope
      case "functions": return (
        <FunctionPage
          topics={state.topics}
          series={state.functionSeries}
          onAddSeries={addFunctionSeries}
          onRemoveSeries={removeFunctionSeries}
          onUpdateSeries={updateFunctionSeries}
        />
      )
      case "wizard": return <SubsystemWizardPage projectPath={state.projectPath} />
      default: return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Page "{state.currentPage}" — coming soon</p>
        </div>
      )
    }
  }

  return (
    <div className="app-root" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <TitleBar />
      <MenuBar 
        navigate={navigate} 
        currentPage={state.currentPage}
        onOpenProject={handleOpenProject}
        connection={state.connection}
        onConnectSim={handleConnectSim}
        onConnectReal={handleConnectReal}
        onDisconnect={handleDisconnect}
      />
      <ToolBar 
          navigate={navigate} 
          currentPage={state.currentPage} 
          onOpenProject={handleOpenProject} 
          connection={state.connection}
          onConnectSim={handleConnectSim}
          onConnectReal={handleConnectReal}
          onDisconnect={handleDisconnect}
      />
      
      <TimelineGlobal connection={state.connection} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        {renderPage()}
      </div>
      <StatusBar connection={state.connection} projectName={state.projectName} />
    </div>
  )
}

export default App
