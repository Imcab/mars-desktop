import { CoordinateSystem, FIELDS, SCHEMATIC_FIELD_KEY } from "../utils/field/fieldImages"
import { Field3dCoordinateSystem as Field3dCoordinateSystemKey } from "../utils/field3d/frames"

export type Page = "welcome" | "packages" | "settings" | "variables" | "phone" | "about" | "creator" | "manifest"| "wizard" | "feature" | "watchdog" | "console" | "jitter" | "bandwidth" | "sysid" | "preferences" | "subsystems"
export type ConnectionState = "disconnected" | "sim" | "real"

// --- Herramientas con instancias múltiples (estilo pestañas de AdvantageScope) ---
// A diferencia de las Page (singleton, navegación fija), estas se crean
// explícitamente desde el Sidebar/MenuBar/WelcomePage, pueden existir varias
// a la vez y cada una guarda su propio estado (widgets/series).
export type ToolKind = "visualizer" | "field3d" | "swerve" | "swerve3d" | "mechanism" | "mechanism3d" | "ntsession" | "telemetry" | "display" | "functions" | "equations"

export interface WorkspaceTab {
  id: string
  kind: ToolKind
  title: string
  widgets: DashboardWidget[]             // solo usado si kind === "display"
  functionSeries: FunctionSeriesConfig[] // solo usado si kind === "functions"
  functionSettings: FunctionSettings     // solo usado si kind === "functions"
  fieldObjects: FieldObjectConfig[]      // solo usado si kind === "visualizer"
  fieldSettings: FieldSettings           // solo usado si kind === "visualizer"
  field3dObjects: Field3dObjectConfig[]  // solo usado si kind === "field3d"
  field3dSettings: Field3dSettings       // solo usado si kind === "field3d"
  swerveSources: SwerveSourceConfig[]    // usado por kind === "swerve" y "swerve3d"
  swerveSettings: SwerveSettings         // usado por kind === "swerve" y "swerve3d"
  swerve3dSettings: Swerve3dSettings     // solo usado si kind === "swerve3d"
  mechanismSources: MechanismSourceConfig[]  // solo usado si kind === "mechanism"
  mechanismSettings: MechanismSettings       // solo usado si kind === "mechanism"
  mechanism3dParts: Mechanism3dPart[]        // solo usado si kind === "mechanism3d"
  mechanism3dSettings: Mechanism3dSettings   // solo usado si kind === "mechanism3d"
  ntSessionEntries: NTSessionEntry[]         // solo usado si kind === "ntsession"
  ntSessionSettings: NTSessionSettings       // solo usado si kind === "ntsession"
  equationVars: EquationVariable[]       // solo usado si kind === "equations"
  equations: EquationConfig[]            // solo usado si kind === "equations"
}

// --- Equations ---

// Enlaza un nombre corto usable en las fórmulas (x, theta, v_max) con el
// topic double del que sale su valor.
export interface EquationVariable {
  id: string
  name: string
  topicName: string
}

export interface EquationConfig {
  id: string
  /** Nombre con el que OTRAS ecuaciones pueden referenciar a esta. */
  name: string
  expression: string
  /** Unidad opcional que se muestra junto al resultado (no participa del cálculo). */
  unit: string
  decimals: number
}

// --- 2D Visualizer (cancha tipo Field2d de AdvantageScope) ---

// robot      = chasis con bumpers de color + flecha de dirección, o el modelo
//              3D del equipo visto desde arriba (ver `robotRender`)
// ghost      = mismo chasis, translúcido (setpoint / pose estimada alternativa)
// trajectory = polilínea que une las traslaciones de un Pose2d[]
// arrow      = solo la flecha de dirección, sin chasis
// heatmap    = mapa de calor de por dónde pasó el objeto a lo largo del tiempo
// target     = marcas de visión, con la línea que las une al robot
// swerve     = vectores de los cuatro módulos, anclados al robot
export type FieldObjectType =
  | "robot" | "ghost" | "trajectory" | "arrow" | "heatmap" | "target" | "swerve"

/** Dónde nace la flecha respecto de la pose: frente, centro o parte trasera. */
export type ArrowAnchor = "front" | "center" | "back"

export type TrajectoryStyle = "solid" | "dashed" | "points" | "gradient"

export interface FieldObjectConfig {
  id: string
  topicName: string
  topicType: string
  label: string
  type: FieldObjectType
  color: string

  // --- Opciones por objeto -------------------------------------------------
  // Todas son OPCIONALES a propósito: un layout guardado por una versión
  // anterior no las trae, y el renderer les aplica su default (ver
  // `resolveObjectOptions` en utils/field/fieldObjects.ts). Así agregar una
  // opción nueva nunca invalida los layouts que la gente ya tenía.

  /** Sigue en la lista pero no se dibuja. */
  hidden?: boolean
  /** 0..1. Default 1. */
  opacity?: number
  /** Nombre + (x, y, θ) flotando junto al objeto. */
  showLabel?: boolean
  /** Segundos de estela. 0 = sin estela. */
  trailSeconds?: number
  /** Color propio de la estela. null/ausente = el mismo color del objeto. */
  trailColor?: string | null

