// Las plantillas de mundo y los valores por defecto.
//
// El spec que se manda al backend tiene que coincidir CAMPO POR CAMPO con
// `estudio::MundoSpec`. Un nombre que no coincida no da error en ningún lado
// hasta que serde falla en tiempo de ejecución, con la ventana ya abierta y el
// usuario dándole a Save --- el mismo riesgo que el test
// `la_ui_y_config_hablan_el_mismo_json` cubre para el arranque.

/** La cancha FRC, y el mismo número que declara `protocol/topics.toml`. */
export const CAMPO_FRC = { largo: 16.54, ancho: 8.21 };

/** Radio del FUEL, de `models/fuel/model.sdf`. */
export const FUEL_RADIO = 0.075;

/**
 * La misma rejilla que siembra `estudio::generar_fuel`, para poder enseñar la
 * cuenta antes de guardar. Devuelve `{cols, filas, porCapa, capas}`.
 *
 * Es una copia deliberada de la fórmula de Rust, igual que `FUEL_RADIO`: el
 * generador es la verdad y esto solo la anticipa. Si divergen, lo que se ve en
 * el editor deja de describir lo que sale al SDF --- por eso el test
 * `las_fuel_no_nacen_solapadas` vive del lado que manda.
 */
export function rejillaFuel(n, area) {
  if (!n || n < 1) return { cols: 0, filas: 0, porCapa: 0, capas: 0 };

  const pasoMin = 2 * FUEL_RADIO + 0.02;
  const utilX = Math.max(area[0] - 2 * FUEL_RADIO, 0);
  const utilY = Math.max(area[1] - 2 * FUEL_RADIO, 0);
  const colsMax = Math.floor(utilX / pasoMin) + 1;
  const filasMax = Math.floor(utilY / pasoMin) + 1;

  const proporcion = area[1] > 0 ? area[0] / area[1] : 1;
  const cols = Math.min(Math.max(Math.round(Math.sqrt(n * proporcion)), 1), colsMax);
  const filas = Math.min(Math.max(Math.ceil(n / cols), 1), filasMax);
  const porCapa = cols * filas;
  return { cols, filas, porCapa, capas: Math.ceil(n / porCapa) };
}

export function specPorDefecto(archivo = "new-world") {
  return {
    archivo,
    descripcion: "",

    // 250 Hz: cinco pasos de física por ciclo de 20 ms de WPILib.
    paso: 0.004,
    rtf: 1.0,
    motor_fisica: "dart",
    gravedad: -9.8,

    suelo: true,
    friccion: 0.9,
    friccion2: 0.9,
    cancha_largo: CAMPO_FRC.largo,
    cancha_ancho: CAMPO_FRC.ancho,
    color_suelo: [0.32, 0.33, 0.36, 1],

    // Sin cancha por defecto: hay que instalar una primero (Field Library).
    campo: "",
    // El glTF viene Y-arriba y Gazebo es Z-arriba: 90 grados de roll.
    campo_pose: [0, 0, 0, Math.PI / 2, 0, 0],
    campo_escala: 1,

    // FUEL con física. Las 456 que trae la malla de la cancha son decorado
    // horneado en el glTF: sin colisión y sin masa, así que este número no
    // tiene nada que ver con ellas. 0 = ninguna.
    fuel: 0,
    // La NEUTRAL ZONE del manual de REBUILT (6.3.4.1): 206.0 x 72.0 in.
    fuel_area: [5.23, 1.83],
    fuel_centro: [0, 0],
    fuel_altura: 0,

    muros: true,
    muro_alto: 0.5,
    muro_grosor: 0.1,

    sol: true,
    sombras: true,
    sol_direccion: [-0.5, 0.1, -0.9],
    sol_intensidad: 0.8,
    ambiente: 0.4,
    fondo: [0.7, 0.75, 0.8],

    comandos_usuario: true,
    sensores: false,
    imu_system: false,
    plugins_extra: [],

    robot_uri: "",
    robot_pose: [0, 0, 0.1, 0, 0, 0],

    props: [],
  };
}

/**
 * Las plantillas del diálogo "New world". Cada una es un delta sobre el spec
 * por defecto, no un spec entero: así un campo nuevo no hay que añadirlo en
 * cuatro sitios.
 */
