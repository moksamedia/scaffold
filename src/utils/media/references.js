/**
 * Helpers for the `scaffold-media://<hash>` reference scheme used inside
 * long-note HTML in place of `data:` URIs.
 *
 * The scheme is intentionally not a real URL protocol; the renderer/editor
 * never lets it reach the browser as a network fetch. References are
 * resolved to blob URLs only at render/edit time.
 */

import { isValidSha256Hex } from './hash.js'

export const MEDIA_REF_PROTOCOL = 'scaffold-media://'

/** Matches the protocol followed by a 64-char lowercase hex hash. */
const MEDIA_REF_REGEX = /scaffold-media:\/\/([0-9a-f]{64})/g
const MIME_PREFIX_REGEX = /^data:([^;,]+)/

const MEDIA_BEARING_SELECTOR = 'img, audio, source, video'

export function buildMediaRef(hash) {
  return `${MEDIA_REF_PROTOCOL}${hash}`
}

export function isMediaRef(value) {
  return typeof value === 'string' && value.startsWith(MEDIA_REF_PROTOCOL)
}

export function parseMediaRef(value) {
  if (!isMediaRef(value)) return null
  const hash = value.slice(MEDIA_REF_PROTOCOL.length)
  return isValidSha256Hex(hash) ? hash : null
}

/**
 * Extract every `scaffold-media://<hash>` hash referenced anywhere in a string.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function extractRefHashesFromHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return []
  const out = []
  for (const match of html.matchAll(MEDIA_REF_REGEX)) {
    out.push(match[1])
  }
  return out
}

/**
 * Walk a list of outline items (or a project's `lists` / `items` array)
 * recursively and invoke `cb(hash)` for every reference encountered in
 * any long-note HTML.
 *
 * @param {object[]|undefined} items
 * @param {(hash: string) => void} cb
 */
export function forEachRefHash(items, cb) {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (Array.isArray(item?.longNotes)) {
      for (const note of item.longNotes) {
        for (const hash of extractRefHashesFromHtml(note?.text || '')) {
          cb(hash)
        }
      }
    }
    if (Array.isArray(item?.children) && item.children.length > 0) {
      forEachRefHash(item.children, cb)
    }
  }
}

/**
 * Collect referenced hashes across an array of project objects. Handles
 * both runtime (`lists`) and exported (`items`) shapes.
 *
 * @param {object[]|undefined} projects
 * @returns {Set<string>}
 */
export function collectProjectRefHashes(projects) {
  const set = new Set()
  for (const project of projects || []) {
    if (!project) continue
    const items = Array.isArray(project.lists)
      ? project.lists
      : Array.isArray(project.items)
        ? project.items
        : []
    forEachRefHash(items, (hash) => set.add(hash))
  }
  return set
}

function parseHtmlBody(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  return doc.body
}

function detectKindFromMime(mime) {
  if (typeof mime !== 'string') return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return null
}

function readMimeFromDataUrl(src) {
  const match = src.match(MIME_PREFIX_REGEX)
  return match ? match[1] : 'application/octet-stream'
}

/**
 * Walk an HTML string and replace every `data:` URI in a media-bearing
 * element's `src` with a `scaffold-media://<hash>` reference.
 * `ingest(dataUrl, mime, kind)` must store the bytes and return the hash.
 *
 * Returns the rewritten HTML (unchanged when nothing matched).
 *
 * @param {string} html
 * @param {(dataUrl: string, mime: string, kind: 'image'|'audio'|'video') => Promise<string>} ingest
 * @returns {Promise<string>}
 */
export async function rewriteDataUrisToRefs(html, ingest) {
  if (typeof html !== 'string' || !html) return html || ''
  if (!html.includes('data:')) return html
  const body = parseHtmlBody(html)
  const elements = Array.from(body.querySelectorAll(MEDIA_BEARING_SELECTOR))
  let dirty = false
  for (const el of elements) {
    const src = el.getAttribute('src') || ''
    if (!src.startsWith('data:')) continue
    const mime = readMimeFromDataUrl(src)
    const kind = detectKindFromMime(mime)
    if (!kind) continue
    const hash = await ingest(src, mime, kind)
    if (!isValidSha256Hex(hash)) continue
    el.setAttribute('src', buildMediaRef(hash))
    el.removeAttribute('data-media-blob-url')
    dirty = true
  }
  return dirty ? body.innerHTML : html
}