  // robot / ghost
  /** Dibuja el modelo 3D en vez del icono. Default: lo que diga FieldSettings. */
  useModel?: boolean

  // arrow
  arrowAnchor?: ArrowAnchor
  /** Largo de la flecha en metros. */
  arrowLength?: number

  // trajectory
  trajectoryStyle?: TrajectoryStyle
  /** Grosor en píxeles de pantalla (no escala con el zoom). */
  trajectoryWidth?: number
  /** Punto en cada waypoint del array. */
  showWaypoints?: boolean
  /** Flechas de heading repartidas a lo largo del camino. */
  showHeading?: boolean

  // heatmap
  /** Radio de influencia de cada muestra, en metros. */
  heatmapRadius?: number
  /** Lado de la celda de la grilla, en metros. Más chico = más detalle y más CPU. */
  heatmapCell?: number

  // target
  /** Línea desde el robot hasta cada marca. */
  targetLines?: boolean
  /** Distancia y ángulo sobre cada línea. */
  targetLabels?: boolean

  // swerve
  /** Clave de SWERVE_ARRANGEMENTS: en qué orden vienen los módulos. */
  swerveArrangement?: string
  /** m/s que corresponden a un vector de largo "media huella". */
  swerveMaxSpeed?: number
}

// 0 / 90 / 180 / 270 grados de rotación de la cancha en pantalla.
export type FieldOrientation = 0 | 90 | 180 | 270

/** Icono dibujado, o el modelo 3D del equipo renderizado desde arriba. */
export type RobotRenderMode = "icon" | "model"

export interface FieldSettings {
  orientation: FieldOrientation
  /** LARGO del chasis con bumpers, sobre +X del robot (default 0.85 m ≈ 33"). */
  robotSizeMeters: number
  /** ANCHO del chasis con bumpers, sobre +Y del robot. */
  robotWidthMeters: number
  showGrid: boolean
  /** Separación de la grilla en metros. */
  gridSpacing: number
  /** Clave de la cancha con imagen, o SCHEMATIC_FIELD_KEY para el dibujo. */
  fieldKey: string
  /** null = usar el sistema que declara el JSON de la cancha. */
  coordinateSystem: CoordinateSystem | null

  // --- Vista ---------------------------------------------------------------
  /** Espeja la cancha 180°: la vista que tiene el driver de la alianza roja. */
  allianceFlip: boolean
  /** Triedro X/Y en el origen de coordenadas del robot. */
  showAxes: boolean
  /** Lectura de las coordenadas bajo el puntero. */
  showCursor: boolean
  /** Etiquetas de los objetos (las que las tengan activadas). */
  showLabels: boolean
  /** Interruptor general de las estelas. */
  showTrails: boolean
  /** Segundos de estela por default para los objetos que no fijan el suyo. */
  trailSeconds: number

  // --- Modelo del robot ----------------------------------------------------
  robotRender: RobotRenderMode
  /** Ruta absoluta del .stl/.glb/.gltf. null = no hay modelo cargado. */
  robotModelPath: string | null
  /** Nombre de archivo, para mostrarlo sin recortar la ruta. */
  robotModelName: string | null
  /** Escala el modelo para que su huella coincida con el largo del chasis. */
  robotModelAutoFit: boolean
  /** Unidades de archivo -> metros, cuando el auto-fit está apagado. */
  robotModelScale: number
  /** Giro en grados para llevar el frente del CAD a +X del robot. */
  robotModelRotation: number
  /** null = respetar los materiales del archivo (los .stl no traen color). */
  robotModelColor: string | null
  /** Contorno del color del objeto por encima del modelo. */
  showBumpers: boolean
}

export const defaultFieldSettings: FieldSettings = {
  orientation: 0,
  robotSizeMeters: 0.85,
  robotWidthMeters: 0.85,
  showGrid: true,
  gridSpacing: 1,
  // Si hay alguna cancha con imagen instalada se usa esa: es lo que la gente
  // espera ver al abrir el visualizador, no una grilla vacía.
  fieldKey: FIELDS[0]?.key ?? SCHEMATIC_FIELD_KEY,
  coordinateSystem: null,

  allianceFlip: false,
  showAxes: false,
  showCursor: true,
  showLabels: true,
  showTrails: true,
  trailSeconds: 3,

  robotRender: "icon",
  robotModelPath: null,
  robotModelName: null,
  robotModelAutoFit: true,
  robotModelScale: 0.001,
  robotModelRotation: 0,
  robotModelColor: null,
  showBumpers: true,
}


// --- Field 3D (cancha 3D estilo AdvantageScope) ---

