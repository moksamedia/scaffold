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
 *    failures are non-fatal.
 *  - listHashes() / getStats(): always read from the remote — it's the
 *    source of truth. The cache is intentionally lossy.
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
 * @returns {MediaStorageAdapter}
 */
export function createCachingMediaAdapter({ remote, cache }) {
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
    await remote.delete(hash)
    await safeCacheDelete(hash)
  }

  async function listHashes() {
    return remote.listHashes()
  }

  async function getStats() {
    return remote.getStats()
  }

  return { has, get, put, delete: deleteHash, listHashes, getStats }
}
