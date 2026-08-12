// Paso de eje "redondo" (1-2-5 × 10^n) apuntando a ~targetTicks divisiones
// visibles, igual de espíritu al cálculo de step size de MATLAB/AdvantageScope.
export function niceStep(range: number, targetTicks: number): number {
  if (!isFinite(range) || range <= 0 || targetTicks <= 0) return 1
  const roughStep = range / targetTicks
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  const residual = roughStep / magnitude
  let niceResidual: number
  if (residual > 5) niceResidual = 10
  else if (residual > 2) niceResidual = 5
  else if (residual > 1) niceResidual = 2
  else niceResidual = 1
  return niceResidual * magnitude
}

// Wrapper pensado para usarse directo con el tamaño en píxeles del eje (igual
// que LineGraphRenderer usa Y_STEP_TARGET_PX / X_STEP_TARGET_PX en
// AdvantageScope): a partir del tamaño disponible en pantalla y un "target"
// de píxeles por tick, calcula cuántas divisiones caben y delega en niceStep.
// Esto es lo que hace que el eje se vea "vivo": al hacer zoom o cambiar la
// ventana de tiempo, targetTicks cambia y el step salta de 2 en 2, a 5 en 5,
// a 10 en 10, etc.
export function calcAxisStepSize(range: [number, number], axisSizePx: number, targetStepPx: number): number {
  const span = range[1] - range[0]
  const targetTicks = Math.max(2, axisSizePx / targetStepPx)
  return niceStep(span, targetTicks)
}