// El renderizado, los assets y la conversión de coordenadas viven en
// `utils/field3d/`. Acá solo está lo que se GUARDA en el layout.
//
// robot      = el chasis del equipo, con su modelo importado o una caja con
//              bumpers del color de la alianza
// ghost      = el mismo robot, translúcido: un setpoint, una segunda
//              estimación de pose, o la corrida de ayer sobre la de hoy
// component  = piezas articuladas del robot (brazo, elevador), colgadas de un
//              objeto `robot` y movidas por un Pose3d[]
// trajectory = camino que une las traslaciones de un array de poses
// vision     = marcas de visión, con la línea que las une a la cámara
// gamePiece  = una pieza de juego del modelo de la cancha, colocada donde diga
//              el topic (una nota en vuelo, el inventario del robot)
// cone       = marcador cónico genérico, para cualquier punto de interés
// axes       = triedro X/Y/Z en la pose, para depurar orientaciones
export type Field3dObjectType =
  | "robot" | "ghost" | "component" | "trajectory"
  | "vision" | "gamePiece" | "cone" | "axes"

/** Cómo interpretar un `double[]`: tripletas 2D o septetos 3D. */
export type Field3dArrayFormat = "auto" | "pose2d" | "pose3d"

export type Field3dTrajectoryStyle = "tube" | "line" | "points"

export interface Field3dObjectConfig {
  id: string
  topicName: string
  topicType: string
  label: string
  type: Field3dObjectType
  color: string

  // --- Opciones por objeto -------------------------------------------------
  // Todas OPCIONALES: un layout guardado por una versión anterior no las trae
  // y el renderer les aplica su default (ver `resolveField3dOptions`). Así
  // agregar una opción nunca invalida los layouts que la gente ya tenía.

  hidden?: boolean
  /** 0..1. Default 1 para robot, 0.45 para ghost. */
  opacity?: number
  /** Nombre + coordenadas flotando junto al objeto. */
  showLabel?: boolean
  /** Segundos de estela. 0 = sin estela. */
  trailSeconds?: number
  arrayFormat?: Field3dArrayFormat

  // robot / ghost
  /** Asset de robot a usar. null = el default de la pestaña. */
  robotAssetKey?: string | null
  /** Dibuja el modelo del asset; con false siempre va la caja con bumpers. */
  useModel?: boolean

  // component / vision: de qué objeto `robot` cuelgan
  anchorId?: string | null

  // trajectory
  trajectoryStyle?: Field3dTrajectoryStyle
  /** Grosor en METROS (a diferencia del 2D, que lo mide en píxeles). */
  trajectoryWidth?: number
  showWaypoints?: boolean
  /** Altura sobre la alfombra, para que no pelee con ella en el z-buffer. */
  trajectoryHeight?: number

  // vision
  /** Cámara del asset del robot de la que sale la línea. -1 = centro del robot. */
  visionCameraIndex?: number

  // gamePiece
  /** Índice de la pieza dentro de `gamePieces` del config de la cancha. */
  gamePieceIndex?: number

  // cone / axes
  /** Tamaño del marcador en metros. */
  markerSize?: number
}

export type Field3dCameraMode = "orbit" | "orbitRobot" | "driverStation" | "robotCamera"

/**
 * Cuánto esfuerzo gráfico se gasta. En una notebook del pit conectada a la
 * batería, `cinematic` puede tirar los fps a la mitad; `lowPower` limita el
 * refresco y la resolución para que la app siga respondiendo.
 */
export type Field3dQuality = "cinematic" | "standard" | "lowPower"

export type Field3dOrigin = "auto" | "blue" | "red"

export interface Field3dSettings {
  /** Clave del asset de cancha, o EVERGREEN_FIELD_KEY para la esquemática. */
  fieldKey: string
  /** Asset de robot por defecto para los objetos que no fijan el suyo. */
  robotAssetKey: string | null
  /** null = usar el que declara el config de la cancha. */
  coordinateSystem: Field3dCoordinateSystemKey | null
  /** Dónde está el origen cuando el sistema es relativo a la alianza. */
  origin: Field3dOrigin
  /** Alianza manual, cuando no se lee de FMSInfo. */
  alliance: "blue" | "red"
  /** Lee la alianza de /FMSInfo/IsRedAlliance en vez del selector. */
  allianceFromFMS: boolean

  // --- Cámara --------------------------------------------------------------
  cameraMode: Field3dCameraMode
  /** Índice de la driver station (0-2 azules, 3-5 rojas). */
  driverStationIndex: number
  /** Índice de la cámara declarada en el asset del robot. */
  robotCameraIndex: number
  /** Campo de visión vertical en grados, para las vistas libres. */
  fov: number

  // --- Escena --------------------------------------------------------------
  quality: Field3dQuality
  showGrid: boolean
  gridCell: number
  showFieldAxes: boolean
  /** AprilTags declarados en el config de la cancha. */
  showAprilTags: boolean
  showAprilTagIds: boolean
  /** Piezas de juego que el modelo de la cancha trae ya colocadas. */
  showStagedPieces: boolean
  showDriverStations: boolean
  showLabels: boolean
  /** Interruptor general de las estelas. */
  showTrails: boolean
  trailSeconds: number

