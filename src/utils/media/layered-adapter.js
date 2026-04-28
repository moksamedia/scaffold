/**
 * Compose multiple `MediaStorageAdapter`s into one. Reads check the
 * primary first and walk down the list; writes always go to the
 * primary. On a read miss in the primary but a hit in a fallback, the
 * row is lazily promoted to the primary so subsequent reads are fast.
 *
 * Used by the boot logic to layer OPFS over IDB so existing
 * IndexedDB-stored media survives the upgrade and migrates to OPFS on
 * first read, with no migration step the user has to wait for.
 *
 * The content-hash invariant guarantees safety: bytes are byte-identical
 * across layers, so promotion never changes meaning.
 *
 * @param {import('./adapter.js').MediaStorageAdapter[]} layers
 * @returns {import('./adapter.js').MediaStorageAdapter}
 */
export function createLayeredMediaAdapter(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error('createLayeredMediaAdapter requires at least one layer')
  }
  const [primary, ...fallbacks] = layers

  return {
    async has(hash) {
      if (await primary.has(hash)) return true
      for (const layer of fallbacks) {
        if (await layer.has(hash)) return true
      }
      return false
    },

    async get(hash) {
      const fromPrimary = await primary.get(hash)
      if (fromPrimary) return fromPrimary
      for (const layer of fallbacks) {
        const row = await layer.get(hash)
        if (!row) continue
        // Lazily promote into the primary; ignore failures (best-effort).
        try {
          await primary.put(hash, row.blob, row.mime)
        } catch {
          // primary write failed; still return the row from the fallback
        }
        return row
      }
      return null
    },

    async put(hash, blob, mime) {
      return primary.put(hash, blob, mime)
    },

    async delete(hash) {
      await primary.delete(hash).catch(() => {})
      for (const layer of fallbacks) {
        await layer.delete(hash).catch(() => {})
      }
    },

    async listHashes() {
      const set = new Set()
      for (const hash of await primary.listHashes()) set.add(hash)
      for (const layer of fallbacks) {
        for (const hash of await layer.listHashes()) set.add(hash)
      }
      return Array.from(set)
    },

    async getStats() {
      // Report the union, not the sum, so a hash counted in IDB and
      // promoted into OPFS doesn't double-count. We approximate the
      // size by taking the max reported size per layer per hash.
      const seen = new Map() // hash -> bytes
      const allLayers = [primary, ...fallbacks]
      for (const layer of allLayers) {
        const hashes = await layer.listHashes()
        for (const hash of hashes) {
          if (seen.has(hash)) continue
          const row = await layer.get(hash)
          seen.set(hash, row?.size || 0)
        }
      }
      let bytes = 0
      for (const v of seen.values()) bytes += v
      return { count: seen.size, bytes }
    },
  }
}
