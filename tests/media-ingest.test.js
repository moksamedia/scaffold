import { describe, it, expect } from 'vitest'
import {
  ingestBlob,
  ingestDataUrl,
  dataUrlToBlob,
  blobToBase64,
  base64ToBlob,
} from 'src/utils/media/ingest.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { sha256Hex } from 'src/utils/media/hash.js'

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URI', () => {
    const dataUrl = 'data:text/plain;base64,aGVsbG8='
    const { blob, mime } = dataUrlToBlob(dataUrl)
    expect(mime).toBe('text/plain')
    expect(blob.size).toBe(5)
  })

  it('decodes a URL-encoded data URI', () => {
    const dataUrl = 'data:text/plain,hello%20world'
    const { blob, mime } = dataUrlToBlob(dataUrl)
    expect(mime).toBe('text/plain')
    expect(blob.size).toBe(11)
  })

  it('throws on malformed data URI', () => {
    expect(() => dataUrlToBlob('data:bogus')).toThrow()
  })
})

describe('ingestBlob', () => {
  it('stores the blob under its content hash and returns it', async () => {
    const bytes = new TextEncoder().encode('audio-bytes')
    const blob = new Blob([bytes], { type: 'audio/mpeg' })
    const expectedHash = await sha256Hex(blob)

    const result = await ingestBlob(blob)
    expect(result.hash).toBe(expectedHash)
    expect(result.mime).toBe('audio/mpeg')
    expect(result.size).toBe(bytes.length)

    const adapter = getMediaAdapter()
    expect(await adapter.has(expectedHash)).toBe(true)
    const row = await adapter.get(expectedHash)
    expect(row.mime).toBe('audio/mpeg')
    expect(row.size).toBe(bytes.length)
  })

  it('is idempotent: same bytes ingested twice keeps the original createdAt', async () => {
    const bytes = new TextEncoder().encode('same-bytes')
    const blob = new Blob([bytes], { type: 'image/png' })
    const { hash } = await ingestBlob(blob)
    const adapter = getMediaAdapter()
    const first = await adapter.get(hash)

    await new Promise((r) => setTimeout(r, 5))
    await ingestBlob(blob)
    const second = await adapter.get(hash)

    expect(first.createdAt).toBe(second.createdAt)
  })

  it('rejects non-Blob inputs', async () => {
    await expect(ingestBlob('not-a-blob')).rejects.toThrow(TypeError)
  })
})

describe('ingestDataUrl', () => {
  it('ingests a data URI and matches blob hash', async () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='
    const result = await ingestDataUrl(dataUrl)
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.mime).toBe('image/png')

    const blob = base64ToBlob('aGVsbG8=', 'image/png')
    const expected = await sha256Hex(blob)
    expect(result.hash).toBe(expected)
  })

  it('rejects non-data: strings', async () => {
    await expect(ingestDataUrl('https://example.com/x.png')).rejects.toThrow(TypeError)
  })
})

describe('blobToBase64 / base64ToBlob roundtrip', () => {
  it('preserves bytes through encoding and decoding', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const base64 = await blobToBase64(blob)
    const decoded = base64ToBlob(base64, 'application/octet-stream')
    const roundTripped = new Uint8Array(await decoded.arrayBuffer())
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes))
  })
})
