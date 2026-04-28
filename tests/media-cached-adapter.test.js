/**
 * Tests for the read-through caching wrapper used to layer a fast
 * local backend (OPFS / IDB) in front of a slow durable backend (S3).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createCachingMediaAdapter } from 'src/utils/media/cached-adapter.js'

function makeFakeAdapter() {
  const store = new Map()
  return {
    store,
    has: async (hash) => store.has(hash),
    get: async (hash) => store.get(hash) || null,
    put: async (hash, blob, mime) => {
      store.set(hash, { blob, mime, size: blob.size, createdAt: Date.now() })
    },
    delete: async (hash) => {
      store.delete(hash)
    },
    listHashes: async () => Array.from(store.keys()),
    getStats: async () => ({ count: store.size, bytes: 0 }),
  }
}

describe('createCachingMediaAdapter', () => {
  let cache
  let remote
  let wrapped

  beforeEach(() => {
    cache = makeFakeAdapter()
    remote = makeFakeAdapter()
    wrapped = createCachingMediaAdapter({ remote, cache })
  })

  it('writes to remote first, then mirrors into cache', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await wrapped.put('hash-1', blob, 'image/png')
    expect(remote.store.has('hash-1')).toBe(true)
    expect(cache.store.has('hash-1')).toBe(true)
  })

  it('returns cache hit without touching remote', async () => {
    const blob = new Blob([new Uint8Array([1])])
    cache.store.set('h', { blob, mime: 'image/png', size: blob.size, createdAt: 0 })
    let remoteCalls = 0
    remote.get = async () => {
      remoteCalls++
      return null
    }
    const result = await wrapped.get('h')
    expect(result.mime).toBe('image/png')
    expect(remoteCalls).toBe(0)
  })

  it('promotes remote hits into the cache lazily', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/mpeg' })
    remote.store.set('h2', { blob, mime: 'audio/mpeg', size: blob.size, createdAt: 0 })
    expect(cache.store.has('h2')).toBe(false)
    const fetched = await wrapped.get('h2')
    expect(fetched?.mime).toBe('audio/mpeg')
    expect(cache.store.has('h2')).toBe(true)
  })

  it('has() falls through to remote on cache miss', async () => {
    const blob = new Blob([new Uint8Array([1])])
    remote.store.set('h3', { blob, mime: 'image/png', size: 1, createdAt: 0 })
    expect(await wrapped.has('h3')).toBe(true)
  })

  it('delete clears both remote and cache', async () => {
    const blob = new Blob([new Uint8Array([1])])
    cache.store.set('h4', { blob, mime: 'image/png', size: 1, createdAt: 0 })
    remote.store.set('h4', { blob, mime: 'image/png', size: 1, createdAt: 0 })
    await wrapped.delete('h4')
    expect(remote.store.has('h4')).toBe(false)
    expect(cache.store.has('h4')).toBe(false)
  })

  it('listHashes / getStats read from remote (source of truth)', async () => {
    const blob = new Blob([new Uint8Array([1])])
    remote.store.set('h5', { blob, mime: 'x', size: 1, createdAt: 0 })
    remote.store.set('h6', { blob, mime: 'x', size: 1, createdAt: 0 })
    cache.store.set('h7-only-local', { blob, mime: 'x', size: 1, createdAt: 0 })
    expect((await wrapped.listHashes()).sort()).toEqual(['h5', 'h6'])
    const stats = await wrapped.getStats()
    expect(stats.count).toBe(2)
  })

  it('cache write failures do not fail the put()', async () => {
    cache.put = async () => {
      throw new Error('cache offline')
    }
    const blob = new Blob([new Uint8Array([1])])
    await expect(wrapped.put('h8', blob, 'image/png')).resolves.toBeUndefined()
    expect(remote.store.has('h8')).toBe(true)
  })
})
