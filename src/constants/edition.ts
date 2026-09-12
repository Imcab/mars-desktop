// Which edition this build is.
//
// There is no loose flag: it is derived from the `@mars` module, which is what
// actually changes between editions (see src/mars/README.md). That way there
// are not two sources of truth that could contradict each other — if the bundle
// has no MARS in it, `MARS_ENABLED` is `false` and that is that.

import { MARS_ENABLED } from "@mars"

export const MARS_EDITION: "full" | "tools" = MARS_ENABLED ? "full" : "tools"

/** The product name as shown to the user. */
export const MARS_PRODUCT_NAME = MARS_ENABLED ? "MARS Desktop" : "MARS Desktop Tools"
