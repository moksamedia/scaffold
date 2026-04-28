/**
 * .scaffoldz bundle — STORED zip with `outline.json` + `media/<hash>`.
 *
 * The bundle is a strict superset of the JSON export format: the exact
 * same envelope (formatVersion, projects, projectVersions, etc.) lives
 * in `outline.json` at the bundle root, but media bytes are written as
 * separate files under `media/<sha256-hex>` instead of being base64-
 * embedded in a `media` map. This avoids the ~33% base64 inflation and
 * lets users inspect / extract media with any zip tool.
 *
 * Bundle layout:
 *   outline.json           — full export envelope (no `media` map)
 *   media/<hash>           — raw bytes for each referenced media item
 *   media/<hash>.meta.json — { mime, size, createdAt? }
 *
 * Importers auto-detect bundles from the file extension OR from a zip
 * magic-number sniff (PK\003\004) and fall through to plain JSON when
 * the input looks like text.
 */

import { exportAsJSON, importFromJSON, collectExportRefHashes } from './json.js'
import { getMediaAdapter } from '../media/index.js'
import { isValidSha256Hex } from '../media/hash.js'
import { createZip, parseZip } from './zip.js'

const MANIFEST_PATH = 'outline.json'
const MEDIA_DIR = 'media/'

/**
 * Build a `.scaffoldz` archive in memory from the same shape passed to
 * `exportAsJSON`. Returns the raw bytes as a Uint8Array.
 *
 * @param {Array} projects
 * @param {string|null} selectedProjectId
 * @param {Object} [options] - same as exportAsJSON; supports versionsByProjectId
 * @param {() => import('../media/adapter.js').MediaStorageAdapter} [adapterAccessor]
 * @returns {Promise<Uint8Array>}
 */
export async function buildScaffoldzBundle(
  projects,
  selectedProjectId = null,
  options = {},
  adapterAccessor = getMediaAdapter,
) {
  const envelope = exportAsJSON(projects, selectedProjectId, options)

  const refs = collectExportRefHashes(envelope)
  const adapter = adapterAccessor()

  const entries = [
    {
      path: MANIFEST_PATH,
      data: JSON.stringify(envelope, null, 2),
      date: new Date(),
    },
  ]

  for (const hash of refs) {
    if (!isValidSha256Hex(hash)) continue
    const row = await adapter.get(hash)
    if (!row || !row.blob) continue
    const buffer = await row.blob.arrayBuffer()
    entries.push({
      path: `${MEDIA_DIR}${hash}`,
      data: new Uint8Array(buffer),
    })
    entries.push({
      path: `${MEDIA_DIR}${hash}.meta.json`,
      data: JSON.stringify({
        mime: row.mime || row.blob.type || 'application/octet-stream',
        size: typeof row.size === 'number' ? row.size : row.blob.size || 0,
        createdAt: row.createdAt || null,
      }),
    })
  }

  return createZip(entries)
}

/**
 * Trigger a download of a `.scaffoldz` bundle. Uses
 * `window.showSaveFilePicker` when supported (true Save dialog) and
 * falls back to the anchor-click pattern otherwise.
 *
 * @param {Uint8Array} bundleBytes
 * @param {string} filename - without extension
 */
export async function downloadScaffoldzBundle(bundleBytes, filename = 'outline') {
  const safeName = `${filename.replace(/[^a-z0-9]/gi, '_')}.scaffoldz`
  const blob = new Blob([bundleBytes], { type: 'application/zip' })

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: 'Scaffold media bundle',
            accept: { 'application/zip': ['.scaffoldz', '.zip'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      if (error?.name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Parse a `.scaffoldz` bundle and ingest its media into the local
 * media adapter, then run the regular `importFromJSON` pipeline. The
 * envelope inside the bundle is reused as-is; media bytes from the
 * bundle's `media/<hash>` files take precedence over any (legacy)
 * inline `media` map carried in `outline.json`.
 *
 * @param {Uint8Array | ArrayBuffer} bundleBytes
 * @param {() => import('../media/adapter.js').MediaStorageAdapter} [adapterAccessor]
 * @returns {Promise<ReturnType<typeof importFromJSON>>}
 */
export async function importScaffoldzBundle(
  bundleBytes,
  adapterAccessor = getMediaAdapter,
) {
  const entries = parseZip(bundleBytes)
  const manifestEntry = entries.find((e) => e.path === MANIFEST_PATH)
  if (!manifestEntry) {
    throw new Error('.scaffoldz: archive is missing outline.json')
  }
  const manifestText = new TextDecoder().decode(manifestEntry.data)
  const envelope = JSON.parse(manifestText)

  const adapter = adapterAccessor()
  let importedMediaCount = 0
  const mediaWarnings = []

  // Build a map of meta files keyed by hash so we can pair them with
  // their data files. Meta files are optional — if missing we infer
  // mime from sniffing later.
  const metaByHash = new Map()
  for (const entry of entries) {
    if (!entry.path.startsWith(MEDIA_DIR)) continue
    if (!entry.path.endsWith('.meta.json')) continue
    const hash = entry.path.slice(MEDIA_DIR.length, -'.meta.json'.length)
    if (!isValidSha256Hex(hash)) continue
    try {
      metaByHash.set(hash, JSON.parse(new TextDecoder().decode(entry.data)))
    } catch {
      // ignore malformed meta; we'll fall back to defaults
    }
  }

  for (const entry of entries) {
    if (!entry.path.startsWith(MEDIA_DIR)) continue
    if (entry.path.endsWith('.meta.json')) continue
    const hash = entry.path.slice(MEDIA_DIR.length)
    if (!isValidSha256Hex(hash)) {
      mediaWarnings.push(`Skipped media file with invalid hash path: ${entry.path}`)
      continue
    }
    const meta = metaByHash.get(hash) || {}
    const mime = meta.mime || 'application/octet-stream'
    try {
      const blob = new Blob([entry.data], { type: mime })
      await adapter.put(hash, blob, mime)
      importedMediaCount += 1
    } catch (error) {
      mediaWarnings.push(`Failed to ingest media ${hash.slice(0, 8)}: ${error?.message || error}`)
    }
  }

  // Drop any inline `media` map — bundle media has already been
  // ingested. The remaining import path runs as usual.
  const cleanedEnvelope = { ...envelope }
  delete cleanedEnvelope.media

  const result = await importFromJSON(cleanedEnvelope)
  return {
    ...result,
    importedMediaCount: (result.importedMediaCount || 0) + importedMediaCount,
    warnings: [...(result.warnings || []), ...mediaWarnings],
  }
}

/**
 * Sniff the first four bytes of a payload for the ZIP local-file-header
 * magic number ("PK\u0003\u0004"). Useful for auto-detecting whether
 * an imported file is a `.scaffoldz` bundle or a plain JSON export.
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {boolean}
 */
export function isZipMagic(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return (
    view.length >= 4 &&
    view[0] === 0x50 &&
    view[1] === 0x4b &&
    view[2] === 0x03 &&
    view[3] === 0x04
  )
}
