/**
 * Read-through cache wrapper for a remote MediaStorageAdapter.
 *
 * Designed for the S3 backend where the remote is durable but slow and
 * potentially offline-unavailable, while the local backend (OPFS or
 * IndexedDB) is fast and works offline.
 *
 * Semantics:
 *  - put(): writes to remote first (durability), then mirrors into the
 *    local cache so subsequent reads stay fast. If the cache write
 *    fails, the remote is still authoritative — we swallow the cache
 *    error rather than fail the whole operation.
 *  - get(): tries the cache first; on miss, fetches from the remote and
 *    populates the cache.
 *  - has(): tries the cache first; on miss, falls back to the remote.
 *  - delete(): deletes from the remote first (so the durable copy is
 *    gone immediately), then evicts the cache. As with put(), cache
 *    failures are non-fatal. When `localGcOnly` is true the remote is
 *    NEVER touched — only the cache is evicted. This matches a
 *    multi-device "shared bucket" setup where automated GC on this
 *    device must not delete bytes another device may still need.
 *  - listHashes() / getStats(): by default read from the remote
 *    (source of truth). When `localGcOnly` is true these delegate to
 *    the cache so the GC sweep walks just this device's working set
 *    instead of every object across all devices in the shared bucket.
 *  - forceDeleteFromRemote(): explicit user-confirmed deletion. Always
 *    issues the remote delete (preferring the adapter's `forceDelete`
 *    when present so a `sharedBucket=true` S3 adapter still honors the
 *    request), then evicts the cache. Used by the project-deletion
 *    prompt to purge media this device uniquely references.
 *
 * The wrapper keeps the same interface as a regular adapter so it can
 * be swapped into the singleton via `setMediaAdapter`.
 *
 * @typedef {import('./adapter.js').MediaStorageAdapter} MediaStorageAdapter
 */

/**
 * @param {Object} params
 * @param {MediaStorageAdapter} params.remote - durable backend
 * @param {MediaStorageAdapter} params.cache - fast local backend
 * @param {boolean} [params.localGcOnly=false] - when true, automated
 *   delete()/listHashes()/getStats() operate against the cache only
 *   (the remote is preserved for other clients). Use
 *   `forceDeleteFromRemote()` to bypass.
 * @returns {MediaStorageAdapter & { forceDeleteFromRemote: (hash: string) => Promise<void> }}
 */
export function createCachingMediaAdapter({ remote, cache, localGcOnly = false }) {
  if (!remote) throw new Error('createCachingMediaAdapter: remote adapter required')
  if (!cache) throw new Error('createCachingMediaAdapter: cache adapter required')

  async function safeCachePut(hash, blob, mime) {
    try {
      await cache.put(hash, blob, mime)
    } catch (error) {
      console.warn(`Media cache put for ${hash} failed:`, error)
    }
  }

  async function safeCacheDelete(hash) {
    try {
      await cache.delete(hash)
    } catch (error) {
      console.warn(`Media cache delete for ${hash} failed:`, error)
    }
  }

  async function has(hash) {
    if (await cache.has(hash)) return true
    return remote.has(hash)
  }

  async function get(hash) {
    const cached = await cache.get(hash)
    if (cached) return cached
    const fetched = await remote.get(hash)
    if (fetched?.blob) {
      await safeCachePut(hash, fetched.blob, fetched.mime)
    }
    return fetched
  }

  async function put(hash, blob, mime) {
    await remote.put(hash, blob, mime)
    await safeCachePut(hash, blob, mime)
  }

  async function deleteHash(hash) {
    if (localGcOnly) {
      // Cache-only eviction: remote stays authoritative for other
      // clients in the shared bucket.
      await safeCacheDelete(hash)
      return
    }
    await remote.delete(hash)
    await safeCacheDelete(hash)
  }

  async function forceDeleteFromRemote(hash) {
    if (typeof remote.forceDelete === 'function') {
      await remote.forceDelete(hash)
    } else {
      await remote.delete(hash)
    }
    await safeCacheDelete(hash)
  }

  async function listHashes() {
    if (localGcOnly) return cache.listHashes()
    return remote.listHashes()
  }

  async function getStats() {
    if (localGcOnly) return cache.getStats()
    return remote.getStats()
  }

  return {
    has,
    get,
    put,
    delete: deleteHash,
    forceDeleteFromRemote,
    listHashes,
    getStats,
  }
}