  // --- Chasis genérico (cuando no hay asset de robot) -----------------------
  robotLength: number
  robotWidth: number
  robotHeight: number
}

/** Clave reservada para la cancha esquemática, la que no necesita descarga. */
export const EVERGREEN_FIELD_KEY = "evergreen"

export const defaultField3dSettings: Field3dSettings = {
  fieldKey: EVERGREEN_FIELD_KEY,
  robotAssetKey: null,
  coordinateSystem: null,
  origin: "auto",
  alliance: "blue",
  allianceFromFMS: true,

  cameraMode: "orbit",
  driverStationIndex: 1,
  robotCameraIndex: 0,
  fov: 50,

  quality: "standard",
  showGrid: false,
  gridCell: 1,
  showFieldAxes: false,
  showAprilTags: false,
  showAprilTagIds: false,
  // Apagadas por defecto: la cancha 2026 trae 456 FUEL colocadas, y son 456
  // mallas que se dibujan en cada cuadro para enseñar pelotas que no se mueven
  // nunca. Quien las quiera las enciende en Field 3D > Field > Pre-placed game
  // pieces.
  showStagedPieces: false,
  showDriverStations: false,
  showLabels: false,
  showTrails: true,
  trailSeconds: 3,

  // 33" x 33" con bumpers y ~18" de alto: el chasis FRC típico.
  robotLength: 0.85,
  robotWidth: 0.85,
  robotHeight: 0.45,
}

// --- Swerve Visualizer ---

// modules   = SwerveModuleState[] o double[] de pares [ángulo, rapidez]
// positions = SwerveModulePosition[] (distancia acumulada por rueda)
// chassis   = ChassisSpeeds (vx, vy, ω) del robot completo
// rotation  = orientación del chasis (Rotation2d, Pose2d, o un double de gyro)
export type SwerveSourceType = "modules" | "positions" | "chassis" | "rotation"

// Orden en que los módulos del topic se mapean a las esquinas dibujadas
// (FL, FR, BL, BR). Igual que el selector "Arrangement" de AdvantageScope:
// no todos los equipos indexan sus módulos en el mismo orden.
export const SWERVE_ARRANGEMENTS: { key: string; label: string }[] = [
  { key: "0,1,2,3", label: "FL/FR/BL/BR" },
  { key: "1,0,3,2", label: "FR/FL/BR/BL" },
  { key: "0,1,3,2", label: "FL/FR/BR/BL" },
  { key: "0,3,1,2", label: "FL/BL/BR/FR" },
  { key: "3,0,2,1", label: "FR/BR/BL/FL" },
  { key: "1,0,2,3", label: "FR/FL/BL/BR" },
]

// Qué representa un set de módulos: lo que el robot MIDE, o lo que se le
// COMANDA. Teniendo los dos se puede calcular el error de seguimiento.
export type SwerveModuleRole = "measured" | "setpoint"

export interface SwerveSourceConfig {
  id: string
  topicName: string
  topicType: string
  label: string
  type: SwerveSourceType
  color: string
  arrangement: string                    // solo para type === "modules"/"positions"
  angleUnits: "degrees" | "radians"      // solo para rotaciones publicadas como double crudo
  role: SwerveModuleRole                 // solo para type === "modules"
}

export interface SwerveSettings {
  maxSpeed: number       // m/s, normaliza el largo de los vectores
  frameLength: number    // m, eje X del chasis (hacia adelante)
  frameWidth: number     // m, eje Y del chasis (hacia la izquierda)
  orientation: FieldOrientation
  gradient: boolean       // colorea cada módulo según su rapidez
  showValues: boolean     // etiquetas numéricas junto a cada módulo
  showPredicted: boolean  // vector que cada módulo debería tener según la cinemática
  showICR: boolean        // centro instantáneo de rotación
}

export const defaultSwerveSettings: SwerveSettings = {
  maxSpeed: 4.5,
  frameLength: 0.6,
  frameWidth: 0.6,
  orientation: 0,
  gradient: true,
  showValues: true,
  showPredicted: false,
  showICR: false,
}

// --- Swerve 3D Visualizer ---

// La vista 3D consume las MISMAS fuentes que la 2D (swerveSources) y el mismo
// tamano de chasis y velocidad maxima (swerveSettings). Lo unico propio es
// como se ve: que modelo se carga y donde se dibuja cada modulo.

/** Donde se dibuja un modulo, en el marco del robot (X adelante, Y izquierda, Z arriba). */
export interface Swerve3dModulePlacement {
  x: number
  y: number
  z: number   // altura del centro de la rueda
}

export type Swerve3dProjection = "perspective" | "orthographic"

