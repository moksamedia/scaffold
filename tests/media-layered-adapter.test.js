import { describe, it, expect } from 'vitest'
import { createLayeredMediaAdapter } from 'src/utils/media/layered-adapter.js'

function makeMemAdapter() {
  const map = new Map()
  return {
    map,
    async has(h) {
      return map.has(h)
    },
    async get(h) {
      return map.get(h) || null
    },
    async put(h, blob, mime) {
      map.set(h, {
        hash: h,
        blob,
        mime: mime || blob.type,
        size: blob.size,
        createdAt: 1,
        lastUsedAt: 2,
      })
    },
    async delete(h) {
      map.delete(h)
    },
    async listHashes() {
      return Array.from(map.keys())
    },
    async getStats() {
      let bytes = 0
      for (const r of map.values()) bytes += r.size
      return { count: map.size, bytes }
    },
  }
}

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('createLayeredMediaAdapter', () => {
  it('writes go to the primary only', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    const layered = createLayeredMediaAdapter([primary, fallback])

    await layered.put(HASH_A, new Blob(['x'], { type: 'text/plain' }), 'text/plain')
    expect(primary.map.has(HASH_A)).toBe(true)
    expect(fallback.map.has(HASH_A)).toBe(false)
  })

  it('reads from the primary first', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await primary.put(HASH_A, new Blob(['from-primary']), 'text/plain')
    await fallback.put(HASH_A, new Blob(['from-fallback']), 'text/plain')
    const layered = createLayeredMediaAdapter([primary, fallback])

    const row = await layered.get(HASH_A)
    const text = new TextDecoder().decode(new Uint8Array(await row.blob.arrayBuffer()))
    expect(text).toBe('from-primary')
  })

  it('lazily promotes a fallback hit into the primary on read', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await fallback.put(HASH_A, new Blob(['legacy']), 'text/plain')
    const layered = createLayeredMediaAdapter([primary, fallback])

    expect(primary.map.has(HASH_A)).toBe(false)
    const row = await layered.get(HASH_A)
    expect(row).not.toBeNull()
    expect(primary.map.has(HASH_A)).toBe(true)
  })

  it('has() returns true if any layer has the hash', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await fallback.put(HASH_A, new Blob(['only-fallback']), 'text/plain')
    const layered = createLayeredMediaAdapter([primary, fallback])

    expect(await layered.has(HASH_A)).toBe(true)
    expect(await layered.has(HASH_B)).toBe(false)
  })

  it('delete removes from all layers', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await primary.put(HASH_A, new Blob(['p']), 'text/plain')
    await fallback.put(HASH_A, new Blob(['f']), 'text/plain')
    const layered = createLayeredMediaAdapter([primary, fallback])

    await layered.delete(HASH_A)
    expect(primary.map.has(HASH_A)).toBe(false)
    expect(fallback.map.has(HASH_A)).toBe(false)
  })

  it('listHashes returns the union, not duplicates', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await primary.put(HASH_A, new Blob(['p']), 'text/plain')
    await fallback.put(HASH_A, new Blob(['f']), 'text/plain')
    await fallback.put(HASH_B, new Blob(['f2']), 'text/plain')
    const layered = createLayeredMediaAdapter([primary, fallback])

    const hashes = await layered.listHashes()
    expect(hashes.sort()).toEqual([HASH_A, HASH_B].sort())
  })

  it('getStats counts each hash once across layers', async () => {
    const primary = makeMemAdapter()
    const fallback = makeMemAdapter()
    await primary.put(HASH_A, new Blob(['xx']), 'text/plain') // 2 bytes
    await fallback.put(HASH_A, new Blob(['yy']), 'text/plain') // duplicate hash
    await fallback.put(HASH_B, new Blob(['zzz']), 'text/plain') // 3 bytes
    const layered = createLayeredMediaAdapter([primary, fallback])

    const stats = await layered.getStats()
    expect(stats.count).toBe(2)
    expect(stats.bytes).toBe(2 + 3)
  })

  it('throws when constructed with an empty layer list', () => {
    expect(() => createLayeredMediaAdapter([])).toThrow()
    expect(() => createLayeredMediaAdapter(null)).toThrow()
  })
})
