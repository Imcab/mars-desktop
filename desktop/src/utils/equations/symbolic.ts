// Derivación simbólica sobre el AST.
//
// A diferencia de d(x), que deriva NUMÉRICAMENTE respecto al tiempo usando el
// buffer, esto deriva respecto a una variable y devuelve otra expresión: de
// x^3 sale 3x^2, no un número. Por eso la fórmula resultante se puede ver
// escrita en LaTeX además de evaluarse.
//
// Sin simplificación el resultado es ilegible (la regla del producto sobre
// 2*x escupe "0*x + 2*1"), así que simplify() es parte del contrato, no un
// adorno opcional.

import { Node } from "./parser"

export class SymbolicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SymbolicError"
  }
}

const num = (value: number): Node => ({ kind: "number", value })
const ZERO = num(0)
const ONE = num(1)

function isNumber(node: Node, value: number): boolean {
  return node.kind === "number" && node.value === value
}

// --- Constructores que simplifican al vuelo --------------------------------

function sum(left: Node, right: Node): Node {
  if (isNumber(left, 0)) return right
  if (isNumber(right, 0)) return left
  if (left.kind === "number" && right.kind === "number") return num(left.value + right.value)
  return { kind: "binary", op: "+", left, right }
}

function difference(left: Node, right: Node): Node {
  if (isNumber(right, 0)) return left
  if (left.kind === "number" && right.kind === "number") return num(left.value - right.value)
  if (isNumber(left, 0)) return { kind: "unary", op: "-", operand: right }
  return { kind: "binary", op: "-", left, right }
}

function product(left: Node, right: Node): Node {
  if (isNumber(left, 0) || isNumber(right, 0)) return ZERO
  if (isNumber(left, 1)) return right
  if (isNumber(right, 1)) return left
  if (left.kind === "number" && right.kind === "number") return num(left.value * right.value)
  return { kind: "binary", op: "*", left, right }
}

function quotient(left: Node, right: Node): Node {
  if (isNumber(left, 0)) return ZERO
  if (isNumber(right, 1)) return left
  return { kind: "binary", op: "/", left, right }
}

function power(base: Node, exponent: Node): Node {
  if (isNumber(exponent, 0)) return ONE
  if (isNumber(exponent, 1)) return base
  return { kind: "binary", op: "^", left: base, right: exponent }
}

const call = (name: string, ...args: Node[]): Node => ({ kind: "call", name, args })

// --- Reglas de la cadena por función ---------------------------------------

// Derivada de f respecto a su argumento; la regla de la cadena la aplica
// differentiate() multiplicando por u'.
const OUTER_DERIVATIVES: Record<string, (u: Node) => Node> = {
  sin: u => call("cos", u),
  cos: u => ({ kind: "unary", op: "-", operand: call("sin", u) }),
  tan: u => quotient(ONE, power(call("cos", u), num(2))),
  asin: u => quotient(ONE, call("sqrt", difference(ONE, power(u, num(2))))),
  acos: u => ({ kind: "unary", op: "-", operand: quotient(ONE, call("sqrt", difference(ONE, power(u, num(2))))) }),
  atan: u => quotient(ONE, sum(ONE, power(u, num(2)))),
  sinh: u => call("cosh", u),
  cosh: u => call("sinh", u),
  tanh: u => difference(ONE, power(call("tanh", u), num(2))),
  exp: u => call("exp", u),
  ln: u => quotient(ONE, u),
  log: u => quotient(ONE, product(u, call("ln", num(10)))),
  log2: u => quotient(ONE, product(u, call("ln", num(2)))),
  sqrt: u => quotient(ONE, product(num(2), call("sqrt", u))),
  abs: u => call("sign", u),
  deg: () => num(180 / Math.PI),
  rad: () => num(Math.PI / 180),
  // d/dx (e^x − 1) = e^x ; d/dx ln(1+x) = 1/(1+x)
  expm1: u => call("exp", u),
  log1p: u => quotient(ONE, sum(ONE, u)),
}

// Funciones cuya derivada es 0 en casi todo punto (escalones).
const PIECEWISE_CONSTANT = new Set(["sign", "floor", "ceil", "round", "trunc", "rint"])

// Continuas a trozos o discretas: derivarlas daría un resultado que miente en
// los bordes, así que se rechazan explícitamente.
const NON_DIFFERENTIABLE = new Set([
  "min", "max", "clamp", "wrap",
  "deadband", "inputModulus", "angleModulus", "isNear",
  "copySign", "floorDiv", "floorMod", "ieeeRem", "ulp",
  "copyDirPow", "invLerp",
])

