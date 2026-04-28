/**
 * MediaResolver — resolves `<hash>` references to blob URLs lazily,
 * caching one URL per hash for the lifetime of the resolver.
 *
 * The page-wide singleton (`getMediaResolver`) lives until reload, so a
 * single image referenced from many long notes only allocates one
 * `URL.createObjectURL` per page session.
 */

import { logger } from '../logging/logger.js'

function hp(hash) {
  return typeof hash === 'string' ? hash.slice(0, 12) : null
}

/**
 * @param {() => import('./adapter.js').MediaStorageAdapter} getAdapter
 */
export function createMediaResolver(getAdapter) {
  /** @type {Map<string, {url: string|null, ready: Promise<string|null>}>} */
  const cache = new Map()

  function syncUrl(hash) {
    return cache.get(hash)?.url || null
  }

  async function toObjectUrl(hash) {
    if (!hash || typeof hash !== 'string') return null
    if (cache.has(hash)) {
      return cache.get(hash).ready
    }
    const ready = (async () => {
      const adapter = getAdapter()
      let row
      try {
        row = await adapter.get(hash)
      } catch (error) {
        logger.error('media.resolver.adapter.get.failed', error, {
          hashPrefix: hp(hash),
        })
        return null
      }
      if (!row || !row.blob) {
        logger.debug('media.resolver.unresolved', { hashPrefix: hp(hash) })
        return null
      }
      try {
        return URL.createObjectURL(row.blob)
      } catch (error) {
        logger.error('media.resolver.createObjectUrl.failed', error, {
          hashPrefix: hp(hash),
        })
        return null
      }
    })()
    const entry = { url: null, ready }
    cache.set(hash, entry)
    const url = await ready
    entry.url = url
    return url
  }

  async function ensureMany(hashes) {
    const unique = Array.from(new Set(hashes || []))
    await Promise.all(unique.map((h) => toObjectUrl(h)))
  }

  function dispose() {
    let revoked = 0
    for (const entry of cache.values()) {
      if (entry.url) {
        try {
          URL.revokeObjectURL(entry.url)
          revoked += 1
        } catch {
          // ignore
        }
      }
    }
    cache.clear()
    logger.debug('media.resolver.disposed', { revoked })
  }

  return { toObjectUrl, syncUrl, ensureMany, dispose }
}
