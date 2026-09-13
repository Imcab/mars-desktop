import { describe, it, expect } from "vitest"
import {
  jointValue, jointTransform, resolveJointScalar, poseTransform, unitScale,
  normalizeAxis, axisAngleQuat, buildPartTree, flattenTree, descendantIds,
  canReparent, normalizeParts, normalizeSettings, serializeMechanism3d,
  parseMechanism3d, duplicatePart, isJointTopic, bindJointTopic,
  applyJointToPoint, travelRange, sweepRange,
  evaluateRoutine, routineDuration, normalizeRoutines, sweepStep,
} from "./mechanism3d"
import {
  Mechanism3dJoint, Mechanism3dRoutine, Mechanism3dRoutineStep,
  defaultMechanism3dJoint, defaultMechanism3dSettings, makeMechanism3dPart,
} from "../../store/appStore"

const joint = (overrides: Partial<Mechanism3dJoint> = {}): Mechanism3dJoint => ({
  ...defaultMechanism3dJoint,
  ...overrides,
})

// Empaqueta doubles little-endian igual que el struct schema de WPILib, para
// poder alimentar al decodificador con bytes de verdad.
function doublesToBytes(values: number[]): number[] {
  const buffer = new ArrayBuffer(values.length * 8)
  const view = new DataView(buffer)
  values.forEach((v, i) => view.setFloat64(i * 8, v, true))
  return Array.from(new Uint8Array(buffer))
}

describe("unidades", () => {
  it("convierte a radianes o metros según el tipo de articulación", () => {
    expect(unitScale("degrees", "angle")).toBeCloseTo(Math.PI / 180)
    expect(unitScale("rotations", "angle")).toBeCloseTo(Math.PI * 2)
    expect(unitScale("radians", "angle")).toBe(1)
    expect(unitScale("millimeters", "length")).toBeCloseTo(0.001)
    expect(unitScale("inches", "length")).toBeCloseTo(0.0254)
  })

  it("cae al neutro si la unidad no corresponde al tipo de articulación", () => {
    // Grados en un prismático no significa nada: mejor no mover la pieza que
    // desplazarla 0.0174 m por grado.
    expect(unitScale("degrees", "length")).toBe(1)
    expect(unitScale("meters", "angle")).toBeCloseTo(Math.PI / 180)
  })
})

describe("normalizeAxis", () => {
  it("normaliza", () => {
    expect(normalizeAxis([0, 0, 5])).toEqual([0, 0, 1])
    const n = normalizeAxis([3, 4, 0])
    expect(n[0]).toBeCloseTo(0.6)
    expect(n[1]).toBeCloseTo(0.8)
  })

  it("un eje nulo cae a +Z en vez de producir NaN", () => {
    expect(normalizeAxis([0, 0, 0])).toEqual([0, 0, 1])
    expect(normalizeAxis([NaN, 0, 0])).toEqual([0, 0, 1])
  })
})

describe("axisAngleQuat", () => {
  it("90° sobre Z", () => {
    const q = axisAngleQuat([0, 0, 1], Math.PI / 2)
    expect(q[2]).toBeCloseTo(Math.SQRT1_2)
    expect(q[3]).toBeCloseTo(Math.SQRT1_2)
  })

  it("ángulo cero da la identidad", () => {
    expect(axisAngleQuat([0, 1, 0], 0)).toEqual([0, 0, 0, 1])
  })
})

