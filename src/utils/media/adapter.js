/**
 * MediaStorageAdapter — pluggable backing store for content-addressable
 * media blobs. The default implementation delegates to whatever
 * StorageAdapter is currently active (IndexedDB in production,
 * localStorage in tests), but the interface is intentionally narrow so
 * future backends (OPFS, user-picked folder, S3) can be substituted via
 * `setMediaAdapter()`.
 *
 * @typedef {Object} MediaRow
 * @property {string} hash
 * @property {Blob} blob
 * @property {string} mime
 * @property {number} size
 * @property {number} createdAt
 * @property {number} lastUsedAt
 *
 * @typedef {Object} MediaStorageAdapter
 * @property {(hash: string) => Promise<boolean>} has
 * @property {(hash: string) => Promise<MediaRow | null>} get
 * @property {(hash: string, blob: Blob, mime?: string) => Promise<void>} put
 * @property {(hash: string) => Promise<void>} delete
 * @property {() => Promise<string[]>} listHashes
 * @property {() => Promise<{count: number, bytes: number}>} getStats
 */

import { logger } from '../logging/logger.js'

function hp(hash) {
  return typeof hash === 'string' ? hash.slice(0, 12) : null
}

/**
 * Wrap a StorageAdapter so it presents the MediaStorageAdapter interface.
 *
 * @param {() => import('../storage/storage-adapter.js').StorageAdapter} getStorageAdapter
 * @returns {MediaStorageAdapter}
 */
export function createMediaStorageAdapter(getStorageAdapter) {
  return {
    async has(hash) {
      return getStorageAdapter().hasMedia(hash)
    },
    async get(hash) {
      return getStorageAdapter().getMedia(hash)
    },
    async put(hash, blob, mime) {
      try {
        const result = await getStorageAdapter().putMedia(hash, blob, mime)
        logger.debug('media.idb.put.success', {
          hashPrefix: hp(hash),
          sizeBytes: blob?.size,
          mime: mime || blob?.type || null,
        })
        return result
      } catch (error) {
        logger.error('media.idb.put.failed', error, {
          hashPrefix: hp(hash),
          sizeBytes: blob?.size,
          mime: mime || blob?.type || null,
        })
        throw error
      }
    },
    async delete(hash) {
      try {
        const result = await getStorageAdapter().deleteMedia(hash)
        logger.debug('media.idb.delete', { hashPrefix: hp(hash) })
        return result
      } catch (error) {
        logger.error('media.idb.delete.failed', error, {
          hashPrefix: hp(hash),
        })
        throw error
      }
    },
    async listHashes() {
      return getStorageAdapter().listMediaHashes()
    },
    async getStats() {
      return getStorageAdapter().getMediaStats()
    },
  }
}
