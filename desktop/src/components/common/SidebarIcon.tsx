import { useEffect, useState } from "react"

interface Props {
  /** Archivo dentro de public/icons. Si falta, se prueba `svgFallback`. */
  svg?: string
  /** Segundo SVG a probar antes de caer al tabler: sirve para estrenar una
   *  herramienta con el ícono de su hermana hasta que tenga el propio. */
  svgFallback?: string
  /** Clase tabler de respaldo (ej. "ti-home"), para los que todavía no tienen SVG. */
  fallback: string
  size?: number
  /** Solo aplica al respaldo: los SVG vienen a color y no se tiñen. */
  color?: string
}

/**
 * Archivos que ya se pidieron y no existen.
 *
 * Vive en el MÓDULO y no en el componente a propósito. Sin esto, cada montaje
 * vuelve a pedir el archivo que falta, muestra un `<img>` roto por un frame y
 * recién entonces cae al respaldo. En una lista que se remonta seguido eso se
 * ve como un parpadeo constante, y además gasta un 404 por icono y por montaje.
 *
 * No se limpia nunca: los iconos son archivos estáticos del build, así que uno
 * que faltó al arrancar la app va a seguir faltando hasta que se recargue.
 */
const missing = new Set<string>()

// Los SVG de public/icons son a color y con gradientes propios, así que van
// como <img> y NO inlineados: cada gradiente define ids como "a"/"b"/"c" y al
// meter varios en el mismo documento se pisarían entre sí, dejando iconos con
// el degradé de otro.
export default function SidebarIcon({ svg, svgFallback, fallback, size = 16, color }: Props) {
  const chain = [svg, svgFallback].filter((s): s is string => typeof s === "string" && s.length > 0)

  // El primer archivo de la cadena que no se sepa ya que falta. Cuando todos
  // faltan queda fuera de rango y se dibuja el glifo tabler directamente, sin
  // pasar por el <img> roto.
  const firstUsable = () => {
    const index = chain.findIndex(name => !missing.has(name))
    return index === -1 ? chain.length : index
  }

  const [step, setStep] = useState(firstUsable)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setStep(firstUsable()), [svg, svgFallback])

  const current = chain[step]

  if (current) {
    return (
      <img
        key={current}
        src={`/icons/${current}`}
        width={size}
        height={size}
        alt=""
        aria-hidden
        draggable={false}
        // Si el archivo no está (se renombró, se borró), el navegador mostraría
        // el glifo de imagen rota. Se anota como faltante y se pasa al
        // siguiente de la cadena, así la fila sigue siendo reconocible.
        onError={() => {
          missing.add(current)
          setStep(s => s + 1)
        }}
        style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, display: "block" }}
      />
    )
  }

  return (
    <i
      className={`ti ${fallback}`}
      style={{
        fontSize: size - 2,
        color: color ?? "var(--icon-tree)",
        width: size,
        textAlign: "center",
        flexShrink: 0,
      }}
      aria-hidden
    />
  )
}
