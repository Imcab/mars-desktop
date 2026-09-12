// Qué edición es esta compilación.
//
// No hay un flag suelto: se deduce del módulo `@mars`, que es el que realmente
// cambia entre ediciones (ver src/mars/README.md). Así no hay dos fuentes de
// verdad que puedan contradecirse — si el bundle no trae MARS, `MARS_ENABLED`
// es `false` y punto.

import { MARS_ENABLED } from "@mars"

export const MARS_EDITION: "full" | "tools" = MARS_ENABLED ? "full" : "tools"

/** Nombre del producto tal como se le muestra al usuario. */
export const MARS_PRODUCT_NAME = MARS_ENABLED ? "MARS Desktop" : "MARS Desktop Tools"
