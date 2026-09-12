// Controles densos para los paneles de configuración 3D (Swerve 3D,
// Mechanism 3D). Son los mismos widgets que ya usaba el panel del swerve,
// puestos en común para que las dos vistas se vean y se comporten igual.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import SidebarIcon from "../../common/SidebarIcon"

export const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-main)",
  padding: "3px 6px",
  borderRadius: 2,
  fontSize: 10.5,
  outline: "none",
  boxSizing: "border-box",
}

export const buttonStyle: React.CSSProperties = {
  flex: 1,
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-main)",
  padding: "4px 8px",
  borderRadius: 2,
  fontSize: 10.5,
  cursor: "pointer",
}

export const fieldLabelStyle: React.CSSProperties = {
  fontSize: 9,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 2,
}

const HELP_WIDTH = 268
const HELP_MARGIN = 8

/**
 * Boton "?" con la explicacion real de un control.
 *
 * El globo se dibuja con un PORTAL a <body> y position: fixed, no dentro del
 * panel: el panel tiene overflow para su scroll, y cualquier cosa posicionada
 * adentro se recorta contra su borde. Con el portal, el globo se mide contra la
 * VENTANA y se acomoda solo — se corre para no salirse por los costados y se
 * pasa arriba del boton si abajo no entra.
 */