describe("resolveJointScalar", () => {
  it("lee un double", () => {
    expect(resolveJointScalar({ Number: 12.5 }, joint({ topicName: "/a", topicType: "double" }))).toBe(12.5)
  })

  it("lee un índice de un double[]", () => {
    const j = joint({ topicName: "/a", topicType: "double[]", arrayIndex: 2 })
    expect(resolveJointScalar({ NumberArray: [1, 2, 3, 4] }, j)).toBe(3)
  })

  it("convierte un boolean en 0/1 para manejar un solenoide", () => {
    const j = joint({ topicName: "/a", topicType: "boolean" })
    expect(resolveJointScalar({ Boolean: true }, j)).toBe(1)
    expect(resolveJointScalar({ Boolean: false }, j)).toBe(0)
  })

  it("lee un índice de un boolean[]", () => {
    const j = joint({ topicName: "/a", topicType: "boolean[]", arrayIndex: 1 })
    expect(resolveJointScalar({ BooleanArray: [false, true] }, j)).toBe(1)
  })

  it("lee un campo de un struct", () => {
    // Pose2d = X, Y, θ(rad en el cable). El decodificador devuelve θ en grados.
    const bytes = doublesToBytes([1.5, -2.5, Math.PI / 2])
    const j = joint({ topicName: "/a", topicType: "struct:Pose2d", structField: 2 })
    expect(resolveJointScalar({ Raw: bytes }, j)).toBeCloseTo(90)
  })

  it("lee un elemento de un struct array", () => {
    const bytes = doublesToBytes([0, 0, 0, 4, 5, 0])   // dos Translation... no: dos Rotation? usamos Pose2d
    const j = joint({ topicName: "/a", topicType: "struct:Pose2d[]", arrayIndex: 1, structField: 0 })
    expect(resolveJointScalar({ Raw: bytes }, j)).toBe(4)
  })

  it("devuelve null sin valor o sin topic", () => {
    expect(resolveJointScalar(null, joint({ topicName: "/a", topicType: "double" }))).toBeNull()
    expect(resolveJointScalar({ Number: 1 }, joint({ topicName: null, topicType: "double" }))).toBeNull()
  })
})

describe("jointValue", () => {
  it("aplica invert, escala y offset en ese orden", () => {
    const j = joint({ topicName: "/a", topicType: "double", invert: true, scale: 2, offset: 10 })
    // -(3) * 2 + 10 = 4
    expect(jointValue(j, { Number: 3 }, false)).toBe(4)
  })

  it("respeta los límites en las unidades del selector", () => {
    const j = joint({ topicName: "/a", topicType: "double", min: -90, max: 90 })
    expect(jointValue(j, { Number: 400 }, false)).toBe(90)
    expect(jointValue(j, { Number: -400 }, false)).toBe(-90)
  })

  it("usa el valor manual cuando el override está activo", () => {
    const j = joint({ topicName: "/a", topicType: "double", manual: 45, scale: 10 })
    expect(jointValue(j, { Number: 3 }, true)).toBe(45)
  })

  it("cae al valor manual si el topic todavía no publicó nada", () => {
    const j = joint({ topicName: "/a", topicType: "double", manual: 7 })
    expect(jointValue(j, undefined, false)).toBe(7)
  })
})

describe("jointTransform", () => {
  it("un joint fijo no mueve nada", () => {
    const t = jointTransform(joint({ type: "fixed" }), null, false)
    expect(t.position).toEqual([0, 0, 0])
    expect(t.quaternion).toEqual([0, 0, 0, 1])
  })

  it("un revolute gira sobre su eje y convierte los grados", () => {
    const j = joint({ type: "revolute", axis: [0, 0, 1], units: "degrees", manual: 90 })
    const t = jointTransform(j, null, true)
    expect(t.quaternion[2]).toBeCloseTo(Math.SQRT1_2)
    expect(t.position).toEqual([0, 0, 0])
  })

  it("un prismático se desplaza por el eje, en metros", () => {
    const j = joint({ type: "prismatic", axis: [0, 0, 2], units: "millimeters", manual: 500 })
    const t = jointTransform(j, null, true)
    expect(t.position[2]).toBeCloseTo(0.5)
    expect(t.position[0]).toBeCloseTo(0)
    expect(t.quaternion).toEqual([0, 0, 0, 1])
  })

  it("un prismático en un eje diagonal reparte el desplazamiento", () => {
    const j = joint({ type: "prismatic", axis: [1, 1, 0], units: "meters", manual: Math.SQRT2 })
    const t = jointTransform(j, null, true)
    expect(t.position[0]).toBeCloseTo(1)
    expect(t.position[1]).toBeCloseTo(1)
  })
})