/**
 * Walk an HTML string and replace every `scaffold-media://<hash>` ref in
 * a media-bearing element's `src` using `resolver(hash)`. Elements where
 * the resolver returns null/undefined are left unchanged.
 *
 * Optionally tags rewritten elements with `data-media-hash="<hash>"` so a
 * subsequent save pass can collapse blob URLs back to references.
 *
 * @param {string} html
 * @param {(hash: string) => string | null | undefined} resolver
 * @param {{ tagWithHash?: boolean }} [options]
 * @returns {string}
 */
export function rewriteRefsWith(html, resolver, options = {}) {
  if (typeof html !== 'string' || !html) return html || ''
  if (!html.includes(MEDIA_REF_PROTOCOL)) return html
  const body = parseHtmlBody(html)
  const elements = Array.from(body.querySelectorAll(MEDIA_BEARING_SELECTOR))
  let dirty = false
  for (const el of elements) {
    const src = el.getAttribute('src') || ''
    if (!isMediaRef(src)) continue
    const hash = parseMediaRef(src)
    if (!hash) continue
    const replaced = resolver(hash)
    if (typeof replaced !== 'string' || !replaced) continue
    el.setAttribute('src', replaced)
    if (options.tagWithHash) {
      el.setAttribute('data-media-hash', hash)
    }
    dirty = true
  }
  return dirty ? body.innerHTML : html
}

/**
 * Inverse of `rewriteRefsWith({ tagWithHash: true })`: walk the HTML and
 * replace any element carrying `data-media-hash="<hash>"` with a clean
 * `scaffold-media://<hash>` reference, regardless of its current `src`
 * (which may be a blob: URL produced during editing). Also handles
 * inline `data:` URIs by ingesting them.
 *
 * @param {string} html
 * @param {(dataUrl: string, mime: string, kind: 'image'|'audio'|'video') => Promise<string>} ingest
 * @returns {Promise<string>}
 */
export async function normalizeHtmlToRefs(html, ingest) {
  if (typeof html !== 'string' || !html) return html || ''
  const body = parseHtmlBody(html)
  const elements = Array.from(body.querySelectorAll(MEDIA_BEARING_SELECTOR))
  let dirty = false

  for (const el of elements) {
    const taggedHash = el.getAttribute('data-media-hash')
    if (taggedHash && isValidSha256Hex(taggedHash)) {
      el.setAttribute('src', buildMediaRef(taggedHash))
      el.removeAttribute('data-media-hash')
      dirty = true
      continue
    }

    const src = el.getAttribute('src') || ''
    if (src.startsWith('data:')) {
      const mime = readMimeFromDataUrl(src)
      const kind = detectKindFromMime(mime)
      if (!kind) continue
      const hash = await ingest(src, mime, kind)
      if (!isValidSha256Hex(hash)) continue
      el.setAttribute('src', buildMediaRef(hash))
      el.removeAttribute('data-media-hash')
      dirty = true
    }
  }

  return dirty ? body.innerHTML : html
}

/**
 * Convenience: walk a project's `lists` (or exported `items`) tree in place
 * and invoke `transform(html)` on every long-note HTML string, replacing
 * the value if `transform` returns a different string. Returns true when
 * anything changed.
 *
 * @param {object[]|undefined} items
 * @param {(html: string) => Promise<string>} transform
 * @returns {Promise<boolean>}
 */
export async function transformLongNoteHtmlInPlace(items, transform) {
  if (!Array.isArray(items)) return false
  let changed = false
  for (const item of items) {
    if (Array.isArray(item?.longNotes)) {
      for (const note of item.longNotes) {
        if (typeof note?.text !== 'string') continue
        const next = await transform(note.text)
        if (typeof next === 'string' && next !== note.text) {
          note.text = next
          changed = true
        }
      }
    }
    if (Array.isArray(item?.children) && item.children.length > 0) {
      const childChanged = await transformLongNoteHtmlInPlace(item.children, transform)
      if (childChanged) changed = true
    }
  }
  return changed
}
