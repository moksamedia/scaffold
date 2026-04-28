import { describe, it, expect } from 'vitest'
import { createMediaResolver } from 'src/utils/media/resolver.js'

function makeFakeAdapter() {
  const map = new Map()
  return {
    map,
    has: async (h) => map.has(h),
    get: async (h) => map.get(h) || null,
    put: async (h, blob, mime) =>
      map.set(h, {
        hash: h,
        blob,
        mime,
        size: blob.size,
        createdAt: 1,
        lastUsedAt: 1,
      }),
    delete: async (h) => void map.delete(h),
    listHashes: async () => Array.from(map.keys()),
    getStats: async () => ({ count: map.size, bytes: 0 }),
  }
}

describe('MediaResolver', () => {
  it('returns null for unknown hashes', async () => {
    const adapter = makeFakeAdapter()
    const resolver = createMediaResolver(() => adapter)
    expect(await resolver.toObjectUrl('a'.repeat(64))).toBeNull()
  })

  it('caches one URL per hash across repeated calls', async () => {
    const adapter = makeFakeAdapter()
    await adapter.put('a'.repeat(64), new Blob(['x'], { type: 'text/plain' }), 'text/plain')

    const createdUrls = []
    const origCreate = URL.createObjectURL
    URL.createObjectURL = (blob) => {
      const url = origCreate(blob)
      createdUrls.push(url)
      return url
    }

    try {
      const resolver = createMediaResolver(() => adapter)
      const u1 = await resolver.toObjectUrl('a'.repeat(64))
      const u2 = await resolver.toObjectUrl('a'.repeat(64))
      expect(u1).toBeTruthy()
      expect(u1).toBe(u2)
      expect(createdUrls).toHaveLength(1)
    } finally {
      URL.createObjectURL = origCreate
    }
  })

  it('syncUrl returns the cached URL only after toObjectUrl resolves', async () => {
    const adapter = makeFakeAdapter()
    await adapter.put('b'.repeat(64), new Blob(['y']), 'text/plain')
    const resolver = createMediaResolver(() => adapter)

    expect(resolver.syncUrl('b'.repeat(64))).toBeNull()
    await resolver.toObjectUrl('b'.repeat(64))
    expect(resolver.syncUrl('b'.repeat(64))).toBeTruthy()
  })

  it('ensureMany pre-fetches a list of unique hashes', async () => {
    const adapter = makeFakeAdapter()
    await adapter.put('c'.repeat(64), new Blob(['1']), 'text/plain')
    await adapter.put('d'.repeat(64), new Blob(['2']), 'text/plain')
    const resolver = createMediaResolver(() => adapter)

    await resolver.ensureMany(['c'.repeat(64), 'd'.repeat(64), 'c'.repeat(64)])
    expect(resolver.syncUrl('c'.repeat(64))).toBeTruthy()
    expect(resolver.syncUrl('d'.repeat(64))).toBeTruthy()
  })

  it('dispose revokes all cached URLs and empties the cache', async () => {
    const adapter = makeFakeAdapter()
    await adapter.put('e'.repeat(64), new Blob(['z']), 'text/plain')
    const resolver = createMediaResolver(() => adapter)
    await resolver.toObjectUrl('e'.repeat(64))
    expect(resolver.syncUrl('e'.repeat(64))).toBeTruthy()

    resolver.dispose()
    expect(resolver.syncUrl('e'.repeat(64))).toBeNull()
  })
})
