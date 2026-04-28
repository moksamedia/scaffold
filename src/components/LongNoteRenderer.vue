<script>
import { defineComponent, h } from 'vue'
import AudioPlayer from './AudioPlayer.vue'
import { splitScriptRuns } from 'src/utils/text/script-runs'

const SKIPPED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed'])

const TAG_REMAP = {
  b: 'strong',
  i: 'em',
}

const ATTRIBUTE_RENAMES = {
  class: 'class',
  for: 'for',
}

function normalizeAttrName(name) {
  if (ATTRIBUTE_RENAMES[name]) return ATTRIBUTE_RENAMES[name]
  return name
}

function isSafeAttribute(name, value) {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return false
  if ((lower === 'href' || lower === 'src') && /^\s*javascript:/i.test(value)) {
    return false
  }
  return true
}

function buildAttrs(node) {
  const attrs = {}
  for (const attr of node.attributes) {
    if (!isSafeAttribute(attr.name, attr.value || '')) continue
    attrs[normalizeAttrName(attr.name)] = attr.value
  }
  return attrs
}

function renderTextNode(text, getRunStyle) {
  if (!text) return null
  const runs = splitScriptRuns(text)
  if (runs.length === 0) return text
  return runs.map((run, idx) =>
    h(
      'span',
      {
        key: `run-${idx}-${run.type}`,
        style: getRunStyle ? getRunStyle(run.type) : undefined,
      },
      run.text,
    ),
  )
}

function renderNode(node, ctx, keyPath = '0') {
  if (!node) return null

  if (node.nodeType === Node.TEXT_NODE) {
    return renderTextNode(node.textContent, ctx.getRunStyle)
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const tag = node.tagName.toLowerCase()
  const isEditorOnlyAudioControl =
    node.getAttribute('data-remove-audio') === 'true' || node.classList?.contains('remove-embedded-audio-btn')

  if (SKIPPED_TAGS.has(tag)) return null
  if (isEditorOnlyAudioControl) return null

  if (tag === 'audio') {
    const src = node.getAttribute('src') || ''
    if (!src) return null
    return h(AudioPlayer, { key: `audio-${keyPath}-${src.slice(0, 32)}`, src })
  }

  const outTag = TAG_REMAP[tag] || tag
  const attrs = buildAttrs(node)

  if (tag === 'u') {
    const existingStyle = attrs.style ? `${attrs.style}; ` : ''
    attrs.style = `${existingStyle}text-decoration: underline`
  }

  const childNodes = Array.from(node.childNodes)
  const renderedChildren = []
  childNodes.forEach((child, idx) => {
    const result = renderNode(child, ctx, `${keyPath}-${idx}`)
    if (result == null) return
    if (Array.isArray(result)) {
      renderedChildren.push(...result)
    } else {
      renderedChildren.push(result)
    }
  })

  return h(
    outTag === 'b' ? 'strong' : outTag === 'i' ? 'em' : outTag,
    { key: `el-${keyPath}-${tag}`, ...attrs },
    renderedChildren.length > 0 ? renderedChildren : undefined,
  )
}

export default defineComponent({
  name: 'LongNoteRenderer',
  props: {
    html: {
      type: String,
      default: '',
    },
    getRunStyle: {
      type: Function,
      default: null,
    },
  },
  setup(props) {
    return () => {
      const doc = new DOMParser().parseFromString(props.html || '', 'text/html')
      const body = doc.body
      const ctx = { getRunStyle: props.getRunStyle }
      const children = Array.from(body.childNodes)
        .map((node, idx) => renderNode(node, ctx, String(idx)))
        .filter((v) => v != null)
        .flat()
      return h('div', { class: 'long-note-render-root' }, children)
    }
  },
})
</script>

<style scoped>
.long-note-render-root {
  width: 100%;
}
</style>
