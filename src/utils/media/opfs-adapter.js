/**
 * Origin Private File System (OPFS) backed media adapter.
 *
 * OPFS lives at `navigator.storage.getDirectory()` and behaves like a
 * sandboxed local file system that no permission prompt is required for.
 * It is a clean drop-in replacement for the IndexedDB media store on
 * browsers that support it (Chrome 102+, Firefox 111+, Safari 15.2+).
 *
 * Layout:
 *   <root>/scaffold/media/<hash>           — raw bytes
 *   <root>/scaffold/media/<hash>.meta.json — { hash, mime, size, createdAt, lastUsedAt }
 *
 * The same content-hash invariant from the IDB adapter holds here, so
 * the layered adapter (`layered-adapter.js`) can lazily promote rows
 * from IDB into OPFS the first time they are read.
 */

const SCAFFOLD_DIR = 'scaffold'
const MEDIA_DIR = 'media'
const META_SUFFIX = '.meta.json'

function metaName(hash) {
  return `${hash}${META_SUFFIX}`
}

async function readJsonFromHandle(handle) {
  const file = await handle.getFile()
  const text = await file.text()
  return JSON.parse(text)
}

async function writeJsonToHandle(handle, data) {
  const stream = await handle.createWritable()
  await stream.write(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  await stream.close()
}

/**
 * Capability probe. Returns true when OPFS is reachable from this
 * realm. Tests in happy-dom return false (OPFS is not implemented),
 * which is what we want — the IDB adapter remains the default there.
 */
export function isOpfsAvailable() {
  if (typeof navigator === 'undefined') return false
  if (!navigator.storage) return false
  return typeof navigator.storage.getDirectory === 'function'
}

/**
 * Build an OPFS-backed adapter. The optional `rootHandleProvider` lets
 * tests inject an in-memory FileSystemDirectoryHandle stub.
 *
 * @param {{ rootHandleProvider?: () => Promise<FileSystemDirectoryHandle> }} [options]
 * @returns {import('./adapter.js').MediaStorageAdapter}
 */
export function createOpfsMediaAdapter(options = {}) {
  const rootHandleProvider =
    options.rootHandleProvider ||
    (() => navigator.storage.getDirectory())

  let mediaDirPromise = null

  async function getMediaDir() {
    if (!mediaDirPromise) {
      mediaDirPromise = (async () => {
        const root = await rootHandleProvider()
        const scaffold = await root.getDirectoryHandle(SCAFFOLD_DIR, { create: true })
        return scaffold.getDirectoryHandle(MEDIA_DIR, { create: true })
      })()
    }
    return mediaDirPromise
  }

  async function tryGetFileHandle(dir, name) {
    try {
      return await dir.getFileHandle(name, { create: false })
    } catch {
      return null
    }
  }

  return {
    async has(hash) {
      const dir = await getMediaDir()
      const handle = await tryGetFileHandle(dir, hash)
      return handle !== null
    },

    async get(hash) {
      const dir = await getMediaDir()
      const fileHandle = await tryGetFileHandle(dir, hash)
      if (!fileHandle) return null
      const file = await fileHandle.getFile()

      let meta = null
      const metaHandle = await tryGetFileHandle(dir, metaName(hash))
      if (metaHandle) {
        try {
          meta = await readJsonFromHandle(metaHandle)
        } catch {
          // ignore corrupt meta — fall back to file-derived defaults
        }
      }

      const mime = meta?.mime || file.type || 'application/octet-stream'
      // Re-wrap as a Blob so tests with stubbed File implementations
      // can still call `arrayBuffer()` reliably.
      const blob = new Blob([await file.arrayBuffer()], { type: mime })
      return {
        hash,
        blob,
        mime,
        size: typeof meta?.size === 'number' ? meta.size : blob.size,
        createdAt: typeof meta?.createdAt === 'number' ? meta.createdAt : 0,
        lastUsedAt: typeof meta?.lastUsedAt === 'number' ? meta.lastUsedAt : 0,
      }
    },

    async put(hash, blob, mime) {
      const dir = await getMediaDir()
      const now = Date.now()

      // Preserve createdAt across re-puts so the GC grace window is
      // measured from first ingest, not last write.
      let createdAt = now
      const existingMetaHandle = await tryGetFileHandle(dir, metaName(hash))
      if (existingMetaHandle) {
        try {
          const existing = await readJsonFromHandle(existingMetaHandle)
          if (typeof existing?.createdAt === 'number') createdAt = existing.createdAt
        } catch {
          // ignore corrupt meta
        }
      }

      const fileHandle = await dir.getFileHandle(hash, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()

      const metaHandle = await dir.getFileHandle(metaName(hash), { create: true })
      await writeJsonToHandle(metaHandle, {
        hash,
        mime: mime || blob.type || 'application/octet-stream',
        size: typeof blob.size === 'number' ? blob.size : 0,
        createdAt,
        lastUsedAt: now,
      })
    },

    async delete(hash) {
      const dir = await getMediaDir()
      try {
        await dir.removeEntry(hash)
      } catch {
        // ignore "not found"
      }
      try {
        await dir.removeEntry(metaName(hash))
      } catch {
        // ignore "not found"
      }
    },

    async listHashes() {
      const dir = await getMediaDir()
      const out = []
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue
        if (name.endsWith(META_SUFFIX)) continue
        out.push(name)
      }
      return out
    },

    async getStats() {
      const dir = await getMediaDir()
      let count = 0
      let bytes = 0
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue
        if (name.endsWith(META_SUFFIX)) continue
        count++
        try {
          const file = await handle.getFile()
          bytes += file.size || 0
        } catch {
          // skip files we can't open
        }
      }
      return { count, bytes }
    },
  }
}
