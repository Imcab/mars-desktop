// Lee las fuentes de una pestaña de swerve y las convierte en los sets que
// dibujan tanto el canvas 2D como la escena 3D.
//
// Vive acá y no en cada página porque las dos vistas consumen EXACTAMENTE las
// mismas fuentes: lo único que cambia es cómo se dibujan.

import { useMemo } from "react"
import { SwerveSourceConfig } from "../store/appStore"
import { useNTSnapshot } from "../utils/nt/useNTSnapshot"
import {
  extractModuleStates, extractModulePositions, extractChassisVelocities, extractRotation,
  isSwerveTopic, defaultSourceTypeFor, ModulePosition,
} from "../utils/field/swerveExtraction"
import { ModuleSet, ChassisSet } from "../components/dashboard/swerve/SwerveCanvas"

export interface PositionSet {
  id: string
  label: string
  color: string
  values: ModulePosition[]
}

export interface SwerveSourceData {
  moduleSets: ModuleSet[]
  positionSets: PositionSet[]
  chassisSets: ChassisSet[]
  /** Heading del chasis en radianes; 0 si ninguna fuente lo publica. */
  rotation: number
}

// Reordena los módulos del topic a las esquinas dibujadas (FL, FR, BL, BR)
// según el "arrangement" elegido.
export function applyArrangement<T>(values: T[], arrangement: string): T[] {
  const order = arrangement.split(",").map(n => parseInt(n, 10))
  if (order.length !== 4 || order.some(isNaN)) return values
  return order.map(sourceIndex => values[sourceIndex]).filter((v): v is T => v !== undefined)
}

export function useSwerveSources(sources: SwerveSourceConfig[], intervalMs = 33): SwerveSourceData {
  const topicNames = useMemo(() => sources.map(s => s.topicName), [sources])
  const liveValues = useNTSnapshot(topicNames, intervalMs)

  return useMemo(() => {
    const moduleSets: ModuleSet[] = []
    const positionSets: PositionSet[] = []
    const chassisSets: ChassisSet[] = []
    let rotation = 0

    sources.forEach(source => {
      const value = liveValues[source.topicName]
      if (source.type === "modules") {
        const values = applyArrangement(extractModuleStates(value, source.topicType), source.arrangement)
        if (values.length > 0) {
          moduleSets.push({ id: source.id, label: source.label, color: source.color, values, role: source.role })
        }
      } else if (source.type === "positions") {
        const values = applyArrangement(extractModulePositions(value, source.topicType), source.arrangement)
        if (values.length > 0) {
          positionSets.push({ id: source.id, label: source.label, color: source.color, values })
        }
      } else if (source.type === "chassis") {
        const speeds = extractChassisVelocities(value, source.topicType)
        if (speeds) {
          chassisSets.push({ id: source.id, label: source.label, color: source.color, value: speeds })
        }
      } else {
        const theta = extractRotation(value, source.topicType, source.angleUnits)
        if (theta !== null) rotation = theta
      }
    })

    return { moduleSets, positionSets, chassisSets, rotation }
  }, [sources, liveValues])
}

const SOURCE_COLORS = ["#2f6fdb", "#d63b3b", "#1f9e4a", "#d4a94a", "#8a4fd1", "#0e9aa7"]

/**
 * Fuente que corresponde a un topic recién soltado sobre una vista de swerve,
 * o null si ese topic no sirve o ya estaba agregado.
 */
export function swerveSourceFromDrop(
  topicName: string,
  topicType: string,
  existing: SwerveSourceConfig[],
): Omit<SwerveSourceConfig, "id"> | null {
  if (!topicName || !isSwerveTopic(topicType)) return null
  if (existing.some(s => s.topicName === topicName)) return null

  const parts = topicName.split("/").filter(Boolean)
  const label = parts.length > 0 ? parts[parts.length - 1] : topicName
  const usedColors = new Set(existing.map(s => s.color))
  const color = SOURCE_COLORS.find(c => !usedColors.has(c))
    ?? SOURCE_COLORS[existing.length % SOURCE_COLORS.length]

  // El primer set de módulos se asume medido; el segundo, el comandado.
  const alreadyHasMeasured = existing.some(s => s.type === "modules" && s.role === "measured")

  return {
    topicName, topicType, label, color,
    type: defaultSourceTypeFor(topicType),
    arrangement: "0,1,2,3",
    angleUnits: "degrees",
    role: alreadyHasMeasured ? "setpoint" : "measured",
  }
}