export interface Swerve3dSettings {
  // --- Modelo del robot ---
  /** Ruta absoluta del .stl/.glb/.gltf elegido. null = chasis generico dibujado. */
  modelPath: string | null
  /** Nombre de archivo, solo para mostrar en el panel sin recortar la ruta. */
  modelName: string | null
  /** Escala uniforme. Se ignora mientras modelAutoFit este activo. */
  modelScale: number
  /** Ajusta la escala para que el largo del modelo coincida con frameLength. */
  modelAutoFit: boolean
  /** Giros del modelo en grados, aplicados antes del heading (X, luego Y, luego Z). */
  modelRotX: number
  modelRotY: number
  modelRotZ: number
  /** Corrimiento respecto del centro del chasis, en metros. */
  modelOffsetX: number
  modelOffsetY: number
  modelOffsetZ: number
  /** Apoya la base del modelo en el piso despues de escalarlo y girarlo. */
  modelDropToFloor: boolean
  /** null = respetar los materiales del archivo (GLB). Los STL no traen color. */
  modelColor: string | null
  modelOpacity: number
  modelWireframe: boolean

  // --- Modulos ---
  /** Posiciones FL, FR, BL, BR. Solo se usan si moduleAuto es false. */
  modules: Swerve3dModulePlacement[]
  /** Deriva las cuatro esquinas de frameLength/frameWidth en vez de usar `modules`. */
  moduleAuto: boolean
  /** Altura del centro de la rueda cuando moduleAuto esta activo. */
  moduleAutoHeight: number
  wheelRadius: number   // m
  wheelWidth: number    // m

  // --- Escena ---
  showModel: boolean
  showFrame: boolean          // caja de alambre con el tamano del chasis
  showModules: boolean
  showVectors: boolean        // flecha de velocidad por modulo
  showSetpoints: boolean      // segundo set de modulos, en fantasma
  showChassisVector: boolean  // flecha de ChassisSpeeds desde el centro
  showOmega: boolean          // arco de velocidad angular
  showLabels: boolean         // FL/FR/BL/BR flotando sobre cada modulo
  showAxes: boolean           // triedro del robot
  showFloor: boolean
  /** El piso se desplaza al reves que el chasis: el robot queda quieto y se ve avanzar. */
  motionFloor: boolean
  /** false = el chasis no gira con el gyro (vista solidaria al robot). */
  followHeading: boolean
  gradient: boolean           // colorea los vectores segun la fraccion de maxSpeed

  // --- Camara ---
  projection: Swerve3dProjection
}

// FL, FR, BL, BR para un chasis cuadrado de 0.6 m, que es el default de
// SwerveSettings.
export const defaultSwerve3dModules: Swerve3dModulePlacement[] = [
  { x: 0.3, y: 0.3, z: 0.05 },
  { x: 0.3, y: -0.3, z: 0.05 },
  { x: -0.3, y: 0.3, z: 0.05 },
  { x: -0.3, y: -0.3, z: 0.05 },
]

export const defaultSwerve3dSettings: Swerve3dSettings = {
  modelPath: null,
  modelName: null,
  modelScale: 1,
  modelAutoFit: true,
  modelRotX: 0,
  modelRotY: 0,
  modelRotZ: 0,
  modelOffsetX: 0,
  modelOffsetY: 0,
  modelOffsetZ: 0,
  modelDropToFloor: true,
  modelColor: null,
  modelOpacity: 1,
  modelWireframe: false,

  modules: defaultSwerve3dModules,
  moduleAuto: true,
  moduleAutoHeight: 0.05,
  wheelRadius: 0.05,
  wheelWidth: 0.04,

  showModel: true,
  showFrame: true,
  showModules: true,
  showVectors: true,
  showSetpoints: true,
  showChassisVector: true,
  showOmega: true,
  showLabels: true,
  showAxes: false,
  showFloor: true,
  motionFloor: true,
  followHeading: true,
  gradient: true,

  projection: "perspective",
}

// --- Mechanism2d Visualizer ---

// A diferencia del resto de fuentes de la app, una fuente de Mechanism2d NO
// apunta a un topic sino a una TABLA entera (dims + backgroundColor + roots +
// ligamentos). Por eso guarda un "prefix" en vez de un topicName/topicType.
export interface MechanismSourceConfig {
  id: string
  prefix: string
  label: string
  visible: boolean
  /** null = respetar el color que publica cada ligamento. */
  colorOverride: string | null
}

export interface MechanismSettings {
  showGrid: boolean
  showOrigin: boolean          // ejes en el (0,0) del lienzo (esquina inferior izquierda)
  showJoints: boolean          // puntos en los extremos de cada ligamento
  useTopicBackground: boolean  // usar el backgroundColor publicado en vez del fondo oscuro
  weightScale: number          // multiplicador del grosor publicado por cada ligamento
}

export const defaultMechanismSettings: MechanismSettings = {
  showGrid: true,
  showOrigin: true,
  showJoints: true,
  useTopicBackground: true,
  weightScale: 1,
}

