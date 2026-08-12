import React, { useState } from "react"
import { DashboardWidget } from "../../../store/appStore"
import { TopicClassification } from "../../../utils/dashboard/topicClassification"
import SizeFields from "./SizeFields"
import StyleSelect from "./StyleSelect"
import RotationUnitField from "./RotationUnitField"
import NumberUnitField from "./NumberUnitField"
import BooleanCustomLabelsFields from "./BooleanCustomLabelsFields"
import RangeFields from "./RangeFields"
import MatchTimeFields from "./MatchTimeFields"
import GraphFields from "./GraphFields"
import GaugeFields from "./GaugeFields"
import VoltageFields from "./VoltageFields"
import UnsupportedStyleNote from "./UnsupportedStyleNote"

interface Props {
  widget: DashboardWidget
  classification: TopicClassification
  onSave: (updates: Partial<DashboardWidget>) => void
}

// Dueño de todo el estado de edición (borradores locales que solo se
// aplican al widget real cuando el usuario pulsa "Apply Changes").
export default function CardSettingsPanel({ widget, classification, onSave }: Props) {
  const { isBoolean, isNumber, isRotationSingle, hasStyleOptions } = classification

  const [editStyle, setEditStyle] = useState(widget.style)
  const [editMin, setEditMin] = useState(widget.min ?? 0)
  const [editMax, setEditMax] = useState(widget.max ?? 100)
  const [editTrue, setEditTrue] = useState(widget.customTrue ?? "True")
  const [editFalse, setEditFalse] = useState(widget.customFalse ?? "False")
  const [editWidth, setEditWidth] = useState(widget.width)
  const [editHeight, setEditHeight] = useState(widget.height)
  // En doubles es solo una etiqueta de sufijo (no convierte el valor).
  // En Rotation2d sí es una conversión real, porque sabemos que el struct
  // WPILib siempre serializa el ángulo en radianes.
  const [editUnit, setEditUnit] = useState(widget.unit ?? "")

  // --- Match Time ---
  const [editMatchTimeMode, setEditMatchTimeMode] = useState<"mmss" | "seconds">(widget.matchTimeMode ?? "mmss")
  const [editMatchTimeYellow, setEditMatchTimeYellow] = useState(widget.matchTimeYellow ?? 30)
  const [editMatchTimeRed, setEditMatchTimeRed] = useState(widget.matchTimeRed ?? 15)

  // --- Graph ---
  const [editGraphTime, setEditGraphTime] = useState(widget.graphTimeDisplayed ?? 5)
  const [editGraphColor, setEditGraphColor] = useState(widget.graphColor ?? "#6262f1")
  const [editGraphLineWidth, setEditGraphLineWidth] = useState(widget.graphLineWidth ?? 2)
  const [editGraphAutoRange, setEditGraphAutoRange] = useState(widget.graphAutoRange ?? true)
  const [editGraphMin, setEditGraphMin] = useState(widget.graphMin ?? 0)
  const [editGraphMax, setEditGraphMax] = useState(widget.graphMax ?? 100)

  // --- Radial Gauge ---
  const [editGaugeStartAngle, setEditGaugeStartAngle] = useState(widget.gaugeStartAngle ?? -140)
  const [editGaugeEndAngle, setEditGaugeEndAngle] = useState(widget.gaugeEndAngle ?? 140)
  const [editGaugeMin, setEditGaugeMin] = useState(widget.gaugeMin ?? 0)
  const [editGaugeMax, setEditGaugeMax] = useState(widget.gaugeMax ?? 100)
  const [editGaugeNumberOfLabels, setEditGaugeNumberOfLabels] = useState(widget.gaugeNumberOfLabels ?? 8)
  const [editGaugeWrapValue, setEditGaugeWrapValue] = useState(widget.gaugeWrapValue ?? false)
  const [editGaugeShowPointer, setEditGaugeShowPointer] = useState(widget.gaugeShowPointer ?? true)
  const [editGaugeShowTicks, setEditGaugeShowTicks] = useState(widget.gaugeShowTicks ?? true)

  // --- Voltage View ---
  const [editVoltageMin, setEditVoltageMin] = useState(widget.voltageMin ?? 4)
  const [editVoltageMax, setEditVoltageMax] = useState(widget.voltageMax ?? 13)
  const [editVoltageDivisions, setEditVoltageDivisions] = useState(widget.voltageDivisions ?? 5)
  const [editVoltageInverted, setEditVoltageInverted] = useState(widget.voltageInverted ?? false)
  const [editVoltageOrientation, setEditVoltageOrientation] = useState<"horizontal" | "vertical">(widget.voltageOrientation ?? "horizontal")

  const handleSave = () => {
    onSave({
      style: editStyle, min: editMin, max: editMax, customTrue: editTrue, customFalse: editFalse,
      width: editWidth, height: editHeight, unit: editUnit,
      matchTimeMode: editMatchTimeMode, matchTimeYellow: editMatchTimeYellow, matchTimeRed: editMatchTimeRed,
      graphTimeDisplayed: editGraphTime, graphColor: editGraphColor, graphLineWidth: editGraphLineWidth,
      graphAutoRange: editGraphAutoRange, graphMin: editGraphMin, graphMax: editGraphMax,
      gaugeStartAngle: editGaugeStartAngle, gaugeEndAngle: editGaugeEndAngle, gaugeMin: editGaugeMin, gaugeMax: editGaugeMax,
      gaugeNumberOfLabels: editGaugeNumberOfLabels, gaugeWrapValue: editGaugeWrapValue,
      gaugeShowPointer: editGaugeShowPointer, gaugeShowTicks: editGaugeShowTicks,
      voltageMin: editVoltageMin, voltageMax: editVoltageMax, voltageDivisions: editVoltageDivisions,
      voltageInverted: editVoltageInverted, voltageOrientation: editVoltageOrientation,
    })
  }

  return (
    <div style={{ flex: 1, padding: 12, background: "var(--bg-panel)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }} onMouseDown={e => e.stopPropagation()}>

      <SizeFields width={editWidth} height={editHeight} onChangeWidth={setEditWidth} onChangeHeight={setEditHeight} />

      {hasStyleOptions && (
        <StyleSelect isBoolean={isBoolean} isRotationSingle={isRotationSingle} value={editStyle} onChange={setEditStyle} />
      )}

      {isRotationSingle && <RotationUnitField value={editUnit} onChange={setEditUnit} />}

      {isNumber && <NumberUnitField value={editUnit} onChange={setEditUnit} />}

      {isBoolean && editStyle === "Custom" && (
        <BooleanCustomLabelsFields trueLabel={editTrue} falseLabel={editFalse} onChangeTrue={setEditTrue} onChangeFalse={setEditFalse} />
      )}

      {isNumber && (editStyle === "Bar" || editStyle === "Deviation") && (
        <RangeFields style={editStyle} min={editMin} max={editMax} onChangeMin={setEditMin} onChangeMax={setEditMax} />
      )}

      {isNumber && editStyle === "MatchTime" && (
        <MatchTimeFields
          mode={editMatchTimeMode} yellowAt={editMatchTimeYellow} redAt={editMatchTimeRed}
          onChangeMode={setEditMatchTimeMode} onChangeYellow={setEditMatchTimeYellow} onChangeRed={setEditMatchTimeRed}
        />
      )}

      {isNumber && editStyle === "Graph" && (
        <GraphFields
          timeDisplayed={editGraphTime} color={editGraphColor} lineWidth={editGraphLineWidth}
          autoRange={editGraphAutoRange} yMin={editGraphMin} yMax={editGraphMax}
          onChangeTimeDisplayed={setEditGraphTime} onChangeColor={setEditGraphColor} onChangeLineWidth={setEditGraphLineWidth}
          onChangeAutoRange={setEditGraphAutoRange} onChangeYMin={setEditGraphMin} onChangeYMax={setEditGraphMax}
        />
      )}

      {isNumber && editStyle === "Gauge" && (
        <GaugeFields
          startAngle={editGaugeStartAngle} endAngle={editGaugeEndAngle} min={editGaugeMin} max={editGaugeMax}
          numberOfLabels={editGaugeNumberOfLabels} wrapValue={editGaugeWrapValue} showPointer={editGaugeShowPointer} showTicks={editGaugeShowTicks}
          onChangeStartAngle={setEditGaugeStartAngle} onChangeEndAngle={setEditGaugeEndAngle}
          onChangeMin={setEditGaugeMin} onChangeMax={setEditGaugeMax} onChangeNumberOfLabels={setEditGaugeNumberOfLabels}
          onChangeWrapValue={setEditGaugeWrapValue} onChangeShowPointer={setEditGaugeShowPointer} onChangeShowTicks={setEditGaugeShowTicks}
        />
      )}

      {isNumber && editStyle === "Voltage" && (
        <VoltageFields
          orientation={editVoltageOrientation} min={editVoltageMin} max={editVoltageMax}
          divisions={editVoltageDivisions} inverted={editVoltageInverted}
          onChangeOrientation={setEditVoltageOrientation} onChangeMin={setEditVoltageMin} onChangeMax={setEditVoltageMax}
          onChangeDivisions={setEditVoltageDivisions} onChangeInverted={setEditVoltageInverted}
        />
      )}

      {!hasStyleOptions && <UnsupportedStyleNote classification={classification} />}

      <button
        onClick={handleSave}
        style={{ marginTop: "auto", background: "var(--border-light)", color: "var(--text-primary)", border: "1px solid var(--border-main)", padding: "6px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
      >
        Apply Changes
      </button>
    </div>
  )
}
