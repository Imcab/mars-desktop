export interface TopicClassification {
  isArrayType: boolean
  baseType: string
  isStructType: boolean
  structName: string | null
  isBoolean: boolean
  isNumber: boolean
  isString: boolean
  isNumericArray: boolean
  isStructSingle: boolean
  isStructArray: boolean
  isRotationSingle: boolean
  hasStyleOptions: boolean
}

// Clasifica un topicType de NT4 en las categorías que la Dashboard sabe
// renderizar. Distinguimos structs sueltos de arreglos de structs, y
// arreglos numéricos planos de todo lo demás.
export function classifyTopic(topicType: string): TopicClassification {
  const isArrayType = topicType.endsWith("[]")
  const baseType = isArrayType ? topicType.slice(0, -2) : topicType
  const isStructType = baseType.startsWith("struct:")
  const structName = isStructType ? baseType.slice("struct:".length) : null

  const isBoolean = !isStructType && !isArrayType && topicType === "boolean"
  const isNumber = !isStructType && !isArrayType && (topicType === "double" || topicType === "int" || topicType === "float")
  const isString = !isStructType && !isArrayType && topicType.includes("string")
  const isNumericArray = !isStructType && isArrayType
  const isStructSingle = isStructType && !isArrayType
  const isStructArray = isStructType && isArrayType
  const isRotationSingle = isStructSingle && structName === "Rotation2d"

  // Boolean/number/Rotation2d tienen estilos visuales configurables (Bar, Compass, etc.)
  const hasStyleOptions = isBoolean || isNumber || isRotationSingle

  return {
    isArrayType, baseType, isStructType, structName,
    isBoolean, isNumber, isString, isNumericArray,
    isStructSingle, isStructArray, isRotationSingle, hasStyleOptions,
  }
}