export function Help({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState({ top: 0, left: 0 })

  // useLayoutEffect y no useEffect: el globo ya esta en el DOM (hace falta para
  // poder medirlo) pero todavia no se pinto, asi que corregir la posicion aca
  // no produce un salto visible.
  useLayoutEffect(() => {
    if (!open) return

    const place = () => {
      const button = buttonRef.current
      if (!button) return
      const anchor = button.getBoundingClientRect()
      const height = bubbleRef.current?.offsetHeight ?? 120

      // Alineado al borde derecho del boton, pero sin salirse de la ventana.
      const left = Math.min(
        Math.max(anchor.right - HELP_WIDTH, HELP_MARGIN),
        window.innerWidth - HELP_WIDTH - HELP_MARGIN,
      )
      const below = anchor.bottom + 6
      const fitsBelow = below + height <= window.innerHeight - HELP_MARGIN
      const top = fitsBelow ? below : Math.max(HELP_MARGIN, anchor.top - height - 6)

      setPlacement({ top, left })
    }

    place()
    // `true` para capturar tambien el scroll del panel, que no burbujea.
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, text])

  // Cerrar con un click afuera o con Escape, como cualquier popover.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (bubbleRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="What does this do?"
        aria-expanded={open}
        // Varios de estos botones viven dentro de un <label>: sin frenar el
        // evento, abrir la ayuda tambien enfocaria el input o marcaria el
        // checkbox que la etiqueta envuelve.
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        style={{
          border: "none", background: "transparent", cursor: "pointer",
          padding: 0, lineHeight: 0, display: "flex", alignItems: "center",
          flexShrink: 0, opacity: open ? 1 : 0.55,
        }}
      >
        <SidebarIcon svg="help.svg" fallback="ti-help-circle" size={12} color="var(--mars-accent)" />
      </button>

      {open && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          style={{
            position: "fixed", top: placement.top, left: placement.left, zIndex: 4000,
            width: HELP_WIDTH, boxSizing: "border-box",
            background: "var(--bg-input)", color: "var(--text-primary)",
            border: "1px solid var(--border-dark)", borderRadius: 4,
            boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
            padding: "9px 11px", fontSize: 11, lineHeight: 1.55,
            textTransform: "none", letterSpacing: 0, fontWeight: 400,
            whiteSpace: "normal", textAlign: "left",
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Etiqueta de un campo, con su boton de ayuda si lo tiene. */
export function FieldLabel({ label, help }: { label: React.ReactNode; help?: React.ReactNode }) {
  return (
    <div style={{ ...fieldLabelStyle, display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {help !== undefined && <Help text={help} />}
    </div>
  )
}

export function Section({
  title, children, defaultOpen = false, badge, help, svg, svgFallback, icon,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
  help?: React.ReactNode
  /** Archivo en public/icons; si falta se prueba `svgFallback` y luego `icon`. */
  svg?: string
  /** SVG hermano con el que estrenar la sección hasta que tenga el propio. */
  svgFallback?: string
  icon?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderBottom: "1px solid var(--border-light)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg-panel-header)", border: "none", cursor: "pointer",
          padding: "6px 12px", textAlign: "left",
        }}
      >
        <i
          className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`}
          style={{ fontSize: 11, color: "var(--text-muted)" }}
          aria-hidden
        />
        {(svg || svgFallback || icon) && (
          <SidebarIcon svg={svg} svgFallback={svgFallback} fallback={icon ?? "ti-square"} size={13} />
        )}
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)" }}>
          {title}
        </span>
        {help !== undefined && (
          // El span frena el click para que abrir la ayuda no pliegue la seccion.
          <span onClick={e => e.stopPropagation()} style={{ display: "flex" }}><Help text={help} /></span>
        )}
        {badge !== undefined && <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--text-muted)" }}>{badge}</span>}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px" }}>
          {children}
        </div>
      )}
    </div>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 5 }}>{children}</div>
}

export function Num({
  label, value, onChange, step = 0.01, min, max, suffix, hint, help,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  hint?: string
  help?: React.ReactNode
}) {
  return (
    <label style={{ flex: 1, minWidth: 0 }} title={hint}>
      <FieldLabel label={suffix ? `${label} (${suffix})` : label} help={help} />
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        // Un campo vacío o a medio escribir ("-", "0.") da NaN: se ignora el
        // cambio en vez de mandar NaN a la escena, que dejaría la malla en una
        // matriz inválida y toda la pieza invisible.
        onChange={e => {
          const next = Number(e.target.value)
          if (isFinite(next)) onChange(next)
        }}
        style={{ ...inputStyle, width: "100%" }}
      />
    </label>
  )
}

export function Text({
  label, value, onChange, placeholder, help,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  help?: React.ReactNode
}) {
  return (
    <label style={{ flex: 1, minWidth: 0 }}>
      <FieldLabel label={label} help={help} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, width: "100%" }}
      />
    </label>
  )
}

export function Check({
  label, checked, onChange, hint, help,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
  help?: React.ReactNode
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, position: "relative" }}>
      <label
        title={hint}
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--text-primary)", cursor: "pointer", minWidth: 0 }}
      >
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        {label}
      </label>
      {help !== undefined && <Help text={help} />}
    </div>
  )
}

export function Select<T extends string>({
  label, value, options, onChange, hint, help,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
  help?: React.ReactNode
}) {
  return (
    <label style={{ flex: 1, minWidth: 0 }} title={hint}>
      <FieldLabel label={label} help={help} />
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        style={{ ...inputStyle, width: "100%" }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Slider({
  label, value, min, max, step, onChange, format, help,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  help?: React.ReactNode
}) {
  return (
    <div>
      <div style={{ ...fieldLabelStyle, display: "flex", alignItems: "center", gap: 4 }}>
        <span>{label}</span>
        {help !== undefined && <Help text={help} />}
        <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  )
}

/** Terna X/Y/Z con una etiqueta común; es el control que más se repite. */
export function Vector3Field({
  label, value, onChange, step = 0.01, suffix, help, axisLabels = ["X", "Y", "Z"],
}: {
  label: string
  value: [number, number, number]
  onChange: (v: [number, number, number]) => void
  step?: number
  suffix?: string
  help?: React.ReactNode
  /** Para cuando las tres casillas no son X/Y/Z (radio, alto...). */
  axisLabels?: [string, string, string]
}) {
  return (
    <div>
      <FieldLabel label={suffix ? `${label} (${suffix})` : label} help={help} />
      <Row>
        {axisLabels.map((axis, i) => (
          <label key={`${axis}-${i}`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{axis}</span>
            <input
              type="number"
              value={value[i]}
              step={step}
              onChange={e => {
                const next = Number(e.target.value)
                if (!isFinite(next)) return
                const out: [number, number, number] = [...value]
                out[i] = next
                onChange(out)
              }}
              style={{ ...inputStyle, width: "100%" }}
            />
          </label>
        ))}
      </Row>
    </div>
  )
}

export function PanelButton({
  label, onClick, disabled, icon, svg, svgFallback, title, danger, active,
}: {
  label?: string
  onClick: () => void
  disabled?: boolean
  /** Clase tabler de respaldo. */
  icon?: string
  /** Archivo en public/icons; gana sobre `icon` si existe. */
  svg?: string
  /** SVG hermano a probar antes de caer al tabler. */
  svgFallback?: string
  title?: string
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...buttonStyle,
        flex: label ? 1 : "0 0 auto",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        color: danger ? "var(--status-error)" : "var(--text-primary)",
        background: active ? "var(--toolbar-active-bg)" : buttonStyle.background,
        borderColor: active ? "var(--mars-accent)" : "var(--border-main)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}
    >
      {svg || svgFallback
        ? <SidebarIcon svg={svg} svgFallback={svgFallback} fallback={icon ?? "ti-square"} size={13} />
        : icon && <i className={`ti ${icon}`} aria-hidden />}
      {label}
    </button>
  )
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{children}</div>
  )
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, lineHeight: 1.4, color: "var(--status-error)",
      background: "var(--status-error-bg)", border: "1px solid var(--status-error-border)",
      borderRadius: 2, padding: "5px 6px", wordBreak: "break-word",
    }}>
      {children}
    </div>
  )
}

/** Icono chico para las filas y botones de los paneles densos. */
export function PanelIcon({
  svg, svgFallback, fallback, size = 13, color,
}: { svg?: string; svgFallback?: string; fallback: string; size?: number; color?: string }) {
  return <SidebarIcon svg={svg} svgFallback={svgFallback} fallback={fallback} size={size} color={color} />
}

/**
 * Botón de un solo icono para las filas de una lista (ojo, candado, borrar).
 *
 * Vive acá y no en el panel del Mechanism 3D porque el 2D Visualizer tiene la
 * misma clase de lista: una fila por objeto con sus interruptores al final.
 */
export function IconToggle({
  svg, svgFallback, icon, active, title, onClick, activeColor = "var(--mars-red)",
}: {
  svg?: string
  svgFallback?: string
  icon: string
  active: boolean
  title: string
  onClick: () => void
  activeColor?: string
}) {
  return (
    <button
      title={title}
      // stopPropagation porque estas filas suelen ser clickeables enteras para
      // seleccionar: sin esto, tocar el ojo también cambiaría la selección.
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        border: "none", background: "transparent", cursor: "pointer", padding: 0, lineHeight: 1,
        display: "flex", alignItems: "center", flexShrink: 0,
      }}
    >
      <PanelIcon
        svg={svg}
        svgFallback={svgFallback}
        fallback={icon}
        size={13}
        color={active ? activeColor : "var(--text-muted)"}
      />
    </button>
  )
}
