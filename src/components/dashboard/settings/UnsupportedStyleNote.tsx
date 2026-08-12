import React from "react"
import { TopicClassification } from "../../../utils/dashboard/topicClassification"

export default function UnsupportedStyleNote({ classification }: { classification: TopicClassification }) {
  const { isStructSingle, isStructArray, isNumericArray, isString, structName } = classification
  return (
    <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
      {isStructSingle && `Decoded automatically as struct:${structName}.`}
      {isStructArray && `Decoded automatically as an array of struct:${structName}.`}
      {isNumericArray && `Rendered as a raw numeric array.`}
      {isString && `Raw string value, no visual style options.`}
    </div>
  )
}
