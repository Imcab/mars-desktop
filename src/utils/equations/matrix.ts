// Álgebra matricial mínima pero completa para lo que se necesita acá:
// cinemática de swerve, matrices de rotación, covarianzas y espacio de estados.

export interface Matrix {
  rows: number
  cols: number
  data: number[][]
}

export class MatrixError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MatrixError"
  }
}

export function isMatrix(value: unknown): value is Matrix {
  return typeof value === "object" && value !== null && "data" in value && "rows" in value && "cols" in value
}

export function makeMatrix(data: number[][]): Matrix {
  const rows = data.length
  if (rows === 0) throw new MatrixError("Matrix cannot be empty")
  const cols = data[0].length
  if (data.some(row => row.length !== cols)) {
    throw new MatrixError("All matrix rows must have the same length")
  }
  return { rows, cols, data }
}

export function identity(n: number): Matrix {
  if (!Number.isInteger(n) || n < 1) throw new MatrixError("eye(n) needs a positive integer")
  return makeMatrix(Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ))
}

export function filled(rows: number, cols: number, value: number): Matrix {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new MatrixError("Matrix dimensions must be positive integers")
  }
  return makeMatrix(Array.from({ length: rows }, () => Array(cols).fill(value)))
}

// Matriz de rotación 2D: la que lleva un vector del marco del robot al del campo.
export function rotation2d(theta: number): Matrix {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return makeMatrix([[c, -s], [s, c]])
}

function elementwise(a: Matrix, b: Matrix, op: (x: number, y: number) => number, name: string): Matrix {
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new MatrixError(`Cannot ${name} a ${a.rows}×${a.cols} and a ${b.rows}×${b.cols} matrix`)
  }
  return makeMatrix(a.data.map((row, i) => row.map((value, j) => op(value, b.data[i][j]))))
}

export function add(a: Matrix, b: Matrix): Matrix {
  return elementwise(a, b, (x, y) => x + y, "add")
}

export function subtract(a: Matrix, b: Matrix): Matrix {
  return elementwise(a, b, (x, y) => x - y, "subtract")
}

export function scale(m: Matrix, k: number): Matrix {
  return makeMatrix(m.data.map(row => row.map(value => value * k)))
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  if (a.cols !== b.rows) {
    throw new MatrixError(`Cannot multiply ${a.rows}×${a.cols} by ${b.rows}×${b.cols}`)
  }
  const data = Array.from({ length: a.rows }, (_, i) =>
    Array.from({ length: b.cols }, (_, j) => {
      let sum = 0
      for (let k = 0; k < a.cols; k++) sum += a.data[i][k] * b.data[k][j]
      return sum
    }),
  )
  return makeMatrix(data)
}

export function transpose(m: Matrix): Matrix {
  return makeMatrix(Array.from({ length: m.cols }, (_, i) =>
    Array.from({ length: m.rows }, (_, j) => m.data[j][i]),
  ))
}

// Determinante por eliminación gaussiana con pivoteo parcial: estable y O(n³),
// a diferencia de la expansión por cofactores que es O(n!).
export function determinant(m: Matrix): number {
  if (m.rows !== m.cols) throw new MatrixError("Determinant needs a square matrix")

  const n = m.rows
  const a = m.data.map(row => [...row])
  let det = 1

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-14) return 0

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]]
      det = -det
    }
    det *= a[col][col]

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col]
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k]
    }
  }

  return det
}

// Inversa por Gauss-Jordan sobre la matriz aumentada [A | I].
export function inverse(m: Matrix): Matrix {
  if (m.rows !== m.cols) throw new MatrixError("Inverse needs a square matrix")

  const n = m.rows
  const a = m.data.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-14) throw new MatrixError("Matrix is singular, cannot invert")
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]]

    const diagonal = a[col][col]
    for (let k = 0; k < 2 * n; k++) a[col][k] /= diagonal

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      if (factor === 0) continue
      for (let k = 0; k < 2 * n; k++) a[row][k] -= factor * a[col][k]
    }
  }

  return makeMatrix(a.map(row => row.slice(n)))
}

