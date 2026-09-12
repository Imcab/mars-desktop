import { describe, it, expect } from "vitest"
import { Group, Mesh, Object3D } from "three"
import { createObjectVisual, RenderedField3dObject, VisualContext, visualSignature } from "./objectVisuals"
import { Pose3D, quatFromYaw } from "../../../utils/field3d/frames"
import { resolveField3dOptions } from "../../../utils/field3d/objects"
import { TrailStore } from "../../../utils/field3d/trails"
import { makeEvergreenField, makeFieldGrid, DEFAULT_FIELD_SIZE } from "../../../utils/field3d/evergreen"
import {
  Field3dObjectConfig, Field3dObjectType, defaultField3dSettings,
} from "../../../store/appStore"

// Estos tests corren three de verdad pero sin WebGL: se construyen los objetos
// y se comprueba dónde quedan sus matrices, que es donde viven los errores de
// marco y de composición. Lo que no se puede probar acá es el pintado.
//
// Nada de lo que se arma usa `makeTextSprite`, que necesita un canvas 2D: por
// eso las etiquetas van apagadas en todos los casos.

const ctx: VisualContext = {
  settings: defaultField3dSettings,
  quality: "standard",
  robotAssets: new Map(),
  gamePieces: [],
}

function pose(x: number, y: number, z = 0, yaw = 0): Pose3D {
  const q = quatFromYaw(yaw)
  return { x, y, z, qw: q[0], qx: q[1], qy: q[2], qz: q[3] }
}

function object(
  type: Field3dObjectType,
  poses: Pose3D[],
  overrides: Partial<Field3dObjectConfig> = {},
): RenderedField3dObject {
  const config: Field3dObjectConfig = {
    id: "obj", topicName: "/x", topicType: "struct:Pose3d",
    label: "Obj", type, color: "#2f6fdb", ...overrides,
  }
  return {
    id: config.id, type, color: config.color, label: config.label, poses,
    options: resolveField3dOptions(config, defaultField3dSettings),
  }
}

function frame(trails = new TrailStore(), anchor: Pose3D | null = null) {
  return {
    now: 1_000_000,
    trails,
    anchorPose: () => anchor,
    anchorCamera: () => anchor,
  }
}

/** Cuenta las mallas de un árbol, saltando lo que está apagado. */
function visibleMeshes(root: Object3D): number {
  let count = 0
  const walk = (node: Object3D) => {
    if (!node.visible) return
    if ((node as Mesh).isMesh) count++
    node.children.forEach(walk)
  }
  walk(root)
  return count
}

describe("cancha esquemática", () => {
  it("se arma con alfombra, paredes y línea de media cancha", () => {
    const field = makeEvergreenField(DEFAULT_FIELD_SIZE)
    // Alfombra + dos franjas de alianza + cuatro paredes = 7 mallas.
    expect(visibleMeshes(field)).toBe(7)
  })

  it("la grilla cubre la cancha entera", () => {
    const grid = makeFieldGrid({ length: 4, width: 2 }, 1)
    const position = grid.geometry.getAttribute("position")
    // 5 líneas verticales + 3 horizontales + los 2 bordes de cierre = 10
    // segmentos, 2 vértices cada uno.
    expect(position.count).toBe(20)
  })
})

