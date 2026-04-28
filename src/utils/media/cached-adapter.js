import { logger } from '../logging/logger.js'

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
 *  - listCachedHashes() / listRemoteHashes(): expose each tier
 *    individually so callers can compute "what's local but not on
 *    remote yet" without depending on the localGcOnly flag.
 *  - backfillRemoteFromCache(): push every cache-only blob into the
 *    remote. Used after enabling S3 on a device that already had
 *    media stored locally (existing media is otherwise NEVER moved
 *    to S3 — the cache stays the source of truth on reads, and only
 *    new uploads are written through to remote).
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

  logger.info('media.cache.adapter.created', { localGcOnly: Boolean(localGcOnly) })

  function hp(hash) {
    return typeof hash === 'string' ? hash.slice(0, 12) : null
  }

  async function safeCachePut(hash, blob, mime) {
    try {
      await cache.put(hash, blob, mime)
    } catch (error) {
      logger.error('media.cache.put.failed', error, {
        hashPrefix: hp(hash),
        mime: mime || null,
      })
    }
  }

  async function safeCacheDelete(hash) {
    try {
      await cache.delete(hash)
    } catch (error) {
      logger.error('media.cache.delete.failed', error, {
        hashPrefix: hp(hash),
      })
    }
  }

  async function has(hash) {
    if (await cache.has(hash)) {
      logger.debug('media.cache.has.cacheHit', { hashPrefix: hp(hash) })
      return true
    }
    const remoteHas = await remote.has(hash)
    logger.debug('media.cache.has.remoteCheck', {
      hashPrefix: hp(hash),
      result: remoteHas,
    })
    return remoteHas
  }

  async function get(hash) {
    const cached = await cache.get(hash)
    if (cached) {
      logger.debug('media.cache.get.cacheHit', {
        hashPrefix: hp(hash),
        sizeBytes: cached.size,
        mime: cached.mime,
      })
      return cached
    }
    logger.debug('media.cache.get.cacheMiss', { hashPrefix: hp(hash) })
    const fetched = await remote.get(hash)
    if (fetched?.blob) {
      await safeCachePut(hash, fetched.blob, fetched.mime)
      logger.debug('media.cache.get.promoted', {
        hashPrefix: hp(hash),
        sizeBytes: fetched.size,
        mime: fetched.mime,
      })
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
      logger.debug('media.cache.delete.cacheOnly', { hashPrefix: hp(hash) })
      await safeCacheDelete(hash)
      return
    }
    await remote.delete(hash)
    await safeCacheDelete(hash)
  }

  async function forceDeleteFromRemote(hash) {
    logger.info('media.cache.forceDeleteFromRemote', { hashPrefix: hp(hash) })
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

  async function listCachedHashes() {
    return cache.listHashes()
  }

  async function listRemoteHashes() {
    return remote.listHashes()
  }

  /**
   * Read a hash from the cache tier ONLY. Unlike `get()`, this does
   * not fall through to the remote on a miss — useful for inventory
   * displays that need size / mime metadata without triggering S3
   * round-trips and lazy-promotion of remote-only blobs into the
   * local cache.
   */
  async function getCached(hash) {
    return cache.get(hash)
  }

  /**
   * Push every cache-only blob into the remote. Used after the user
   * connects S3 to a device that already had media stored locally —
   * those bytes are NOT auto-migrated by `selectMediaAdapter`,
   * because the existing local store becomes the cache and reads
   * never round-trip to remote. Without this method, other devices
   * pointing at the same bucket would resolve those hashes to 404
   * and render the "media unavailable" placeholder.
   *
   * @param {{
   *   hashes?: string[] | Iterable<string>,
   *   onProgress?: (info: { index: number, total: number, hash: string, uploaded: number, skipped: number, failed: number }) => void,
   * }} [options]
   * @returns {Promise<{ checked: number, uploaded: number, skipped: number, failed: number }>}
   */
  async function backfillRemoteFromCache(options = {}) {
    const startedAt = Date.now()
    let candidates
    if (options.hashes) {
      candidates = Array.from(options.hashes)
    } else {
      const cacheHashes = await cache.listHashes()
      const remoteSet = new Set(await remote.listHashes())
      candidates = cacheHashes.filter((h) => !remoteSet.has(h))
    }
    logger.info('media.backfill.start', {
      total: candidates.length,
      explicit: Boolean(options.hashes),
    })
    const stats = {
      checked: candidates.length,
      uploaded: 0,
      skipped: 0,
      failed: 0,
    }
    for (let i = 0; i < candidates.length; i++) {
      const hash = candidates[i]
      try {
        const row = await cache.get(hash)
        if (!row?.blob) {
          stats.skipped++
        } else if (await remote.has(hash)) {
          // Lost the race: another client (or our own previous run)
          // already uploaded this hash. Treat as success-by-no-op.
          stats.skipped++
        } else {
          await remote.put(hash, row.blob, row.mime)
          stats.uploaded++
        }
      } catch (error) {
        logger.error('media.backfill.hash.failed', error, {
          hashPrefix: hp(hash),
        })
        stats.failed++
      }
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          index: i + 1,
          total: candidates.length,
          hash,
          uploaded: stats.uploaded,
          skipped: stats.skipped,
          failed: stats.failed,
        })
      }
    }
    logger.info('media.backfill.success', {
      ...stats,
      durationMs: Date.now() - startedAt,
    })
    return stats
  }

  return {
    has,
    get,
    put,
    delete: deleteHash,
    forceDeleteFromRemote,
    listHashes,
    getStats,
    listCachedHashes,
    listRemoteHashes,
    getCached,
    backfillRemoteFromCache,
  }
}