// --- NT Session ---
//
// Una sesión es al revés que todo lo demás de la app: en vez de LEER lo que el
// robot publica, MARS publica sus propios topics bajo una tabla raíz (por
// defecto "MarsDesktop") y el robot los lee.
//
// El caso obvio es tunear ganancias sin volver a compilar, pero la pestaña no
// está atada a eso: es un publicador general. Cualquier valor que quieras
// mandarle al robot en caliente — una pose objetivo, un modo de auto, un
// switch de debug — vive acá. Y cada valor sabe copiarse como código Java, que
// es el paso que normalmente se hace a mano y con errores de tipeo.

/**
 * Los tres primeros grupos se publican con su tipo nativo de NT. La geometría
 * viaja como `double[]` con los componentes en orden, que es lo que cualquier
 * cliente puede leer sin necesitar el schema del struct.
 */
export type NTSessionKind =
  | "double" | "int" | "boolean" | "string"
  | "double[]" | "boolean[]" | "string[]"
  | "Rotation2d" | "Translation2d" | "Pose2d"
  | "Translation3d" | "Pose3d" | "ChassisSpeeds"

export interface NTSessionEntry {
  id: string
  /** Ruta relativa a la tabla raíz, ej. "Arm/kP". */
  key: string
  kind: NTSessionKind
  /** Nombre de la variable en el Java que se copia al portapapeles. */
  javaName: string

  /**
   * Componentes del valor. Se usa el array que corresponda al tipo: un double
   * es `numbers[0]`, un Pose2d es `numbers[0..2]`, un string[] es `strings`.
   * Tenerlos separados por tipo evita un `any` que después hay que validar en
   * cada lectura.
   */
  numbers: number[]
  booleans: boolean[]
  strings: string[]

  // --- Slider de los valores numéricos sueltos ---
  min: number
  max: number
  step: number
  useSlider: boolean

  /** Comentario libre; se copia como `//` arriba de la declaración. */
  note: string
}

/** Qué forma tiene el Java que se copia al portapapeles. */
export type NTSessionCopyMode = "declaration" | "value" | "getter"

export interface NTSessionSettings {
  /**
   * Publica el VALOR apenas se edita. Nunca dispara al renombrar o cambiar de
   * tipo: eso solo se manda con el botón.
   */
  autoPublish: boolean
  copyMode: NTSessionCopyMode
}

export const defaultNTSessionSettings: NTSessionSettings = {
  // Apagado por defecto: publicar mientras se escribe deja un topic por cada
  // letra del nombre, y esos topics sobreviven hasta que el publicador se va.
  autoPublish: false,
  copyMode: "declaration",
}

// --- Mechanism 3D ---
//
// Un mecanismo se describe como un ÁRBOL de piezas, igual que un URDF: cada
// pieza cuelga de otra, tiene una transformación fija respecto de su padre (el
// origen de la articulación) y una articulación que la mueve dentro de ese
// marco. Con eso alcanza para un brazo de tres eslabones, un elevador de dos
// etapas, una muñeca, o los "component poses" que publica AdvantageKit.
//
// Todo vive en el marco de WPILib: +X adelante, +Y a la izquierda, +Z arriba,
// metros y radianes (los grados solo aparecen en la UI y en los campos que lo
// dicen explícitamente).

/**
 * - `fixed`: no se mueve; sirve para colgar piezas decorativas.
 * - `revolute`: gira alrededor de `axis` (con límites).
 * - `continuous`: igual pero sin límites — una rueda, un flywheel.
 * - `prismatic`: se desplaza a lo largo de `axis` — un elevador, un telescópico.
 * - `pose`: la pose entera sale de un Pose3d/Pose2d/Translation3d publicado.
 */
export type Mechanism3dJointType = "fixed" | "revolute" | "continuous" | "prismatic" | "pose"

/** Unidades del valor que llega del topic, ANTES de convertir a rad/m. */
export type Mechanism3dJointUnits =
  | "degrees" | "radians" | "rotations"
  | "meters" | "millimeters" | "inches"

/** Primitiva que se dibuja cuando la pieza todavía no tiene archivo. */
export type Mechanism3dShape = "none" | "box" | "cylinder" | "sphere"

/** Dónde queda el origen del modelo, que es el punto sobre el que rota. */
export type Mechanism3dAnchor = "origin" | "center" | "base"

export interface Mechanism3dJoint {
  type: Mechanism3dJointType
  /** Eje del movimiento en el marco de la pieza; se normaliza al dibujar. */
  axis: [number, number, number]
  /** Topic que maneja la articulación. null = solo valor manual. */
  topicName: string | null
  topicType: string
  /** Índice a leer cuando el topic es double[] o struct:X[]. null = el topic entero. */
  arrayIndex: number | null
  /** Campo del struct que se usa como valor (0 = el primero). */
  structField: number
  units: Mechanism3dJointUnits
  /** value = (raw invertido) * scale + offset, en las unidades de arriba. */
  scale: number
  offset: number
  invert: boolean
  /** Límites en las MISMAS unidades que `units`. null = sin tope. */
  min: number | null
  max: number | null
  /** Valor usado cuando no hay topic, o cuando la escena está en modo manual. */
  manual: number
}

