const TIBETAN_CHAR_PATTERN = /[\u0F00-\u0FFF]/

export function getScriptType(char) {
  return TIBETAN_CHAR_PATTERN.test(char) ? 'tibetan' : 'nonTibetan'
}

export function splitScriptRuns(text = '') {
  if (!text) return []

  const runs = []
  let currentType = null
  let buffer = ''

  for (const char of text) {
    const scriptType = getScriptType(char)
    if (currentType === null) {
      currentType = scriptType
      buffer = char
      continue
    }

    if (scriptType === currentType) {
      buffer += char
      continue
    }

    runs.push({ type: currentType, text: buffer })
    currentType = scriptType
    buffer = char
  }

  if (buffer) {
    runs.push({ type: currentType, text: buffer })
  }

  return runs
}