describe("poseTransform", () => {
  it("lee un Pose3d completo y reordena el cuaternión a (x,y,z,w)", () => {
    // X, Y, Z, QW, QX, QY, QZ
    const bytes = doublesToBytes([1, 2, 3, 0.5, 0.5, 0.5, 0.5])
    const j = joint({ topicName: "/a", topicType: "struct:Pose3d" })
    const t = poseTransform({ Raw: bytes }, j)!
    expect(t.position).toEqual([1, 2, 3])
    expect(t.quaternion).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it("un Pose2d gira solo sobre Z y deja Z en cero", () => {
    const bytes = doublesToBytes([4, 5, Math.PI])
    const j = joint({ topicName: "/a", topicType: "struct:Pose2d" })
    const t = poseTransform({ Raw: bytes }, j)!
    expect(t.position).toEqual([4, 5, 0])
    expect(t.quaternion[2]).toBeCloseTo(1)
  })

  it("un Translation3d no aporta rotación", () => {
    const bytes = doublesToBytes([1, 2, 3])
    const j = joint({ topicName: "/a", topicType: "struct:Translation3d" })
    const t = poseTransform({ Raw: bytes }, j)!
    expect(t.position).toEqual([1, 2, 3])
    expect(t.quaternion).toEqual([0, 0, 0, 1])
  })

  it("toma el índice pedido de un Pose3d[]", () => {
    const bytes = doublesToBytes([
      0, 0, 0, 1, 0, 0, 0,
      9, 8, 7, 1, 0, 0, 0,
    ])
    const j = joint({ topicName: "/a", topicType: "struct:Pose3d[]", arrayIndex: 1 })
    const t = poseTransform({ Raw: bytes }, j)!
    expect(t.position).toEqual([9, 8, 7])
  })
})

describe("árbol de piezas", () => {
  const part = (id: string, parentId: string | null) => makeMechanism3dPart(id, id, parentId)

  it("anida por parentId", () => {
    const parts = [part("a", null), part("b", "a"), part("c", "b"), part("d", null)]
    const roots = buildPartTree(parts)
    expect(roots.map(r => r.part.id)).toEqual(["a", "d"])
    expect(flattenTree(roots).map(n => `${n.part.id}@${n.depth}`)).toEqual(["a@0", "b@1", "c@2", "d@0"])
  })

  it("una pieza con padre inexistente queda en la raíz en vez de perderse", () => {
    const roots = buildPartTree([part("a", "fantasma")])
    expect(roots.map(r => r.part.id)).toEqual(["a"])
  })

  it("un ciclo no cuelga el armado", () => {
    const parts = [part("a", "b"), part("b", "a")]
    const roots = buildPartTree(parts)
    expect(flattenTree(roots)).toHaveLength(2)
  })

  it("descendantIds junta la rama completa", () => {
    const parts = [part("a", null), part("b", "a"), part("c", "b"), part("d", null)]
    expect(descendantIds(parts, "a").sort()).toEqual(["a", "b", "c"])
  })

  it("canReparent no deja crear ciclos", () => {
    const parts = [part("a", null), part("b", "a"), part("c", "b")]
    expect(canReparent(parts, "a", "c")).toBe(false)
    expect(canReparent(parts, "a", "a")).toBe(false)
    expect(canReparent(parts, "c", null)).toBe(true)
    expect(canReparent(parts, "b", null)).toBe(true)
  })
})

describe("normalización", () => {
  it("descarta piezas sin id y deduplica", () => {
    const parts = normalizeParts([
      { id: "a", name: "A" },
      { id: "a", name: "duplicada" },
      { name: "sin id" },
      null,
    ])
    expect(parts.map(p => p.id)).toEqual(["a"])
    expect(parts[0].name).toBe("A")
  })

  it("rellena los campos que falten con el default", () => {
    const [part] = normalizeParts([{ id: "a" }])
    expect(part.opacity).toBe(1)
    expect(part.joint.type).toBe("fixed")
    expect(part.origin).toEqual([0, 0, 0])
  })

  it("limpia NaN en las ternas de números", () => {
    const [part] = normalizeParts([{ id: "a", origin: [1, "x", null], shapeSize: [NaN, 2, 3] }])
    expect(part.origin).toEqual([1, 0, 0])
    expect(part.shapeSize[0]).toBe(0.1)
  })

  it("cae al default en enums desconocidos", () => {
    const [part] = normalizeParts([{ id: "a", shape: "toroide", joint: { type: "helicoidal" } }])
    expect(part.shape).toBe("box")
    expect(part.joint.type).toBe("fixed")
  })

  it("settings tolera basura", () => {
    const settings = normalizeSettings({ gizmo: "escalar", gridCell: -5, background: "fucsia" })
    expect(settings.gizmo).toBe("off")
    expect(settings.gridCell).toBeGreaterThan(0)
    expect(settings.background).toBe("light")
  })
})

describe("configuración exportable", () => {
  const parts = [
    { ...makeMechanism3dPart("base", "Base", null), modelPath: "C:/models/base.stl" },
    {
      ...makeMechanism3dPart("arm", "Arm", "base"),
      joint: { ...defaultMechanism3dJoint, type: "revolute" as const, axis: [0, 1, 0] as [number, number, number] },
    },
  ]

  it("va y vuelve sin perder nada", () => {
    const text = serializeMechanism3d(parts, defaultMechanism3dSettings)
    const back = parseMechanism3d(text)
    expect(back.parts).toHaveLength(2)
    expect(back.parts[0].modelPath).toBe("C:/models/base.stl")
    expect(back.parts[1].parentId).toBe("base")
    expect(back.parts[1].joint.type).toBe("revolute")
    expect(back.parts[1].joint.axis).toEqual([0, 1, 0])
  })

  it("conserva el nombre del mecanismo", () => {
    const text = serializeMechanism3d(parts, { ...defaultMechanism3dSettings, name: "Elevador" })
    expect(parseMechanism3d(text).settings.name).toBe("Elevador")
  })

  it("rechaza un JSON que no sea un config de mecanismo", () => {
    expect(() => parseMechanism3d('{"openTabs":[]}')).toThrow(/mechanism config/)
  })

  it("rechaza texto que no es JSON", () => {
    expect(() => parseMechanism3d("no soy json")).toThrow(/valid JSON/)
  })

  it("rechaza una versión futura en vez de leerla a medias", () => {
    const text = serializeMechanism3d(parts, defaultMechanism3dSettings).replace('"version": 1', '"version": 99')
    expect(() => parseMechanism3d(text)).toThrow(/newer version/)
  })

  it("rechaza un config sin piezas usables", () => {
    const text = serializeMechanism3d([], defaultMechanism3dSettings)
    expect(() => parseMechanism3d(text)).toThrow(/no usable parts/)
  })
})

describe("duplicatePart", () => {
  it("copia en profundidad las ternas para no compartir referencias", () => {
    const original = makeMechanism3dPart("a", "A", null)
    const copy = duplicatePart(original, "b")
    copy.origin[0] = 5
    copy.joint.axis[0] = 5
    expect(original.origin[0]).toBe(0)
    expect(original.joint.axis[0]).toBe(0)
    expect(copy.id).toBe("b")
  })
})

describe("isJointTopic", () => {
  it("acepta números, booleanos, arrays y structs", () => {
    expect(isJointTopic("double")).toBe(true)
    expect(isJointTopic("boolean")).toBe(true)
    expect(isJointTopic("double[]")).toBe(true)
    expect(isJointTopic("boolean[]")).toBe(true)
    expect(isJointTopic("struct:Pose3d")).toBe(true)
    expect(isJointTopic("struct:Pose3d[]")).toBe(true)
  })

  it("rechaza texto y tablas sendable", () => {
    expect(isJointTopic("string")).toBe(false)
    expect(isJointTopic("string[]")).toBe(false)
    expect(isJointTopic("Field2d")).toBe(false)
  })
})

describe("bindJointTopic", () => {
  it("un Pose3d propone una articulación de pose", () => {
    const j = bindJointTopic(joint(), "/robot/comp", "struct:Pose3d[]")
    expect(j.type).toBe("pose")
    expect(j.arrayIndex).toBe(0)
    expect(j.topicName).toBe("/robot/comp")
  })

  it("un double propone un revolute en grados", () => {
    const j = bindJointTopic(joint(), "/arm/angle", "double")
    expect(j.type).toBe("revolute")
    expect(j.units).toBe("degrees")
    expect(j.arrayIndex).toBeNull()
  })

  it("un Rotation2d no se confunde con una pose", () => {
    expect(bindJointTopic(joint(), "/a", "struct:Rotation2d").type).toBe("revolute")
  })

  it("no pisa el tipo que el usuario ya eligió", () => {
    const j = bindJointTopic(joint({ type: "prismatic", units: "meters" }), "/lift/height", "double")
    expect(j.type).toBe("prismatic")
    expect(j.units).toBe("meters")
  })

  it("corrige unidades incompatibles con el tipo", () => {
    const j = bindJointTopic(joint({ type: "prismatic", units: "degrees" }), "/lift/height", "double")
    expect(j.units).toBe("meters")
  })

  it("un double[] arranca en el índice 0", () => {
    expect(bindJointTopic(joint(), "/a", "double[]").arrayIndex).toBe(0)
  })
})

describe("pivote", () => {
  it("en reposo el modelo no se mueve por más que se corra el pivote", () => {
    const identity = { position: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const }
    const out = applyJointToPoint([0.3, 0, 0], [0.9, -0.4, 0.2], {
      position: [...identity.position], quaternion: [...identity.quaternion],
    })
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(0)
    expect(out[2]).toBeCloseTo(0)
  })

  it("el punto que ESTÁ en el pivote se queda quieto al girar", () => {
    const t = jointTransform(
      joint({ type: "revolute", axis: [0, 0, 1], units: "degrees", manual: 90 }), null, true,
    )
    const out = applyJointToPoint([1, 0, 0], [1, 0, 0], t)
    expect(out[0]).toBeCloseTo(1)
    expect(out[1]).toBeCloseTo(0)
  })

  it("gira alrededor del pivote y no del origen", () => {
    const t = jointTransform(
      joint({ type: "revolute", axis: [0, 0, 1], units: "degrees", manual: 90 }), null, true,
    )
    // Girar 90° sobre Z alrededor de (1,0,0) lleva (2,0,0) a (1,1,0).
    const out = applyJointToPoint([2, 0, 0], [1, 0, 0], t)
    expect(out[0]).toBeCloseTo(1)
    expect(out[1]).toBeCloseTo(1)

    // Con pivote en el origen el mismo punto se iría a (0,2,0).
    const noPivot = applyJointToPoint([2, 0, 0], [0, 0, 0], t)
    expect(noPivot[0]).toBeCloseTo(0)
    expect(noPivot[1]).toBeCloseTo(2)
  })

  it("un prismático desplaza igual esté donde esté el pivote", () => {
    const t = jointTransform(
      joint({ type: "prismatic", axis: [0, 0, 1], units: "meters", manual: 0.5 }), null, true,
    )
    expect(applyJointToPoint([0, 0, 0], [3, 2, 1], t)[2]).toBeCloseTo(0.5)
  })
})

describe("rangos de los indicadores", () => {
  it("travelRange convierte a metros y ordena", () => {
    const r = travelRange(joint({ type: "prismatic", units: "millimeters", min: 500, max: 0 }), 0.1)
    expect(r.min).toBeCloseTo(0)
    expect(r.max).toBeCloseTo(0.5)
  })

  it("travelRange usa el fallback si no hay límites", () => {
    const r = travelRange(joint({ type: "prismatic", units: "meters" }), 0.2)
    expect(r.min).toBeCloseTo(-0.2)
    expect(r.max).toBeCloseTo(0.2)
  })

  it("sweepRange devuelve null sin límites o si dan una vuelta entera", () => {
    expect(sweepRange(joint({ min: null, max: 90 }))).toBeNull()
    expect(sweepRange(joint({ min: -180, max: 180 }))).toBeNull()
    expect(sweepRange(joint({ min: 90, max: 10 }))).toBeNull()
  })

  it("sweepRange convierte a radianes", () => {
    const r = sweepRange(joint({ units: "degrees", min: -90, max: 90 }))!
    expect(r.min).toBeCloseTo(-Math.PI / 2)
    expect(r.max).toBeCloseTo(Math.PI / 2)
  })
})

describe("rutinas", () => {
  const step = (over: Partial<Mechanism3dRoutineStep> = {}): Mechanism3dRoutineStep => ({
    id: "s1", partId: "arm", from: 0, to: 90,
    startMs: 0, durationMs: 1000, easing: "linear", pingPong: false,
    ...over,
  })
  const routine = (steps: Mechanism3dRoutineStep[]): Mechanism3dRoutine => ({
    id: "r1", name: "R", loop: true, steps,
  })

  it("interpola linealmente entre from y to", () => {
    const r = routine([step()])
    expect(evaluateRoutine(r, 0).arm).toBeCloseTo(0)
    expect(evaluateRoutine(r, 500).arm).toBeCloseTo(45)
    expect(evaluateRoutine(r, 1000).arm).toBeCloseTo(90)
  })

  it("se queda en el valor final cuando el paso termina", () => {
    expect(evaluateRoutine(routine([step()]), 9999).arm).toBeCloseTo(90)
  })

  it("ida y vuelta regresa al inicio", () => {
    const r = routine([step({ pingPong: true })])
    expect(evaluateRoutine(r, 1000).arm).toBeCloseTo(90)
    expect(evaluateRoutine(r, 1500).arm).toBeCloseTo(45)
    expect(evaluateRoutine(r, 2000).arm).toBeCloseTo(0)
  })

  it("espera en el valor inicial hasta que arranca", () => {
    const r = routine([step({ startMs: 500 })])
    expect(evaluateRoutine(r, 0).arm).toBeCloseTo(0)
    expect(evaluateRoutine(r, 200).arm).toBeCloseTo(0)
    expect(evaluateRoutine(r, 1000).arm).toBeCloseTo(45)
  })

  it("smooth arranca y frena suave pero pasa por el medio", () => {
    const r = routine([step({ easing: "smooth" })])
    expect(evaluateRoutine(r, 500).arm).toBeCloseTo(45)
    // Al 25% del recorrido, smoothstep va bastante por detrás de la lineal.
    expect(evaluateRoutine(r, 250).arm).toBeLessThan(22.5)
    expect(evaluateRoutine(r, 250).arm).toBeGreaterThan(0)
  })

  it("mueve varias piezas a la vez", () => {
    const r = routine([step(), step({ id: "s2", partId: "wrist", from: 10, to: 20 })])
    const at = evaluateRoutine(r, 500)
    expect(at.arm).toBeCloseTo(45)
    expect(at.wrist).toBeCloseTo(15)
  })

  it("routineDuration cuenta la vuelta del ping-pong", () => {
    expect(routineDuration(routine([step()]))).toBe(1000)
    expect(routineDuration(routine([step({ pingPong: true })]))).toBe(2000)
    expect(routineDuration(routine([step({ startMs: 500, durationMs: 200 })]))).toBe(700)
    expect(routineDuration(routine([]))).toBe(0)
  })

  it("una duración de cero no rompe la interpolación", () => {
    const r = routine([step({ durationMs: 0 })])
    expect(isFinite(evaluateRoutine(r, 10).arm)).toBe(true)
  })

  it("normalizeRoutines descarta lo que no se puede usar y deduplica", () => {
    const routines = normalizeRoutines([
      { id: "a", name: "A", steps: [{ id: "s", partId: "p" }, { id: "s2" }, null] },
      { id: "a", name: "duplicada" },
      { name: "sin id" },
    ])
    expect(routines).toHaveLength(1)
    expect(routines[0].name).toBe("A")
    expect(routines[0].steps).toHaveLength(1)
    expect(routines[0].steps[0].durationMs).toBe(1000)
  })

  it("sweepStep usa los límites de la articulación", () => {
    const part = {
      ...makeMechanism3dPart("arm", "Arm", null),
      joint: { ...defaultMechanism3dJoint, type: "revolute" as const, min: -30, max: 120 },
    }
    const s = sweepStep(part, "s1")!
    expect(s.from).toBe(-30)
    expect(s.to).toBe(120)
    expect(s.pingPong).toBe(true)
  })

  it("sweepStep inventa un recorrido si no hay límites", () => {
    const part = {
      ...makeMechanism3dPart("arm", "Arm", null),
      joint: { ...defaultMechanism3dJoint, type: "revolute" as const },
    }
    const s = sweepStep(part, "s1")!
    expect(s.from).toBe(-45)
    expect(s.to).toBe(45)
  })

  it("sweepStep no aplica a una articulación fija o de pose", () => {
    const fixed = makeMechanism3dPart("a", "A", null)
    expect(sweepStep(fixed, "s")).toBeNull()
  })
})