export interface Mechanism3dPart {
  id: string
  name: string
  /** Pieza de la que cuelga. null = anclada al mundo. */
  parentId: string | null

  // --- Modelo ---
  modelPath: string | null
  modelName: string | null
  modelAnchor: Mechanism3dAnchor
  /** Escala el modelo para que su lado mayor mida `modelFitSize`. */
  modelAutoFit: boolean
  modelFitSize: number
  /** Escala uniforme cuando `modelAutoFit` está apagado (0.001 = mm -> m). */
  modelScale: number
  /** Ajuste del modelo DENTRO de la pieza, para alinearlo con el eje del joint. */
  modelOffset: [number, number, number]
  modelRotation: [number, number, number]   // grados
  /** Primitiva de reemplazo mientras no haya archivo (o si se prefiere una caja). */
  shape: Mechanism3dShape
  shapeSize: [number, number, number]       // box: X/Y/Z · cylinder: radio/–/alto · sphere: radio

  // --- Apariencia ---
  color: string | null      // null = respetar los materiales del archivo
  opacity: number
  wireframe: boolean
  visible: boolean

  // --- Colocación respecto del padre (el origen de la articulación) ---
  origin: [number, number, number]
  originRotation: [number, number, number]  // grados, orden XYZ
  /**
   * Centro de rotación, en el marco de la PIEZA. [0,0,0] = la pieza gira
   * alrededor de su origen.
   *
   * Es distinto de `modelOffset`: correr el modelo lo aleja del eje y lo deja
   * orbitando en círculo; correr el pivote mueve el EJE dentro del modelo sin
   * que el modelo se mueva de donde está. Es lo que hace falta cuando el STL
   * viene con su origen en una esquina y el eje real está en el barreno.
   */
  pivot: [number, number, number]
  /** Impide que el gizmo la mueva; útil para la base del mecanismo. */
  locked: boolean

  joint: Mechanism3dJoint
}

// --- Rutinas de animación ---
//
// Una rutina mueve articulaciones sola, sin robot conectado: sirve para mostrar
// el mecanismo en un stand, para revisar que un recorrido no choque contra sí
// mismo, y para grabar un clip sin tener que estar moviendo sliders a mano.
//
// Los pasos corren EN PARALELO sobre una línea de tiempo común, cada uno con su
// arranque propio. Eso permite tanto una secuencia (poniendo arranques
// escalonados) como movimientos simultáneos (el brazo sube mientras la muñeca
// gira), que con pasos puramente secuenciales no se podría.

export type Mechanism3dEasing = "linear" | "smooth"

export interface Mechanism3dRoutineStep {
  id: string
  /** Pieza que mueve. Si esa pieza ya no existe, el paso se ignora. */
  partId: string
  /** Valores en las MISMAS unidades que la articulación de la pieza. */
  from: number
  to: number
  /** Momento en que arranca, desde el inicio de la rutina. */
  startMs: number
  durationMs: number
  easing: Mechanism3dEasing
  /** Al terminar vuelve al valor inicial: el clásico "de lado a lado". */
  pingPong: boolean
}

export interface Mechanism3dRoutine {
  id: string
  name: string
  loop: boolean
  steps: Mechanism3dRoutineStep[]
}

export type Mechanism3dGizmo = "off" | "translate" | "rotate" | "pivot"

export interface Mechanism3dSettings {
  /** Nombre del mecanismo; viaja en el JSON exportado. */
  name: string
  showFloor: boolean
  gridCell: number          // m entre líneas de la grilla
  showWorldAxes: boolean
  showJointAxes: boolean    // indicador de junta (anillo o riel) sobre cada eje
  /** Tamaño de esos indicadores; el default queda bien para brazos de FRC. */
  jointScale: number
  /** Sector translúcido con el recorrido permitido entre min y max. */
  showJointLimits: boolean
  showPartLabels: boolean
  showBounds: boolean       // caja alrededor de la pieza seleccionada
  /** Ignora los topics y usa los valores manuales de cada articulación. */
  manualOverride: boolean
  gizmo: Mechanism3dGizmo
  gizmoSpace: "world" | "local"
  gizmoSnap: boolean
  projection: Swerve3dProjection
  background: "light" | "dark"

  /** Rutinas guardadas; viajan en el JSON exportado junto con las piezas. */
  routines: Mechanism3dRoutine[]
  /** Rutina elegida en la barra de reproducción. */
  activeRoutineId: string | null
}

export const defaultMechanism3dJoint: Mechanism3dJoint = {
  type: "fixed",
  axis: [0, 0, 1],
  topicName: null,
  topicType: "",
  arrayIndex: null,
  structField: 0,
  units: "degrees",
  scale: 1,
  offset: 0,
  invert: false,
  min: null,
  max: null,
  manual: 0,
}

