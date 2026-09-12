export interface TopicClassification {
  isArrayType: boolean
  baseType: string
  isStructType: boolean
  structName: string | null
  isBoolean: boolean
  isNumber: boolean
  isString: boolean
  isNumericArray: boolean
  isTextArray: boolean
  /** Tabla sendable de WPILib, no un topic (su valor no se lee con unpackLiveValue). */
  isField2d: boolean
  isStructSingle: boolean
  isStructArray: boolean
  isRotationSingle: boolean
  hasStyleOptions: boolean
}

const NUMERIC_BASE_TYPES = ["double", "float", "int"]

// Clasifica un topicType de NT4 en las categorías que la Dashboard sabe
// renderizar. Distinguimos structs sueltos de arreglos de structs, y
// arreglos numéricos planos de todo lo demás.
export function classifyTopic(topicType: string): TopicClassification {
  const isArrayType = topicType.endsWith("[]")
  const baseType = isArrayType ? topicType.slice(0, -2) : topicType
  const isStructType = baseType.startsWith("struct:")
  const structName = isStructType ? baseType.slice("struct:".length) : null

  const isField2d = topicType === "Field2d"
  const isBoolean = !isStructType && !isArrayType && topicType === "boolean"
  const isNumber = !isStructType && !isArrayType && (topicType === "double" || topicType === "int" || topicType === "float")
  const isString = !isStructType && !isArrayType && topicType.includes("string")
  // Antes CUALQUIER array no-struct contaba como numérico. Eso funcionaba
  // solo porque el backend descartaba boolean[]/string[]; ahora que llegan de
  // verdad, mandarlos al widget numérico reventaría en value.toFixed().
  const isNumericArray = !isStructType && isArrayType && NUMERIC_BASE_TYPES.includes(baseType)
  const isTextArray = !isStructType && isArrayType && !isNumericArray
  const isStructSingle = isStructType && !isArrayType
  const isStructArray = isStructType && isArrayType
  const isRotationSingle = isStructSingle && structName === "Rotation2d"

  // Boolean/number/Rotation2d tienen estilos visuales configurables (Bar, Compass, etc.)
  const hasStyleOptions = isBoolean || isNumber || isRotationSingle

  return {
    isArrayType, baseType, isStructType, structName,
    isBoolean, isNumber, isString, isNumericArray, isTextArray, isField2d,
    isStructSingle, isStructArray, isRotationSingle, hasStyleOptions,
  }
}