// Traza: suma de la diagonal. Aparece seguido al mirar covarianzas
// (traza pequeña = filtro confiado).
export function trace(m: Matrix): number {
  if (m.rows !== m.cols) throw new MatrixError("Trace needs a square matrix")
  return m.data.reduce((sum, row, i) => sum + row[i], 0)
}

// Norma de Frobenius: la magnitud "total" de la matriz. Para un vector
// coincide con la norma euclídea de siempre.
export function norm(m: Matrix): number {
  return Math.sqrt(m.data.reduce((sum, row) => sum + row.reduce((s, v) => s + v * v, 0), 0))
}

// Un 1×1 se degrada a escalar: así (Aᵀ·B) de dos vectores da un número y no
// una matriz de un solo elemento, que es lo que uno espera al escribirlo.
export function collapseScalar(m: Matrix): Matrix | number {
  return m.rows === 1 && m.cols === 1 ? m.data[0][0] : m
}

// --- Operaciones elemento a elemento (las "element*" de WPILib) -------------

export function elementTimes(a: Matrix, b: Matrix): Matrix {
  return elementwise(a, b, (x, y) => x * y, "element-multiply")
}

export function elementDiv(a: Matrix, b: Matrix): Matrix {
  return elementwise(a, b, (x, y) => x / y, "element-divide")
}

export function elementPower(m: Matrix, exponent: number): Matrix {
  return makeMatrix(m.data.map(row => row.map(value => Math.pow(value, exponent))))
}

// WPILib permite sumar/restar un escalar a todos los elementos. Se expone como
// función y no en el operador "+", para que M + 1 siga siendo un error de
// dimensiones en vez de significar dos cosas distintas según el tipo.
export function elementPlus(m: Matrix, k: number): Matrix {
  return makeMatrix(m.data.map(row => row.map(value => value + k)))
}

export function map(m: Matrix, fn: (value: number) => number): Matrix {
  return makeMatrix(m.data.map(row => row.map(fn)))
}

// --- Reducciones ------------------------------------------------------------

function flat(m: Matrix): number[] {
  return m.data.flat()
}

export function elementSum(m: Matrix): number {
  return flat(m).reduce((a, b) => a + b, 0)
}

