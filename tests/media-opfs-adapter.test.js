import { describe, it, expect, beforeEach } from 'vitest'
import { createOpfsMediaAdapter, isOpfsAvailable } from 'src/utils/media/opfs-adapter.js'
import { createInMemoryOpfsRoot } from './fixtures/in-memory-opfs.js'

describe('isOpfsAvailable', () => {
  it('returns false in environments without navigator.storage.getDirectory', () => {
    // happy-dom does not provide the OPFS API, so this should reflect
    // production-like fallback behavior in tests.
    expect(isOpfsAvailable()).toBe(false)
  })
})

describe('OPFS media adapter (in-memory)', () => {
  let adapter

  beforeEach(() => {
    const root = createInMemoryOpfsRoot()
    adapter = createOpfsMediaAdapter({ rootHandleProvider: async () => root })
  })

  function makeBlob(text, mime = 'image/png') {
    return new Blob([new TextEncoder().encode(text)], { type: mime })
  }

  const HASH_A = 'a'.repeat(64)
  const HASH_B = 'b'.repeat(64)

  it('has() returns false before any put', async () => {
    expect(await adapter.has(HASH_A)).toBe(false)
  })

  it('put + get roundtrips bytes and metadata', async () => {
    await adapter.put(HASH_A, makeBlob('hello-opfs', 'image/png'), 'image/png')
    const row = await adapter.get(HASH_A)
    expect(row).not.toBeNull()
    expect(row.hash).toBe(HASH_A)
    expect(row.mime).toBe('image/png')
    expect(row.size).toBe(10)
    const text = new TextDecoder().decode(new Uint8Array(await row.blob.arrayBuffer()))
    expect(text).toBe('hello-opfs')
    expect(typeof row.createdAt).toBe('number')
    expect(typeof row.lastUsedAt).toBe('number')
  })

  it('put preserves createdAt across re-puts', async () => {
    await adapter.put(HASH_A, makeBlob('x'), 'text/plain')
    const before = await adapter.get(HASH_A)
    await new Promise((r) => setTimeout(r, 5))
    await adapter.put(HASH_A, makeBlob('x'), 'text/plain')
    const after = await adapter.get(HASH_A)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.lastUsedAt).toBeGreaterThanOrEqual(before.lastUsedAt)
  })

  it('delete removes both the blob and the meta sidecar', async () => {
    await adapter.put(HASH_A, makeBlob('y'), 'audio/mpeg')
    expect(await adapter.has(HASH_A)).toBe(true)
    await adapter.delete(HASH_A)
    expect(await adapter.has(HASH_A)).toBe(false)
    expect(await adapter.get(HASH_A)).toBeNull()
  })

  it('listHashes returns only blob entries (not meta sidecars)', async () => {
    await adapter.put(HASH_A, makeBlob('a'), 'text/plain')
    await adapter.put(HASH_B, makeBlob('b'), 'text/plain')
    const hashes = await adapter.listHashes()
    expect(hashes.sort()).toEqual([HASH_A, HASH_B].sort())
  })

  it('getStats returns count and aggregate bytes', async () => {
    await adapter.put(HASH_A, makeBlob('hi'), 'text/plain')
    await adapter.put(HASH_B, makeBlob('there'), 'text/plain')
    const stats = await adapter.getStats()
    expect(stats.count).toBe(2)
    expect(stats.bytes).toBe(2 + 5)
  })
})
