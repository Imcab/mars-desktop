import { useMemo } from "react"
import {
  DashboardWidget, FieldObjectConfig, FieldSettings, TopicAnnounce, defaultFieldSettings,
} from "../../../store/appStore"
import { useNTSnapshot } from "../../../utils/nt/useNTSnapshot"
import { extractField2dObjects, field2dTopicNames } from "../../../utils/field/field2d"
import { CoordinateSystem, getField, SCHEMATIC_FIELD_KEY, FIELDS } from "../../../utils/field/fieldImages"
import { resolveObjectOptions } from "../../../utils/field/fieldObjects"
import FieldCanvas, { RenderedObject } from "../field/FieldCanvas"
import UnsupportedValue from "../../common/UnsupportedValue"

interface Props {
  widget: DashboardWidget
  topics: Map<string, TopicAnnounce>
}

const ROBOT_COLOR = "#d63b3b"
const TRAJECTORY_COLOR = "#f2f2f4"
const OBJECT_COLOR = "#2f6fdb"

// A diferencia del resto de widgets, este NO recibe un valor: un Field2d es
// una tabla, así que se suscribe por su cuenta a todos los topics que cuelgan
// del prefijo. Por eso `widget.topicName` acá es una ruta de tabla.
export default function Field2dWidget({ widget, topics }: Props) {
  const prefix = widget.topicName

  const topicNames = useMemo(() => field2dTopicNames(topics, prefix), [topics, prefix])
  const values = useNTSnapshot(topicNames, 33)

  const fieldKey = widget.fieldKey ?? FIELDS[0]?.key ?? SCHEMATIC_FIELD_KEY
  const field = getField(fieldKey)
  const coordinateSystem: CoordinateSystem =
    (widget.fieldCoordinateSystem as CoordinateSystem | undefined) ??
    field?.coordinateSystem ??
    "wall_blue"

  // La tarjeta no tiene panel de objetos, así que hereda los defaults y solo
  // deja tocar lo que entra en el panel de ajustes del widget.
  const settings: FieldSettings = useMemo(() => {
    const length = widget.fieldRobotSize ?? defaultFieldSettings.robotSizeMeters
    const trail = widget.fieldTrailSeconds ?? 0
    return {
      ...defaultFieldSettings,
      orientation: widget.fieldOrientation ?? 0,
      robotSizeMeters: length,
      robotWidthMeters: widget.fieldRobotWidth ?? length,
      showGrid: widget.fieldShowGrid ?? false,
      fieldKey,
      coordinateSystem,
      allianceFlip: widget.fieldAllianceFlip ?? false,
      showTrails: trail > 0,
      trailSeconds: trail,
      // Etiquetas y lectura del cursor son ruido en una tarjeta de 200 px.
      showLabels: false,
      showCursor: false,
    }
  }, [
    widget.fieldOrientation, widget.fieldRobotSize, widget.fieldRobotWidth,
    widget.fieldShowGrid, widget.fieldAllianceFlip, widget.fieldTrailSeconds,
    fieldKey, coordinateSystem,
  ])

  const objects: RenderedObject[] = useMemo(
    () =>
      extractField2dObjects(values, topics, prefix).map(obj => {
        const type = obj.isRobot ? ("robot" as const)
          : obj.isTrajectory ? ("trajectory" as const)
            : ("ghost" as const)
        const config: FieldObjectConfig = {
          id: obj.key,
          topicName: obj.key,
          topicType: "",
          label: obj.name,
          type,
          color: obj.isRobot ? ROBOT_COLOR : obj.isTrajectory ? TRAJECTORY_COLOR : OBJECT_COLOR,
        }
        return {
          id: config.id,
          type,
          color: config.color,
          label: config.label,
          poses: obj.poses,
          options: resolveObjectOptions(config, settings),
        }
      }),
    [values, topics, prefix, settings],
  )

  if (topicNames.length === 0) {
    return <UnsupportedValue message={`No pose topics under ${prefix}`} />
  }

  return (
    <FieldCanvas
      objects={objects}
      settings={settings}
      field={field}
      coordinateSystem={coordinateSystem}
      interactive={false}
    />
  )
}