export function mean(m: Matrix): number {
  const values = flat(m)
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function elementMax(m: Matrix): number {
  return Math.max(...flat(m))
}

export function elementMin(m: Matrix): number {
  return Math.min(...flat(m))
}

export function elementMaxAbs(m: Matrix): number {
  return Math.max(...flat(m).map(Math.abs))
}

// Norma inducida 1: la mayor suma de valores absolutos por columna.
export function normP1(m: Matrix): number {
  let best = 0
  for (let col = 0; col < m.cols; col++) {
    let sum = 0
    for (let row = 0; row < m.rows; row++) sum += Math.abs(m.data[row][col])
    if (sum > best) best = sum
  }
  return best
}

// --- Estructura -------------------------------------------------------------

// Igual que WPILib: de un vector arma la matriz diagonal, de una matriz
// extrae la diagonal como vector columna.
export function diagonal(m: Matrix): Matrix {
  const isVector = m.rows === 1 || m.cols === 1
  if (isVector) {
    const values = flat(m)
    return makeMatrix(values.map((value, i) =>
      values.map((_, j) => (i === j ? value : 0)),
    ))
  }
  const size = Math.min(m.rows, m.cols)
  return makeMatrix(Array.from({ length: size }, (_, i) => [m.data[i][i]]))
}

export function extractRow(m: Matrix, index: number): Matrix {
  if (!Number.isInteger(index) || index < 0 || index >= m.rows) {
    throw new MatrixError(`Row ${index} is out of range for a ${m.rows}×${m.cols} matrix`)
  }
  return makeMatrix([[...m.data[index]]])
}

export function extractColumn(m: Matrix, index: number): Matrix {
  if (!Number.isInteger(index) || index < 0 || index >= m.cols) {
    throw new MatrixError(`Column ${index} is out of range for a ${m.rows}×${m.cols} matrix`)
  }
  return makeMatrix(m.data.map(row => [row[index]]))
}

export function block(m: Matrix, startRow: number, startCol: number, height: number, width: number): Matrix {
  if ([startRow, startCol, height, width].some(n => !Number.isInteger(n))) {
    throw new MatrixError("block() indices must be integers")
  }
  if (startRow < 0 || startCol < 0 || height < 1 || width < 1
    || startRow + height > m.rows || startCol + width > m.cols) {
    throw new MatrixError(`block() range is outside a ${m.rows}×${m.cols} matrix`)
  }
  return makeMatrix(
    m.data.slice(startRow, startRow + height).map(row => row.slice(startCol, startCol + width)),
  )
}

export function isEqual(a: Matrix, b: Matrix, tolerance: number): boolean {
  if (a.rows !== b.rows || a.cols !== b.cols) return false
  return a.data.every((row, i) => row.every((value, j) => Math.abs(value - b.data[i][j]) <= tolerance))
}

// --- Solvers ----------------------------------------------------------------

// Resuelve A·x = b. Si A no es cuadrada se usa la pseudo-inversa por mínimos
// cuadrados —(AᵀA)⁻¹Aᵀb—, igual que el solve() de WPILib.
export function solveLinear(a: Matrix, b: Matrix): Matrix {
  if (a.rows !== b.rows) {
    throw new MatrixError(`Cannot solve: A has ${a.rows} rows but b has ${b.rows}`)
  }
  if (a.rows === a.cols) {
    return multiply(inverse(a), b)
  }
  const at = transpose(a)
  return multiply(multiply(inverse(multiply(at, a)), at), b)
}

// Descomposición de Cholesky: A = L·Lᵀ con L triangular inferior. Solo existe
// si A es simétrica y definida positiva — que es justo el caso de las
// matrices de covarianza. Como WPILib, una matriz de ceros devuelve ceros.
export function cholesky(m: Matrix): Matrix {
  if (m.rows !== m.cols) throw new MatrixError("Cholesky needs a square matrix")

  const n = m.rows
  if (flat(m).every(value => Math.abs(value) < 1e-6)) return filled(n, n, 0)

  const l = Array.from({ length: n }, () => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += l[i][k] * l[j][k]

      if (i === j) {
        const diagonalValue = m.data[i][i] - sum
        if (diagonalValue <= 0) {
          throw new MatrixError("Cholesky failed: the matrix is not positive definite")
        }
        l[i][j] = Math.sqrt(diagonalValue)
      } else {
        l[i][j] = (m.data[i][j] - sum) / l[j][j]
      }
    }
  }

  return makeMatrix(l)
}

// Exponencial matricial por escalado y cuadrado: exp(A) = exp(A/2^s)^(2^s).
// Se escala hasta que la norma sea chica, se usa la serie de Taylor —que ahí
// converge rápido— y se eleva al cuadrado s veces.
export function matrixExp(m: Matrix): Matrix {
  if (m.rows !== m.cols) throw new MatrixError("Matrix exponential needs a square matrix")

  const n = m.rows
  const magnitude = normP1(m)
  const squarings = magnitude > 0.5 ? Math.max(0, Math.ceil(Math.log2(magnitude / 0.5))) : 0
  const scaled = scale(m, 1 / Math.pow(2, squarings))

  let result = identity(n)
  let term = identity(n)
  for (let k = 1; k <= 24; k++) {
    term = scale(multiply(term, scaled), 1 / k)
    result = add(result, term)
    if (normP1(term) < 1e-18) break
  }

  for (let i = 0; i < squarings; i++) result = multiply(result, result)
  return result
}
