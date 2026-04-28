/**
 * MediaIngest — converts a `data:` URI or `Blob` into a stored media row,
 * returning the content hash. Idempotent: if the same bytes are ingested
 * twice, only one row exists and the existing `createdAt` is preserved.
 */

import { sha256Hex } from './hash.js'
import { getMediaAdapter } from './index.js'
import { logger } from '../logging/logger.js'

/**
 * Ingest the bytes of a `Blob` into the media adapter.
 *
 * @param {Blob} blob
 * @param {string} [explicitMime]
 * @returns {Promise<{hash: string, mime: string, size: number}>}
 */
export async function ingestBlob(blob, explicitMime) {
  if (!(blob instanceof Blob)) {
    throw new TypeError('ingestBlob: expected a Blob')
  }
  const startedAt = Date.now()
  const hash = await sha256Hex(blob)
  const mime = explicitMime || blob.type || 'application/octet-stream'
  const adapter = getMediaAdapter()
  const alreadyExists = await adapter.has(hash)
  if (!alreadyExists) {
    try {
      await adapter.put(hash, blob, mime)
      logger.info('media.ingest.stored', {
        hashPrefix: hash.slice(0, 12),
        sizeBytes: blob.size,
        mime,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      logger.error('media.ingest.failed', error, {
        hashPrefix: hash.slice(0, 12),
        sizeBytes: blob.size,
        mime,
      })
      throw error
    }
  } else {
    logger.debug('media.ingest.deduped', {
      hashPrefix: hash.slice(0, 12),
      sizeBytes: blob.size,
      mime,
    })
  }
  return { hash, mime, size: blob.size }
}

/**
 * Ingest the bytes of a `data:` URI into the media adapter.
 *
 * @param {string} dataUrl
 * @returns {Promise<{hash: string, mime: string, size: number}>}
 */
export async function ingestDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new TypeError('ingestDataUrl: expected a data: URI string')
  }
  const { blob, mime } = dataUrlToBlob(dataUrl)
  return ingestBlob(blob, mime)
}

/**
 * Decode a `data:` URI into a Blob without going through the network.
 * Handles both base64-encoded and URL-encoded payloads.
 *
 * @param {string} dataUrl
 * @returns {{blob: Blob, mime: string}}
 */
export function dataUrlToBlob(dataUrl) {
  const headerEnd = dataUrl.indexOf(',')
  if (headerEnd < 0) {
    throw new Error('Invalid data URL: missing comma separator')
  }
  const header = dataUrl.slice(5, headerEnd)
  const payload = dataUrl.slice(headerEnd + 1)

  const isBase64 = header.endsWith(';base64')
  const mime = (isBase64 ? header.slice(0, -7) : header) || 'application/octet-stream'

  let bytes
  if (isBase64) {
    const binary = atob(payload)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
  } else {
    const decoded = decodeURIComponent(payload)
    bytes = new TextEncoder().encode(decoded)
  }

  return { blob: new Blob([bytes], { type: mime }), mime }
}

/**
 * Encode a Blob's bytes as a base64 `data:` URI. Used when serializing
 * media into a JSON export.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * Decode a base64 string into a Blob with the given mime type.
 *
 * @param {string} base64
 * @param {string} mime
 * @returns {Blob}
 */
export function base64ToBlob(base64, mime) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}