export const PLANTILLAS = [
  {
    id: "frc",
    nombre: "FRC field",
    svg: "scene.svg",
    resumen: "Carpet-sized ground with perimeter walls. The normal starting point.",
    delta: {},
  },
  {
    id: "frc-3d",
    nombre: "FRC field with 3D model",
    svg: "field3d.svg",
    resumen: "The walled field plus the real FRC mesh as a visual. Needs a field installed.",
    // Más ambiente porque la malla oficial es oscura: con 0.4 se ve plomiza.
    delta: { ambiente: 0.75 },
    pideCampo: true,
  },
  {
    id: "frc-fuel",
    nombre: "FRC field with FUEL",
    svg: "game-piece.svg",
    resumen: "The walled field plus 24 FUEL with physics, staged across the neutral zone.",
    // 24 es lo que cabe holgado en una sola capa de la NEUTRAL ZONE y no
    // castiga el real-time factor. Subirlo es un número en el editor.
    delta: { ambiente: 0.75, fuel: 24 },
    pideCampo: true,
  },
  {
    id: "open",
    nombre: "Open field",
    svg: "grid.svg",
    resumen: "Same ground, no walls — the robot can drive off the edge and keep going.",
    delta: { muros: false },
  },
  {
    id: "bench",
    nombre: "Test bench",
    svg: "measure.svg",
    resumen: "Small 6 × 6 m floor for testing a single mechanism, with the IMU system on.",
    delta: { cancha_largo: 6, cancha_ancho: 6, muros: true, muro_alto: 0.3, imu_system: true },
  },
  {
    id: "zerog",
    nombre: "Zero gravity",
    svg: "axes.svg",
    resumen: "No gravity. Isolates a mechanism's own dynamics from its weight while debugging.",
    delta: { gravedad: 0, muros: false },
  },
  {
    id: "empty",
    nombre: "Empty world",
    svg: "model-file.svg",
    resumen: "Physics, lighting and nothing else. For a world you will build up by hand.",
    delta: { suelo: false, muros: false, comandos_usuario: false },
  },
];

/**
 * `campoPorDefecto` es la ruta de la primera cancha instalada, si hay alguna;
 * solo la usan las plantillas que la piden.
 */
export function specDePlantilla(id, archivo, campoPorDefecto = "") {
  const p = PLANTILLAS.find((x) => x.id === id) ?? PLANTILLAS[0];
  const spec = { ...specPorDefecto(archivo), ...p.delta, archivo };
  if (p.pideCampo && campoPorDefecto) spec.campo = campoPorDefecto;
  return spec;
}

/** Los props que ofrece el botón "Add prop", ya dimensionados. */
export const PROPS_PREDEFINIDOS = [
  { etiqueta: "Box", forma: "box", tamano: [0.3, 0.3, 0.3], masa: 2, color: [0.8, 0.5, 0.2, 1] },
  { etiqueta: "Crate (0.5 m)", forma: "box", tamano: [0.5, 0.5, 0.5], masa: 6, color: [0.62, 0.45, 0.25, 1] },
  { etiqueta: "Cylinder", forma: "cylinder", tamano: [0.15, 0.4, 0], masa: 1.5, color: [0.25, 0.45, 0.8, 1] },
  { etiqueta: "Ball", forma: "sphere", tamano: [0.12, 0, 0], masa: 0.27, color: [0.85, 0.35, 0.2, 1] },
  { etiqueta: "Wall segment", forma: "box", tamano: [2, 0.1, 0.6], masa: 0, color: [0.3, 0.3, 0.34, 1], estatico: true },
  { etiqueta: "Mesh (.dae/.stl)", forma: "mesh", tamano: [1, 1, 1], masa: 1, color: [0.6, 0.6, 0.65, 1] },
];

export function nuevoProp(base, n) {
  return {
    nombre: `${base.forma}_${n}`,
    forma: base.forma,
    tamano: [...base.tamano],
    masa: base.masa,
    estatico: Boolean(base.estatico),
    pose: [1, 0, base.forma === "sphere" ? base.tamano[0] : (base.tamano[2] || base.tamano[1]) / 2, 0, 0, 0],
    color: [...base.color],
    malla: "",
  };
}