/** Deriva `node` respecto a la variable `variable`. */
export function differentiate(node: Node, variable: string): Node {
  switch (node.kind) {
    case "number":
      return ZERO

    case "variable":
      return node.name === variable ? ONE : ZERO

    case "unary":
      return node.op === "-"
        ? { kind: "unary", op: "-", operand: differentiate(node.operand, variable) }
        : differentiate(node.operand, variable)

    case "binary": {
      const u = node.left
      const v = node.right
      const du = differentiate(u, variable)
      const dv = differentiate(v, variable)

      switch (node.op) {
        case "+": return sum(du, dv)
        case "-": return difference(du, dv)
        // Regla del producto: u'v + uv'
        case "*": return sum(product(du, v), product(u, dv))
        // Regla del cociente: (u'v − uv') / v²
        case "/": return quotient(difference(product(du, v), product(u, dv)), power(v, num(2)))
        case "^": {
          // Exponente constante: n·u^(n−1)·u'
          if (isNumber(dv, 0)) {
            return product(product(v, power(u, difference(v, ONE))), du)
          }
          // Caso general: u^v · (v'·ln(u) + v·u'/u)
          return product(
            power(u, v),
            sum(product(dv, call("ln", u)), quotient(product(v, du), u)),
          )
        }
        case "%":
          throw new SymbolicError("Cannot symbolically differentiate the modulo operator")
      }
      break
    }

    case "call": {
      if (PIECEWISE_CONSTANT.has(node.name)) return ZERO

      if (NON_DIFFERENTIABLE.has(node.name)) {
        throw new SymbolicError(`Cannot symbolically differentiate ${node.name}()`)
      }

      // fma(a,b,c) = a·b + c y lerp son combinaciones lineales: se derivan
      // reescribiéndolas con los operadores básicos.
      if (node.name === "fma" && node.args.length === 3) {
        const [a, b, c] = node.args
        return differentiate({
          kind: "binary", op: "+",
          left: { kind: "binary", op: "*", left: a, right: b },
          right: c,
        }, variable)
      }
      if (node.name === "lerp" && node.args.length === 3) {
        // a + (b − a)·t, tratando t como una variable más
        const [a, b, t] = node.args
        return differentiate({
          kind: "binary", op: "+",
          left: a,
          right: { kind: "binary", op: "*", left: { kind: "binary", op: "-", left: b, right: a }, right: t },
        }, variable)
      }

      // Los operadores temporales no dependen de una variable simbólica.
      if (["d", "derivative", "int", "integral", "avg", "rms", "stddev", "peak"].includes(node.name)) {
        throw new SymbolicError(`Cannot symbolically differentiate the time operator ${node.name}()`)
      }

      if (node.name === "hypot" && node.args.length === 2) {
        // d/dx √(a²+b²) = (a·a' + b·b') / √(a²+b²)
        const [a, b] = node.args
        const da = differentiate(a, variable)
        const db = differentiate(b, variable)
        return quotient(sum(product(a, da), product(b, db)), call("hypot", a, b))
      }

      if (node.name === "pow" && node.args.length === 2) {
        return differentiate({ kind: "binary", op: "^", left: node.args[0], right: node.args[1] }, variable)
      }

      if (node.name === "atan2" && node.args.length === 2) {
        // d/dx atan2(y, x) = (y'·x − y·x') / (x² + y²)
        const [y, x] = node.args
        const dy = differentiate(y, variable)
        const dx = differentiate(x, variable)
        return quotient(
          difference(product(dy, x), product(y, dx)),
          sum(power(x, num(2)), power(y, num(2))),
        )
      }

      const outer = OUTER_DERIVATIVES[node.name]
      if (!outer) throw new SymbolicError(`No derivative rule for ${node.name}()`)
      if (node.args.length !== 1) throw new SymbolicError(`${node.name}() must take 1 argument to differentiate`)

      const u = node.args[0]
      return product(outer(u), differentiate(u, variable))
    }

    case "matrix":
      // Se deriva entrada por entrada.
      return {
        kind: "matrix",
        rows: node.rows.map(row => row.map(entry => differentiate(entry, variable))),
      }
  }

  throw new SymbolicError("Malformed expression")
}

/** Pasada de limpieza sobre el árbol ya derivado. */
export function simplify(node: Node): Node {
  switch (node.kind) {
    case "number":
    case "variable":
      return node

    case "unary": {
      const operand = simplify(node.operand)
      if (node.op === "+") return operand
      if (operand.kind === "number") return num(-operand.value)
      // −(−u) = u
      if (operand.kind === "unary" && operand.op === "-") return operand.operand
      return { kind: "unary", op: "-", operand }
    }

    case "binary": {
      const left = simplify(node.left)
      const right = simplify(node.right)
      switch (node.op) {
        case "+": return sum(left, right)
        case "-": return difference(left, right)
        case "*": return product(left, right)
        case "/": return quotient(left, right)
        case "^": {
          if (left.kind === "number" && right.kind === "number") return num(Math.pow(left.value, right.value))
          return power(left, right)
        }
        default: return { kind: "binary", op: node.op, left, right }
      }
    }

    case "call":
      return { kind: "call", name: node.name, args: node.args.map(simplify) }

    case "matrix":
      return { kind: "matrix", rows: node.rows.map(row => row.map(simplify)) }
  }
}

/** Deriva y simplifica en un paso: es como se usa siempre. */
export function derive(node: Node, variable: string): Node {
  return simplify(differentiate(node, variable))
}
