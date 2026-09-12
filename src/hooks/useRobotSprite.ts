// Carga del modelo del equipo y su render cenital, para el 2D Visualizer.
//
// El bitmap NO se regenera al hacer zoom: se renderiza una sola vez a 512 px y
// el canvas lo estira. Un robot de 0.85 m ocupa ~60 px en la vista completa de
// la cancha, así que 512 px alcanzan de sobra incluso con el zoom al máximo, y
// re-renderizar el STL en cada rueda del mouse haría saltar la vista.

import { useEffect, useMemo, useState } from "react"
import { FieldSettings } from "../store/appStore"
import { RobotSprite, getRobotSprite, quantizeSpriteSize } from "../utils/field/robotSprite"

export type SpriteStatus = "empty" | "loading" | "ready" | "error"

const SPRITE_PX = quantizeSpriteSize(512)

export interface RobotSpriteState {
  sprite: RobotSprite | null
  /** Metros por unidad de archivo: lo que hay que multiplicar para dibujarlo. */
  scale: number
  status: SpriteStatus
  error: string | null
}

export function useRobotSprite(settings: FieldSettings): RobotSpriteState {
  const [sprite, setSprite] = useState<RobotSprite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { robotModelPath, robotModelColor, robotModelRotation } = settings

  useEffect(() => {
    if (robotModelPath === null) {
      setSprite(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    getRobotSprite({
      path: robotModelPath,
      sizePx: SPRITE_PX,
      color: robotModelColor,
      rotationDeg: robotModelRotation,
    })
      .then(next => {
        if (cancelled) return
        setSprite(next)
        setLoading(false)
      })
      .catch(reason => {
        if (cancelled) return
        setSprite(null)
        setError(String(reason?.message ?? reason))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [robotModelPath, robotModelColor, robotModelRotation])

  // El auto-fit iguala la HUELLA del modelo al largo del chasis, que es lo que
  // hace que un STL en milímetros o en pulgadas caiga bien sin que nadie tenga
  // que averiguar en qué unidades lo exportó su CAD.
  const scale = useMemo(() => {
    if (sprite === null) return 1
    if (!settings.robotModelAutoFit) return settings.robotModelScale
    return sprite.spanX > 0 ? settings.robotSizeMeters / sprite.spanX : 1
  }, [sprite, settings.robotModelAutoFit, settings.robotModelScale, settings.robotSizeMeters])

  const status: SpriteStatus =
    loading ? "loading"
      : error !== null ? "error"
        : sprite !== null ? "ready"
          : "empty"

  return { sprite, scale, status, error }
}