describe("robot", () => {
  it("dibuja el chasis genérico cuando no hay asset", () => {
    const visual = createObjectVisual(object("robot", [pose(0, 0)]), ctx)
    // Bumper + cuerpo + cuña = 3 mallas (el contorno es LineSegments).
    expect(visibleMeshes(visual.group)).toBe(3)
    visual.dispose()
  })

  it("coloca el chasis en la pose sin girar la estela con él", () => {
    const next = object("robot", [pose(2, -1, 0.3, Math.PI / 2)], { trailSeconds: 5 })
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())

    // El grupo exterior se queda en el origen de la cancha: la estela cuelga
    // de él y tiene que quedarse marcada en el piso, no girar con el robot.
    expect(visual.group.position.toArray()).toEqual([0, 0, 0])

    const poseGroup = visual.group.children.find(c => c instanceof Group)!
    expect(poseGroup.position.x).toBeCloseTo(2, 6)
    expect(poseGroup.position.y).toBeCloseTo(-1, 6)
    expect(poseGroup.position.z).toBeCloseTo(0.3, 6)
    // three guarda el cuaternión como (x, y, z, w).
    expect(poseGroup.quaternion.w).toBeCloseTo(Math.cos(Math.PI / 4), 6)
    expect(poseGroup.quaternion.z).toBeCloseTo(Math.sin(Math.PI / 4), 6)
    visual.dispose()
  })

  it("se apaga cuando el topic deja de traer pose", () => {
    const empty = object("robot", [])
    const visual = createObjectVisual(empty, ctx)
    visual.update(empty, frame())
    expect(visual.group.visible).toBe(false)
    visual.dispose()
  })

  it("acumula la estela y la vuelca al buffer de la línea", () => {
    const trails = new TrailStore()
    const visual = createObjectVisual(object("robot", [pose(0, 0)], { trailSeconds: 30 }), ctx)

    // Tres posiciones separadas en el tiempo y en el espacio, para que ni el
    // período mínimo ni el paso mínimo las descarten.
    for (let i = 0; i < 3; i++) {
      const next = object("robot", [pose(i, i * 2)], { trailSeconds: 30 })
      visual.update(next, { ...frame(trails), now: 1_000_000 + i * 200 })
    }

    expect(trails.count("obj")).toBe(3)
    const line = visual.group.children.find(c => (c as any).isLine) as any
    expect(line.geometry.drawRange.count).toBe(3)
    // Las estelas se dibujan un pelo sobre la alfombra para no pelear con ella
    // en el z-buffer.
    expect(line.geometry.getAttribute("position").array[2]).toBeGreaterThan(0)
    visual.dispose()
  })

  it("no anota dos veces al robot parado", () => {
    const trails = new TrailStore()
    const next = object("robot", [pose(1, 1)], { trailSeconds: 30 })
    const visual = createObjectVisual(next, ctx)
    for (let i = 0; i < 5; i++) {
      visual.update(next, { ...frame(trails), now: 1_000_000 + i * 500 })
    }
    expect(trails.count("obj")).toBe(1)
    visual.dispose()
  })
})

