/**
 * MediaResolver — resolves `<hash>` references to blob URLs lazily,
 * caching one URL per hash for the lifetime of the resolver.
 *
 * The page-wide singleton (`getMediaResolver`) lives until reload, so a
 * single image referenced from many long notes only allocates one
 * `URL.createObjectURL` per page session.
 */

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
      const row = await adapter.get(hash)
      if (!row || !row.blob) return null
      try {
        return URL.createObjectURL(row.blob)
      } catch {
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
    for (const entry of cache.values()) {
      if (entry.url) {
        try {
          URL.revokeObjectURL(entry.url)
        } catch {
          // ignore
        }
      }
    }
    cache.clear()
  }

  return { toObjectUrl, syncUrl, ensureMany, dispose }
}
