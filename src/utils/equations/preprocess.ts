// Pasadas que reescriben el AST ANTES de evaluarlo o de pasarlo a LaTeX.
//
// Trabajar por sustitución en el árbol —en vez de resolver en el evaluador—
// hace que todo lo de aguas abajo funcione gratis: una ecuación que referencia
// a otra se puede derivar simbólicamente, se puede meter dentro de d(), y se
// renderiza expandida sin código extra.

import { Node } from "./parser"
import { derive } from "./symbolic"

export class PreprocessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreprocessError"
  }
}

/** Ecuación con nombre que otras pueden referenciar como si fuera una variable. */
export interface NamedEquation {
  name: string
  ast: Node
}

function mapChildren(node: Node, fn: (child: Node) => Node): Node {
  switch (node.kind) {
    case "number":
    case "variable":
      return node
    case "unary":
      return { kind: "unary", op: node.op, operand: fn(node.operand) }
    case "binary":
      return { kind: "binary", op: node.op, left: fn(node.left), right: fn(node.right) }
    case "call":
      return { kind: "call", name: node.name, args: node.args.map(fn) }
    case "matrix":
      return { kind: "matrix", rows: node.rows.map(row => row.map(fn)) }
  }
}

/**
 * Reemplaza las referencias a otras ecuaciones por su árbol completo.
 * `visiting` detecta ciclos: si A usa B y B vuelve a A, se corta con un error
 * en vez de colgarse.
 */
export function inlineEquations(
  node: Node,
  definitions: Map<string, Node>,
  visiting: string[] = [],
): Node {
  if (node.kind === "variable") {
    const definition = definitions.get(node.name)
    if (!definition) return node

    if (visiting.includes(node.name)) {
      throw new PreprocessError(`Circular reference: ${[...visiting, node.name].join(" → ")}`)
    }
    return inlineEquations(definition, definitions, [...visiting, node.name])
  }

  return mapChildren(node, child => inlineEquations(child, definitions, visiting))
}

/**
 * Expande diff(f, x) a la derivada simbólica de f respecto a x.
 * Se hace de adentro hacia afuera para que diff(diff(f, x), x) —la segunda
 * derivada— también funcione.
 */
export function expandSymbolicDerivatives(node: Node): Node {
  const expanded = mapChildren(node, expandSymbolicDerivatives)

  if (expanded.kind === "call" && (expanded.name === "diff" || expanded.name === "D")) {
    if (expanded.args.length !== 2) {
      throw new PreprocessError("diff() takes 2 arguments: diff(expression, variable)")
    }
    const target = expanded.args[1]
    if (target.kind !== "variable") {
      throw new PreprocessError("The second argument of diff() must be a variable name")
    }
    return derive(expanded.args[0], target.name)
  }

  return expanded
}

/** Preprocesado completo, en el orden en que tiene que pasar. */
export function preprocess(node: Node, definitions: Map<string, Node>): Node {
  // Primero se inlinean las referencias, para que diff() pueda derivar a
  // través de una ecuación con nombre y no se tope con una variable opaca.
  return expandSymbolicDerivatives(inlineEquations(node, definitions))
}
