// Carga de los assets que necesita la pestaña Field 3D: el catálogo instalado,
// el modelo de la cancha elegida, sus piezas de juego, y los modelos de robot
// que usen los objetos de la lista.
//
// Todo va por la caché de `assetModels`: un modelo de cancha pesa ~18 MB y
// parsearlo tarda casi un segundo, así que cambiar de pestaña, volver, o abrir
// una segunda Field 3D tiene que reusar lo ya parseado.
//
// Las cargas se lanzan en paralelo y cada una actualiza su parte del estado
// por separado: la cancha aparece en cuanto está lista sin esperar a que
// terminen los robots, que es lo que hace que la pestaña se sienta rápida
// aunque el trabajo total sea el mismo.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Field3dObjectConfig, Field3dSettings, EVERGREEN_FIELD_KEY } from "../store/appStore"
import {
  AssetPack, FieldPack, RobotPack, isFieldPack, isRobotPack, listAssetPacks, modelSource,
} from "../utils/field3d/assetStore"
import { LoadedAsset, OPTIMIZE_PRESETS, loadAssetModel } from "../utils/field3d/assetModels"
import { GamePieceEntry, RobotAssetEntry } from "../components/dashboard/field3d/objectVisuals"

export type AssetStatus = "idle" | "loading" | "ready" | "error"

export interface Field3dAssets {
  /** Todo lo instalado, canchas y robots. */
  packs: AssetPack[]
  fieldPacks: FieldPack[]
  robotPacks: RobotPack[]
  /** Paquete de la cancha elegida, o null si es la esquemática. */
  fieldPack: FieldPack | null
  fieldModel: LoadedAsset | null
  gamePieces: GamePieceEntry[]
  robotAssets: Map<string, RobotAssetEntry>
  status: AssetStatus
  error: string | null
  /** Vuelve a leer el almacén; la llama el panel después de instalar o borrar. */
  refresh: () => void
}

export function useField3dAssets(
  settings: Field3dSettings,
  objects: Field3dObjectConfig[],
): Field3dAssets {
  const [packs, setPacks] = useState<AssetPack[]>([])
  const [fieldModel, setFieldModel] = useState<LoadedAsset | null>(null)
  const [gamePieces, setGamePieces] = useState<GamePieceEntry[]>([])
  const [robotAssets, setRobotAssets] = useState<Map<string, RobotAssetEntry>>(new Map())
  const [status, setStatus] = useState<AssetStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken(token => token + 1), [])

  // El modo de calidad cambia CÓMO se optimiza el modelo (cuánto detalle se
  // descarta y con qué brillo se dibuja), no solo cómo se ilumina. Por eso
  // cambiarlo obliga a volver a optimizar; la caché guarda cada modo por
  // separado, así que ir y volver entre dos es instantáneo la segunda vez.
  const optimize = OPTIMIZE_PRESETS[settings.quality]

  // --- Catálogo ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    listAssetPacks()
      .then(list => { if (!cancelled) setPacks(list) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [reloadToken])

  const fieldPacks = useMemo(() => packs.filter(isFieldPack), [packs])
  const robotPacks = useMemo(() => packs.filter(isRobotPack), [packs])

  const fieldPack = useMemo(
    () => (settings.fieldKey === EVERGREEN_FIELD_KEY
      ? null
      : fieldPacks.find(p => p.key === settings.fieldKey) ?? null),
    [fieldPacks, settings.fieldKey],
  )

  // --- Cancha y sus piezas de juego -------------------------------------------
  useEffect(() => {
    if (fieldPack === null) {
      setFieldModel(null)
      setGamePieces([])
      setStatus("idle")
      setError(null)
      return
    }

    let cancelled = false
    setStatus("loading")
    setError(null)

    // Los nodos de las piezas ya colocadas se piden SIN fusionar: la escena
    // tiene que poder apagarlos uno por uno cuando el robot publique ese tipo
    // de pieza, y una malla fusionada no se puede partir después.
    const staged = fieldPack.config.gamePieces.flatMap(piece => piece.stagedObjects)
    const source = modelSource(fieldPack, 0)
    if (source === null) {
      setStatus("error")
      setError("The field asset has no model.glb.")
      return
    }

    loadAssetModel(source, staged, optimize)
      .then(model => {
        if (cancelled) return
        setFieldModel(model)
        setStatus("ready")
      })
      .catch(err => {
        if (cancelled) return
        setFieldModel(null)
        setStatus("error")
        setError(String(err?.message ?? err))
      })

    // Las piezas de juego son model_0.glb en adelante; la 0 del config es la
    // primera después de model.glb. Se cargan sueltas y sin bloquear a la
    // cancha: una pieza que falte deja su objeto con la esfera de reemplazo,
    // no la cancha entera sin dibujar.
    Promise.all(fieldPack.config.gamePieces.map(async (piece, index): Promise<GamePieceEntry> => {
      const pieceSource = modelSource(fieldPack, index + 1)
      if (pieceSource === null) return { config: piece, asset: null }
      try {
        return { config: piece, asset: await loadAssetModel(pieceSource, [], optimize) }
      } catch {
        return { config: piece, asset: null }
      }
    })).then(entries => { if (!cancelled) setGamePieces(entries) })

    return () => { cancelled = true }
  }, [fieldPack, optimize])

  // --- Robots ------------------------------------------------------------------

  // Solo se cargan los que alguien usa: el default de la pestaña más los que
  // fijen los objetos. Cargar todo el catálogo por si acaso serían decenas de
  // MB para nada.
  const neededRobots = useMemo(() => {
    const keys = new Set<string>()
    if (settings.robotAssetKey) keys.add(settings.robotAssetKey)
    objects.forEach(object => {
      if (object.robotAssetKey) keys.add(object.robotAssetKey)
    })
    return Array.from(keys).sort()
  }, [settings.robotAssetKey, objects])

  const neededSignature = neededRobots.join("|")

  useEffect(() => {
    let cancelled = false

    Promise.all(neededRobots.map(async (key): Promise<[string, RobotAssetEntry] | null> => {
      const pack = robotPacks.find(p => p.key === key)
      if (!pack) return null
      const baseSource = modelSource(pack, 0)
      if (baseSource === null) return null

      try {
        const base = await loadAssetModel(baseSource, [], optimize)
        // Un componente por cada `model_N.glb`, en el mismo orden en que el
        // config los declara: es el índice de la pose publicada.
        const components = await Promise.all(
          pack.config.components.map(async (_, index) => {
            const source = modelSource(pack, index + 1)
            return source === null ? null : loadAssetModel(source, [], optimize).catch(() => null)
          }),
        )
        return [key, {
          config: pack.config,
          base,
          components: components.filter((c): c is LoadedAsset => c !== null),
        }]
      } catch {
        // Un robot que no carga no debe tumbar la pestaña: su objeto cae al
        // chasis genérico, que es exactamente lo que se ve sin asset.
        return null
      }
    })).then(entries => {
      if (cancelled) return
      setRobotAssets(new Map(entries.filter((e): e is [string, RobotAssetEntry] => e !== null)))
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededSignature, robotPacks, optimize])

  return {
    packs, fieldPacks, robotPacks,
    fieldPack, fieldModel, gamePieces, robotAssets,
    status, error, refresh,
  }
}