describe("componentes articulados", () => {
  it("sin asset de robot no dibuja nada, en vez de romper", () => {
    const next = object("component", [pose(0.5, 0, 0.4)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    expect(visual.group.visible).toBe(false)
    visual.dispose()
  })
})

describe("trayectoria", () => {
  it("arma el tubo a partir de las poses", () => {
    const next = object("trajectory", [pose(0, 0), pose(1, 0), pose(2, 1)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    expect(visibleMeshes(visual.group)).toBe(1)
    visual.dispose()
  })

  it("con menos de dos puntos no hay camino que dibujar", () => {
    const next = object("trajectory", [pose(0, 0)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    expect(visibleMeshes(visual.group)).toBe(0)
    visual.dispose()
  })

  it("no reconstruye la geometría cuando las poses no cambiaron", () => {
    // Una trayectoria se publica una vez y no cambia; rehacer el tubo en cada
    // frame sería tirar el presupuesto entero.
    const next = object("trajectory", [pose(0, 0), pose(1, 1), pose(2, 0)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    const first = (visual.group.children.find(c => (c as Mesh).isMesh) as Mesh).geometry
    visual.update(next, frame())
    const second = (visual.group.children.find(c => (c as Mesh).isMesh) as Mesh).geometry
    expect(second).toBe(first)
    visual.dispose()
  })

  it("sí la reconstruye cuando el camino cambia", () => {
    const a = object("trajectory", [pose(0, 0), pose(1, 1)])
    const visual = createObjectVisual(a, ctx)
    visual.update(a, frame())
    const first = (visual.group.children.find(c => (c as Mesh).isMesh) as Mesh).geometry
    const b = object("trajectory", [pose(0, 0), pose(1, 2)])
    visual.update(b, frame())
    const second = (visual.group.children.find(c => (c as Mesh).isMesh) as Mesh).geometry
    expect(second).not.toBe(first)
    visual.dispose()
  })

  it("los waypoints salen un punto por pose", () => {
    const next = object("trajectory", [pose(0, 0), pose(1, 0), pose(2, 0)], { showWaypoints: true })
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    // El tubo más los tres waypoints.
    expect(visibleMeshes(visual.group)).toBe(4)
    visual.dispose()
  })
})

describe("marcas de visión", () => {
  it("traza una línea del robot a cada marca", () => {
    const next = object("vision", [pose(4, 1, 1), pose(4, -1, 1)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame(new TrailStore(), pose(0, 0, 0.2)))

    const lines = visual.group.children.find(c => (c as any).isLineSegments) as any
    // Dos vértices por marca.
    expect(lines.geometry.drawRange.count).toBe(4)
    const array = lines.geometry.getAttribute("position").array
    expect(array[0]).toBeCloseTo(0, 6)   // desde el robot
    expect(array[3]).toBeCloseTo(4, 6)   // hasta la marca
    visual.dispose()
  })

  it("sin robot al que anclarse no dibuja líneas pero sí las marcas", () => {
    const next = object("vision", [pose(4, 1, 1)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame(new TrailStore(), null))

    const lines = visual.group.children.find(c => (c as any).isLineSegments) as any
    expect(lines.visible).toBe(false)
    expect(visibleMeshes(visual.group)).toBe(1)
    visual.dispose()
  })

  it("reutiliza los marcadores cuando la cuenta de marcas oscila", () => {
    const visual = createObjectVisual(object("vision", []), ctx)
    const three = object("vision", [pose(1, 0), pose(2, 0), pose(3, 0)])
    visual.update(three, frame(new TrailStore(), pose(0, 0)))
    const created = visual.group.children.find(c => c instanceof Group)!.children.length

    const one = object("vision", [pose(1, 0)])
    visual.update(one, frame(new TrailStore(), pose(0, 0)))
    // Los sobrantes se apagan, no se destruyen: la cuenta oscila mucho y crear
    // y tirar mallas a ese ritmo se nota.
    expect(visual.group.children.find(c => c instanceof Group)!.children.length).toBe(created)
    expect(visibleMeshes(visual.group)).toBe(1)
    visual.dispose()
  })
})

describe("piezas de juego y marcadores", () => {
  it("sin modelo la pieza cae a una esfera, una por pose", () => {
    const next = object("gamePiece", [pose(1, 1, 0.5), pose(-1, 2, 0.5)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    expect(visibleMeshes(visual.group)).toBe(2)
    visual.dispose()
  })

  it("el marcador de cono se coloca en cada pose", () => {
    const next = object("cone", [pose(3, -2, 0)])
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    const pivot = visual.group.children[0]
    expect(pivot.position.x).toBeCloseTo(3, 6)
    expect(pivot.position.y).toBeCloseTo(-2, 6)
    visual.dispose()
  })

  it("un objeto oculto no dibuja nada", () => {
    const next = object("cone", [pose(0, 0)], { hidden: true })
    const visual = createObjectVisual(next, ctx)
    visual.update(next, frame())
    expect(visual.group.visible).toBe(false)
    visual.dispose()
  })
})

describe("firma de reconstrucción", () => {
  it("cambia con lo que altera mallas o materiales", () => {
    const base = object("robot", [pose(0, 0)])
    expect(visualSignature(object("robot", [pose(5, 5)]))).toBe(visualSignature(base))
    expect(visualSignature(object("ghost", [pose(0, 0)]))).not.toBe(visualSignature(base))
    expect(visualSignature(object("robot", [pose(0, 0)], { color: "#ff0000" })))
      .not.toBe(visualSignature(base))
  })
})
