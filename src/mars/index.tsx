// Edición COMPLETA: todo lo que depende del framework MARS.
//
// Este archivo es el único punto por el que el resto de la app alcanza a las
// páginas de proyecto, paquetes, manifiesto y estado de subsistemas. El alias
// `@mars` de vite.config.ts apunta acá en la edición Full y a
// `index.tools.tsx` en la edición Tools; como ninguna otra parte del código
// importa esas páginas, en Tools el bundler ni siquiera las incluye.
//
// Si agregás una página que lea del proyecto MARS o de un topic que publique
// el framework, va acá — no en App.tsx.

import ProjectBuilderPage from "../pages/ProjectBuilderPage"
import ProjectVariablesPage from "../pages/ProjectVariablesPage"
import ManifestPage from "../pages/ManifestPage"
import PackagePage from "../pages/PackagePage"
import SubsystemWizardPage from "../pages/SubsystemWizardPage"
import FeatureWizardPage from "../pages/FeatureWizardPage"
import SubsystemsPage from "../pages/SubsystemsPage"
import WatchdogPage from "../pages/WatchDogPage"
import type { MarsNavItem, MarsPageContext, MarsSurface } from "./types"
import type { Page } from "../store/appStore"

export const MARS_ENABLED = true
export const HAS_SIM_STUDIO = true

export const PROJECT_ITEMS: readonly MarsNavItem[] = [
  { svg: "add.svg", icon: "ti-plus", label: "New Project", page: "creator", desc: "Start from scratch" },
  { svg: "packages.svg", icon: "ti-package", label: "Packages", page: "packages", desc: "Browse and install MARS modules" },
  { svg: "wizard.svg", icon: "ti-file-plus", label: "Wizard", page: "wizard", desc: "Guided subsystem setup" },
  { svg: "create-feature.svg", icon: "ti-puzzle", label: "Create Feature", page: "feature", desc: "Package and publish a MARS feature" },
]

export const MODULE_ITEMS: readonly MarsNavItem[] = [
  { svg: "variables.svg", icon: "ti-variable", label: "Variables", page: "variables", desc: "Units and raw types" },
  { svg: "manifest.svg", icon: "ti-blocks", label: "Manifest", page: "manifest", desc: "Hardware modules detected" },
]

export const CONFIG_ITEMS: readonly MarsNavItem[] = [
  { svg: "subsystems.svg", icon: "ti-layout-grid", label: "Subsystems", page: "subsystems", desc: "Live color, code and message per subsystem" },
  { svg: "watchdog.svg", icon: "ti-clock", label: "Watchdog", page: "watchdog", desc: "Subsystem loop health" },
]

export function renderMarsPage(page: Page, ctx: MarsPageContext) {
  switch (page) {
    case "creator": return <ProjectBuilderPage />
    case "variables": return <ProjectVariablesPage projectName={ctx.projectName} projectPath={ctx.projectPath} />
    case "manifest": return <ManifestPage projectName={ctx.projectName} projectPath={ctx.projectPath} />
    case "packages": return <PackagePage projectName={ctx.projectName} projectPath={ctx.projectPath} />
    case "wizard": return <SubsystemWizardPage projectPath={ctx.projectPath} />
    case "feature": return <FeatureWizardPage projectPath={ctx.projectPath} />
    case "subsystems": return (
      <SubsystemsPage
        projectName={ctx.projectName}
        topics={ctx.topics}
        connection={ctx.connection}
        logSource={ctx.logSource}
      />
    )
    case "watchdog": return <WatchdogPage projectName={ctx.projectName} topics={ctx.topics} />
    default: return null
  }
}

// Chequeo de tipos: si una edición se desvía del contrato, falla el build y no
// en runtime con media interfaz muerta.
const _surface: MarsSurface = { MARS_ENABLED, HAS_SIM_STUDIO, PROJECT_ITEMS, MODULE_ITEMS, CONFIG_ITEMS, renderMarsPage }
void _surface
