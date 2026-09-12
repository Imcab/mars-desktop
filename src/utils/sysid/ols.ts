// Mínimos cuadrados ordinarios: resuelve β en X·β ≈ y.
//
// Se usa la ecuación normal (XᵀX)β = Xᵀy con eliminación gaussiana y pivoteo
// parcial. Para 3 o 4 columnas —que es todo lo que necesita un ajuste de
// feedforward— es más que suficiente y no arrastra una librería de álgebra.

export interface OlsResult {
  /** Coeficientes, en el mismo orden que las columnas de X. */
  coefficients: number[]
  /** Coeficiente de determinación: 1 = ajuste perfecto, 0 = no explica nada. */
  rSquared: number
  /** Error cuadrático medio, en las unidades de y (voltios). */
  rmse: number
  /** Muestras usadas. */
  count: number
  /**
   * Salud numérica del sistema: menor pivote sobre mayor pivote, de 0 a 1.
   * Cerca de 0 significa que dos columnas son casi la misma cosa y los
   * coeficientes, aunque el R² se vea bien, son basura. El caso típico es
   * correr solo los tests cuasi-estáticos: ahí la aceleración es casi
   * proporcional a sgn(v) y kS/kA se vuelven indistinguibles.
   */
  conditioning: number
}

/**
 * @param x Matriz de diseño: una fila por muestra, una columna por término.
 * @param y Vector objetivo, del mismo largo que `x`.
 * @returns null si el sistema no se puede resolver (pocas muestras, columnas
 *          linealmente dependientes). Eso pasa de verdad: si un test no movió
 *          el mecanismo, la columna de aceleración es toda cero.
 */
export function solveOls(x: number[][], y: number[]): OlsResult | null {
  const n = x.length
  if (n === 0 || y.length !== n) return null
  const cols = x[0].length
  if (cols === 0 || n < cols) return null

  // XᵀX (simétrica) y Xᵀy
  const xtx: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0))
  const xty: number[] = new Array(cols).fill(0)

  for (let row = 0; row < n; row++) {
    const r = x[row]
    if (r.length !== cols) return null
    for (let i = 0; i < cols; i++) {
      if (!isFinite(r[i])) return null
      for (let j = i; j < cols; j++) xtx[i][j] += r[i] * r[j]
      xty[i] += r[i] * y[row]
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < i; j++) xtx[i][j] = xtx[j][i]
  }

  const solved = solveWithPivots(xtx, xty)
  if (solved === null) return null
  const { solution: coefficients, conditioning } = solved

  // R² y RMSE sobre las predicciones.
  const meanY = y.reduce((a, b) => a + b, 0) / n
  let ssRes = 0
  let ssTot = 0
  for (let row = 0; row < n; row++) {
    let pred = 0
    for (let i = 0; i < cols; i++) pred += x[row][i] * coefficients[i]
    ssRes += (y[row] - pred) ** 2
    ssTot += (y[row] - meanY) ** 2
  }

  return {
    coefficients,
    // Con y constante ssTot es 0: no hay varianza que explicar. Se reporta 1
    // si además el residuo es nulo, y 0 si no, en vez de dividir por cero.
    rSquared: ssTot > 1e-12 ? 1 - ssRes / ssTot : (ssRes < 1e-12 ? 1 : 0),
    rmse: Math.sqrt(ssRes / n),
    count: n,
    conditioning,
  }
}

/** Debajo de esto el ajuste no es confiable aunque el R² se vea alto. */
export const POOR_CONDITIONING = 1e-6

/** Eliminación gaussiana con pivoteo parcial. Devuelve null si es singular. */
export function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  return solveWithPivots(a, b)?.solution ?? null
}

// Igual que solveLinearSystem pero además reporta qué tan mal condicionado
// quedó el sistema, mirando cómo se derrumbaron los pivotes.
function solveWithPivots(
  a: number[][],
  b: number[],
): { solution: number[]; conditioning: number } | null {
  const n = b.length
  // Copia aumentada [A | b] para no mutar la entrada.
  const m = a.map((row, i) => [...row, b[i]])
  let maxPivot = 0
  let minPivot = Infinity

  for (let col = 0; col < n; col++) {
    // Pivoteo parcial: sin esto, un pivote chiquito amplifica el error de
    // redondeo hasta volver inútil el resultado.
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    const magnitude = Math.abs(m[pivot][col])
    if (magnitude < 1e-12) return null
    if (magnitude > maxPivot) maxPivot = magnitude
    if (magnitude < minPivot) minPivot = magnitude
    if (pivot !== col) { const t = m[pivot]; m[pivot] = m[col]; m[col] = t }

    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / m[col][col]
      if (factor === 0) continue
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c]
    }
  }

  const out = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n]
    for (let c = row + 1; c < n; c++) sum -= m[row][c] * out[c]
    out[row] = sum / m[row][row]
  }
  if (!out.every(isFinite)) return null
  return { solution: out, conditioning: maxPivot > 0 ? minPivot / maxPivot : 0 }
}
