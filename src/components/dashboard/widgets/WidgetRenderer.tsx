import React from "react"
import { DashboardWidget } from "../../../store/appStore"
import { TopicClassification } from "../../../utils/dashboard/topicClassification"
import BooleanWidget from "./BooleanWidget"
import RotationWidget from "./RotationWidget"
import StructWidget from "./StructWidget"
import StructArrayWidget from "./StructArrayWidget"
import StructArraySingleWidget from "./StructArraySingleWidget"
import NumberArrayWidget from "./NumberArrayWidget"
import NumberWidget from "./NumberWidget"

interface Props {
  widget: DashboardWidget
  rawVal: any
  classification: TopicClassification
}

// Único lugar donde se decide "este tipo de topic -> este componente".
// Para agregar un tipo nuevo (ej. ChassisSpeeds): 1) STRUCT_DEFS en
// utils/dashboard/valueDecoding.ts si es un struct, 2) su componente en
// ./widgets, 3) un case aquí.
export default function WidgetRenderer({ widget, rawVal, classification }: Props) {
  const { isBoolean, isRotationSingle, isStructSingle, isStructArray, isNumericArray, isString, structName } = classification

  if (rawVal === null) {
    return <span style={{ fontSize: 14, color: "var(--text-muted)", fontFamily: "monospace" }}>--</span>
  }

  if (isBoolean) {
    return <BooleanWidget value={rawVal as boolean} style={widget.style} customTrue={widget.customTrue} customFalse={widget.customFalse} />
  }

  if (isRotationSingle) {
    return <RotationWidget rawVal={rawVal} style={widget.style} unit={widget.unit} />
  }

  if (isStructSingle) {
    return <StructWidget rawVal={rawVal} structName={structName!} />
  }

  if (isStructArray) {
    // Widget creado arrastrando UN índice puntual (ej. ModulePositions[2])
    // desde el Data Directory, en vez del array completo.
    if (widget.arrayIndex !== undefined) {
      return <StructArraySingleWidget rawVal={rawVal} structName={structName!} index={widget.arrayIndex} />
    }
    return <StructArrayWidget rawVal={rawVal} structName={structName!} />
  }

  if (isNumericArray) {
    return <NumberArrayWidget values={Array.isArray(rawVal) ? rawVal : []} />
  }

  if (isString) {
    return <span style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 600, textAlign: "center", wordBreak: "break-all" }}>{rawVal}</span>
  }

  return (
    <NumberWidget
      value={typeof rawVal === "number" ? rawVal : parseFloat(rawVal)}
      style={widget.style}
      min={widget.min ?? 0}
      max={widget.max ?? 100}
      unit={widget.unit}
      matchTimeMode={widget.matchTimeMode}
      matchTimeYellow={widget.matchTimeYellow}
      matchTimeRed={widget.matchTimeRed}
      graphTimeDisplayed={widget.graphTimeDisplayed}
      graphColor={widget.graphColor}
      graphLineWidth={widget.graphLineWidth}
      graphAutoRange={widget.graphAutoRange}
      graphMin={widget.graphMin}
      graphMax={widget.graphMax}
      gaugeStartAngle={widget.gaugeStartAngle}
      gaugeEndAngle={widget.gaugeEndAngle}
      gaugeMin={widget.gaugeMin}
      gaugeMax={widget.gaugeMax}
      gaugeNumberOfLabels={widget.gaugeNumberOfLabels}
      gaugeWrapValue={widget.gaugeWrapValue}
      gaugeShowPointer={widget.gaugeShowPointer}
      gaugeShowTicks={widget.gaugeShowTicks}
      voltageMin={widget.voltageMin}
      voltageMax={widget.voltageMax}
      voltageDivisions={widget.voltageDivisions}
      voltageInverted={widget.voltageInverted}
      voltageOrientation={widget.voltageOrientation}
    />
  )
}