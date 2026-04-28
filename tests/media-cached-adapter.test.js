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

  describe('localGcOnly mode (shared bucket)', () => {
    let localOnly

    beforeEach(() => {
      localOnly = createCachingMediaAdapter({ remote, cache, localGcOnly: true })
    })

    it('delete() only evicts the cache; the remote is preserved', async () => {
      const blob = new Blob([new Uint8Array([1])])
      cache.store.set('h', { blob, mime: 'image/png', size: 1, createdAt: 0 })
      remote.store.set('h', { blob, mime: 'image/png', size: 1, createdAt: 0 })
      await localOnly.delete('h')
      expect(cache.store.has('h')).toBe(false)
      expect(remote.store.has('h')).toBe(true)
    })

    it('listHashes() returns the cache hashes (not remote)', async () => {
      const blob = new Blob([new Uint8Array([1])])
      remote.store.set('remote-only', { blob, mime: 'x', size: 1, createdAt: 0 })
      cache.store.set('cache-only', { blob, mime: 'x', size: 1, createdAt: 0 })
      expect((await localOnly.listHashes()).sort()).toEqual(['cache-only'])
    })

    it('getStats() reflects the cache (not remote)', async () => {
      const blob = new Blob([new Uint8Array([1])])
      remote.store.set('a', { blob, mime: 'x', size: 1, createdAt: 0 })
      remote.store.set('b', { blob, mime: 'x', size: 1, createdAt: 0 })
      cache.store.set('only-c', { blob, mime: 'x', size: 1, createdAt: 0 })
      const stats = await localOnly.getStats()
      expect(stats.count).toBe(1)
    })

    it('put() still writes through to the remote (durability preserved)', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
      await localOnly.put('h-put', blob, 'image/png')
      expect(remote.store.has('h-put')).toBe(true)
      expect(cache.store.has('h-put')).toBe(true)
    })
  })

  describe('backfillRemoteFromCache', () => {
    function seedBlob(adapter, hash, mime = 'image/png') {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: mime })
      adapter.store.set(hash, { blob, mime, size: blob.size, createdAt: 0 })
    }

    it('listCachedHashes / listRemoteHashes expose each tier directly', async () => {
      seedBlob(cache, 'in-cache')
      seedBlob(remote, 'in-remote')
      expect(await wrapped.listCachedHashes()).toEqual(['in-cache'])
      expect(await wrapped.listRemoteHashes()).toEqual(['in-remote'])
    })

    it('getCached reads only from the cache (no remote fallthrough)', async () => {
      const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' })
      remote.store.set('only-remote', { blob, mime: 'image/png', size: 2, createdAt: 0 })
      cache.store.set('local', { blob, mime: 'image/png', size: 2, createdAt: 0 })

      let remoteGetCalls = 0
      const originalRemoteGet = remote.get
      remote.get = async (hash) => {
        remoteGetCalls++
        return originalRemoteGet(hash)
      }

      expect(await wrapped.getCached('local')).toEqual(
        expect.objectContaining({ mime: 'image/png', size: 2 }),
      )
      expect(await wrapped.getCached('only-remote')).toBeNull()
      // Crucially: the cache miss did NOT trigger a remote fetch.
      expect(remoteGetCalls).toBe(0)
      // ... and the cache was not silently populated either.
      expect(cache.store.has('only-remote')).toBe(false)
    })

    it('uploads cache-only hashes to remote and skips ones already there', async () => {
      seedBlob(cache, 'a')
      seedBlob(cache, 'b')
      seedBlob(cache, 'shared')
      seedBlob(remote, 'shared')
      seedBlob(remote, 'remote-only')

      const stats = await wrapped.backfillRemoteFromCache()
      expect(stats.checked).toBe(2)
      expect(stats.uploaded).toBe(2)
      expect(stats.skipped).toBe(0)
      expect(stats.failed).toBe(0)
      expect(remote.store.has('a')).toBe(true)
      expect(remote.store.has('b')).toBe(true)
      // remote-only is unaffected.
      expect(remote.store.has('remote-only')).toBe(true)
    })

    it('idempotent: a second run does nothing', async () => {
      seedBlob(cache, 'a')
      await wrapped.backfillRemoteFromCache()
      const stats = await wrapped.backfillRemoteFromCache()
      expect(stats).toEqual({ checked: 0, uploaded: 0, skipped: 0, failed: 0 })
    })

    it('honors an explicit `hashes` whitelist (per-project backfill)', async () => {
      seedBlob(cache, 'project-1-only')
      seedBlob(cache, 'project-2-only')
      const stats = await wrapped.backfillRemoteFromCache({
        hashes: ['project-1-only'],
      })
      expect(stats.uploaded).toBe(1)
      expect(remote.store.has('project-1-only')).toBe(true)
      expect(remote.store.has('project-2-only')).toBe(false)
    })

    it('skips a whitelisted hash that is already on remote', async () => {
      seedBlob(cache, 'h')
      seedBlob(remote, 'h')
      const stats = await wrapped.backfillRemoteFromCache({ hashes: ['h'] })
      expect(stats.checked).toBe(1)
      expect(stats.uploaded).toBe(0)
      expect(stats.skipped).toBe(1)
    })

    it('counts failures without aborting subsequent uploads', async () => {
      seedBlob(cache, 'a')
      seedBlob(cache, 'b')
      let putCount = 0
      const originalPut = remote.put
      remote.put = async (hash, blob, mime) => {
        putCount++
        if (hash === 'a') throw new Error('boom')
        return originalPut(hash, blob, mime)
      }
      const stats = await wrapped.backfillRemoteFromCache()
      expect(putCount).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.uploaded).toBe(1)
      expect(remote.store.has('b')).toBe(true)
    })

    it('reports per-step progress via onProgress', async () => {
      seedBlob(cache, 'h1')
      seedBlob(cache, 'h2')
      const calls = []
      await wrapped.backfillRemoteFromCache({
        onProgress: (info) => calls.push({ ...info }),
      })
      expect(calls).toHaveLength(2)
      expect(calls[0].index).toBe(1)
      expect(calls[0].total).toBe(2)
      expect(calls[1].index).toBe(2)
      expect(calls[1].uploaded).toBe(2)
    })
  })

  describe('forceDeleteFromRemote', () => {
    it('prefers the remote.forceDelete escape hatch when available', async () => {
      const blob = new Blob([new Uint8Array([1])])
      const calls = { force: 0, plain: 0 }
      remote.forceDelete = async (hash) => {
        calls.force++
        remote.store.delete(hash)
      }
      const originalDelete = remote.delete
      remote.delete = async (hash) => {
        calls.plain++
        return originalDelete(hash)
      }
      cache.store.set('h', { blob, mime: 'x', size: 1, createdAt: 0 })
      remote.store.set('h', { blob, mime: 'x', size: 1, createdAt: 0 })
      const localOnly = createCachingMediaAdapter({ remote, cache, localGcOnly: true })
      await localOnly.forceDeleteFromRemote('h')
      expect(calls.force).toBe(1)
      expect(calls.plain).toBe(0)
      expect(remote.store.has('h')).toBe(false)
      expect(cache.store.has('h')).toBe(false)
    })

    it('falls back to remote.delete when forceDelete is not exposed', async () => {
      const blob = new Blob([new Uint8Array([1])])
      cache.store.set('h', { blob, mime: 'x', size: 1, createdAt: 0 })
      remote.store.set('h', { blob, mime: 'x', size: 1, createdAt: 0 })
      await wrapped.forceDeleteFromRemote('h')
      expect(remote.store.has('h')).toBe(false)
      expect(cache.store.has('h')).toBe(false)
    })

    it('always touches remote, even when localGcOnly is true', async () => {
      const blob = new Blob([new Uint8Array([1])])
      remote.store.set('h', { blob, mime: 'x', size: 1, createdAt: 0 })
      const localOnly = createCachingMediaAdapter({ remote, cache, localGcOnly: true })
      await localOnly.forceDeleteFromRemote('h')
      expect(remote.store.has('h')).toBe(false)
    })
  })
})
