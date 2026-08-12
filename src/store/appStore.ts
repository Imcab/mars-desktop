export type Page = "welcome" | "visualizer" | "packages" | "settings" | "telemetry" | "display" | "functions" | "variables" | "phone" | "about" | "creator" | "manifest"| "wizard"
export type ConnectionState = "disconnected" | "sim" | "real"

// =====================================================================
// AÑADIR A appStore.ts
// 1. Agrega "wizard" al union type Page (arriba del archivo)
// 2. Pega los tipos de abajo en cualquier parte del archivo
// =====================================================================

// Page: agrega "wizard" así:
// export type Page = "welcome" | "visualizer" | "packages" | "settings" | "telemetry" | "display" | "functions" | "variables" | "phone" | "about" | "creator" | "manifest" | "wizard"

// --- Subsystem Generator Wizard ---

export type JavaFieldType =
  | "double"
  | "boolean"
  | "int"
  | "String"
  | "Rotation2d"
  | "Translation2d"
  | "Pose2d"

// Un campo dentro de <Module>Inputs extends Data<...>
export interface IOInputField {
  id: string
  name: string          // ej. "position"
  type: JavaFieldType
  hasUnit: boolean       // solo aplica si el proyecto tiene UnitProcessor y type === "double"
  unitValue?: string     // ej. "Degrees"
  unitGroup?: string     // ej. "Intake"
}

export type Severity = "OK" | "WARNING" | "ERROR"

// Un ModuleColorCode.solid(...) dentro del subsistema
export interface ColorCodeEntry {
  id: string
  name: string          // IDLE, ON_TARGET...
  severity: Severity
  color: string          // nombre WPI sin "k", ej. "DarkGreen"
  description: string    // puede incluir %.2f etc.
}

export interface SubsystemWizardConfig {
  // Paso 1 — ubicación
  targetDir: string       // carpeta elegida con el dialog nativo
  javaPackage: string      // paquete derivado o editado a mano
  moduleName: string       // "Arm" -> Arm.java / ArmIO.java
  separateFolder: boolean  // true: <targetDir>/arm/Arm.java, false: <targetDir>/Arm.java

  // Paso 2 — IO
  inputs: IOInputField[]
  useProjectUnits: boolean  // detectado leyendo workspace-mars/features/UnitProcessor.json
  outputUnitValue: string    // unidad para applyOutput, default "Volts"
  outputUnitGroup: string    // grupo para applyOutput, default = moduleName

  // Paso 3 — diagnostics
  colorCodes: ColorCodeEntry[]
}

export const defaultWizardConfig: SubsystemWizardConfig = {
  targetDir: "",
  javaPackage: "",
  moduleName: "",
  separateFolder: true,
  inputs: [],
  useProjectUnits: false,
  outputUnitValue: "Volts",
  outputUnitGroup: "",
  colorCodes: [],
}

export interface TopicAnnounce {
  id: number
  name: string
  topic_type: string
}

// Constantes del canvas de la Dashboard (Display page).
// GRID_CELL = tamaño en px de una celda de la cuadrícula.
// MIN_WIDGET_W / MIN_WIDGET_H = tamaño mínimo (en celdas) al que se puede
// encoger un widget al estirarlo con el mouse.
export const GRID_CELL = 48
export const MIN_WIDGET_W = 3
export const MIN_WIDGET_H = 3

// Interfaz para los widgets del Dashboard
export interface DashboardWidget {
  id: string           // ID único para React (ej. date.now)
  topicName: string     // La ruta de la variable
  topicType: string
  label: string          // Nombre editable
  style: string          // "Simple", "Box", "Custom", etc.
  customTrue?: string
  customFalse?: string
  min?: number
  max?: number
  unit?: string           // Unidad mostrada: sufijo libre en doubles, "deg"/"rad" en Rotation2d
  width: number          // Ancho en celdas de cuadrícula
  height: number         // Alto en celdas de cuadrícula
  x: number              // Posición X en celdas de cuadrícula
  y: number              // Posición Y en celdas de cuadrícula

  // Cuando el widget viene de arrastrar un índice puntual de un struct:X[]
  // (ej. ModulePositions[2]) en vez del array completo. El topicName/topicType
  // siguen siendo los del array; esto solo indica qué slice mostrar.
  arrayIndex?: number

  // --- Match Time ---
  matchTimeMode?: "mmss" | "seconds"   // formato de despliegue (default "mmss")
  matchTimeYellow?: number             // seg. a partir de los cuales se pone amarillo (default 30)
  matchTimeRed?: number                // seg. a partir de los cuales se pone rojo (default 15)

  // --- Graph ---
  graphTimeDisplayed?: number   // ventana de tiempo mostrada, en segundos (default 5)
  graphColor?: string           // color de la línea en hex (default mars-accent)
  graphLineWidth?: number       // grosor de la línea en px (default 2)
  graphAutoRange?: boolean      // si el eje Y se autoescala con los datos (default true)
  graphMin?: number             // rango Y fijo (solo si graphAutoRange = false)
  graphMax?: number             // rango Y fijo (solo si graphAutoRange = false)

  // --- Radial Gauge ---
  gaugeStartAngle?: number      // grados, CW+ (default -140)
  gaugeEndAngle?: number        // grados, CW+ (default 140)
  gaugeMin?: number             // default 0
  gaugeMax?: number             // default 100
  gaugeNumberOfLabels?: number  // default 8
  gaugeWrapValue?: boolean      // envuelve el valor dentro del rango, útil para gyros (default false)
  gaugeShowPointer?: boolean    // muestra la aguja (default true)
  gaugeShowTicks?: boolean      // muestra las marcas/etiquetas (default true)

  // --- Voltage View ---
  voltageMin?: number           // default 4
  voltageMax?: number           // default 13
  voltageDivisions?: number     // default 5
  voltageInverted?: boolean     // default false
  voltageOrientation?: "horizontal" | "vertical"  // default "horizontal"
}

// --- Function Page (gráficos de línea tipo AdvantageScope) ---
export type FunctionTransform = "raw" | "integral" | "derivative"
export type FunctionAxis = "left" | "right"

export type SeriesOperator = "add" | "subtract" | "multiply" | "divide"

export interface SeriesCombine {
  operator: SeriesOperator
  withSeriesId: string   // id de otra serie dentro del mismo array `series[]`
}

export interface FunctionSeriesConfig {
  id: string
  topicName: string   // solo topics numéricos (double/int/float)
  label: string        // nombre editable, default = último segmento del path
  color: string         // color de línea en hex
  transform: FunctionTransform  // raw | integral (trapecios) | derivative (dif. finitas)
  axis: FunctionAxis
  combine?: SeriesCombine | null    // NEW — álgebra entre series
  errorTargetId?: string | null     // NEW — id de la serie "target/setpoint"
}

export interface AppState {
  currentPage: Page
  connection: ConnectionState
  projectName: string | null
  projectPath: string | null
  topics: Map<string, TopicAnnounce>
  widgets: DashboardWidget[]
  functionSeries: FunctionSeriesConfig[]
}

export const defaultState: AppState = {
  currentPage: "welcome",
  connection: "disconnected",
  projectName: null,
  projectPath: null,
  topics: new Map(),
  widgets: [],
  functionSeries: [],
}