export const defaultMechanism3dSettings: Mechanism3dSettings = {
  name: "Mechanism",
  showFloor: true,
  gridCell: 0.25,
  showWorldAxes: true,
  showJointAxes: true,
  jointScale: 1,
  showJointLimits: true,
  showPartLabels: false,
  showBounds: true,
  manualOverride: false,
  gizmo: "off",
  gizmoSpace: "local",
  gizmoSnap: false,
  projection: "perspective",
  background: "light",
  routines: [],
  activeRoutineId: null,
}

/** Pieza nueva, ya colocada en el origen de su padre y sin articular. */
export function makeMechanism3dPart(id: string, name: string, parentId: string | null): Mechanism3dPart {
  return {
    id, name, parentId,
    modelPath: null,
    modelName: null,
    modelAnchor: "origin",
    modelAutoFit: false,
    modelFitSize: 0.5,
    modelScale: 1,
    modelOffset: [0, 0, 0],
    modelRotation: [0, 0, 0],
    // Una caja chica y visible: una pieza nueva sin nada que dibujar sería
    // imposible de encontrar en la escena.
    shape: "box",
    shapeSize: [0.1, 0.1, 0.1],
    color: null,
    opacity: 1,
    wireframe: false,
    visible: true,
    origin: [0, 0, 0],
    originRotation: [0, 0, 0],
    pivot: [0, 0, 0],
    locked: false,
    joint: { ...defaultMechanism3dJoint, axis: [0, 0, 1] },
  }
}

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

  // --- Field2d ---
  // El topicName de un widget Field2d es una RUTA DE TABLA, no un topic: la
  // raíz de un Field2d no existe como topic, solo sus hijos.
  fieldKey?: string                       // cancha con imagen (default: la primera instalada)
  fieldCoordinateSystem?: string          // "wall_blue" | "center" | "center_rotated"
  fieldOrientation?: FieldOrientation     // giro en pantalla (default 0)
  fieldRobotSize?: number                 // LARGO del chasis en metros (default 0.85)
  fieldRobotWidth?: number                // ANCHO del chasis en metros (default: el largo)
  fieldShowGrid?: boolean                 // grilla de 1 m sobre la cancha (default false)
  fieldAllianceFlip?: boolean             // vista desde la alianza roja (default false)
  fieldTrailSeconds?: number              // estela del robot en segundos (default 0)

  // --- Voltage View ---
  voltageMin?: number           // default 4
  voltageMax?: number           // default 13
  voltageDivisions?: number     // default 5
  voltageInverted?: boolean     // default false
  voltageOrientation?: "horizontal" | "vertical"  // default "horizontal"
}

// --- Function Page (gráficos de línea tipo AdvantageScope) ---
export type FunctionTransform = "raw" | "integral" | "derivative" | "derivative2" | "movingAvg"
export type FunctionAxis = "left" | "right"
export type FunctionLineStyle = "line" | "stepped" | "points"

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
  transform: FunctionTransform
  axis: FunctionAxis
  combine?: SeriesCombine | null    // álgebra entre series
  errorTargetId?: string | null     // id de la serie "target/setpoint"

  visible?: boolean              // default true
  lineStyle?: FunctionLineStyle  // default "line"
  lineWidth?: number             // px, default 1.6
  /** Muestras del promedio móvil cuando transform === "movingAvg". */
  smoothWindow?: number
  /** Factor y corrimiento aplicados después del transform (unidades/offset de sensor). */
  scale?: number
  offset?: number
}

// Ajustes del gráfico completo (no de una serie suelta).
export interface FunctionSettings {
  /** Título del gráfico; viaja al PNG exportado y al nombre de archivo sugerido. */
  title: string
  /** "time" = señal contra el tiempo. "phase" = una señal contra OTRA (X-Y). */
  xMode: "time" | "phase"
  /** Serie que manda en el eje X cuando xMode === "phase". */
  xSeriesId: string | null
  windowSeconds: number
  showGrid: boolean
  showLegend: boolean
  showStats: boolean
  /** null = autoescala; si no, rango fijo del eje. */
  leftRange: [number, number] | null
  rightRange: [number, number] | null
}

export const defaultFunctionSettings: FunctionSettings = {
  title: "Function Plot",
  xMode: "time",
  xSeriesId: null,
  windowSeconds: 10,
  showGrid: true,
  showLegend: true,
  showStats: false,
  leftRange: null,
  rightRange: null,
}

// Log .wpilog cargado desde disco. Ocupa el MISMO buffer que NT4 en el
// backend, así que ambos modos son excluyentes: o hay conexión, o hay log.
export interface LogSource {
  path: string
  name: string
  topic_count: number
  sample_count: number
  start_us: number | null
  end_us: number | null
}

export interface AppState {
  currentPage: Page
  connection: ConnectionState
  projectName: string | null
  projectPath: string | null
  topics: Map<string, TopicAnnounce>
  openTabs: WorkspaceTab[]
  activeTabId: string | null
  logSource: LogSource | null
}

export const defaultState: AppState = {
  currentPage: "welcome",
  connection: "disconnected",
  projectName: null,
  projectPath: null,
  topics: new Map(),
  openTabs: [],
  activeTabId: null,
  logSource: null,
}
