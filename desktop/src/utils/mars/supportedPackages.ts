// Registro de features verificadas.
//
// Antes esto vivía en el repo `Mars-marketplace` y se bajaba en tiempo de
// ejecución (`registry.json`). Ese repo ya no existe: la lista es ahora
// `supported-packages.json`, en la raíz de este repo, y viaja compilada dentro
// de la app -- por eso vite necesita `server.fs.allow` para verla en dev.
//
// Lo único que se baja de la red son los `MarsFeature.json` de cada feature,
// así que las versiones siguen siendo las de upstream; lo que queda fijo por
// release es QUÉ features aparecen en el catálogo. Para agregar una, se edita
// el JSON de la raíz y se publica una versión de MARS Desktop.
import registry from "../../../../supported-packages.json"

/** URLs de los `MarsFeature.json` verificados, en el orden del archivo. */
export const SUPPORTED_FEATURE_URLS: string[] = registry.verifiedFeatures.filter(
  url => url.trim() !== "",
)

/** Versión del formato del registro, por si algún día cambia el esquema. */
export const REGISTRY_VERSION: string = registry.registryVersion

/** Fecha (YYYY-MM-DD) de la última edición del archivo. */
export const REGISTRY_LAST_UPDATED: string = registry.lastUpdated
