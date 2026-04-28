/**
 * Storage adapter interface for Scaffold persistence.
 *
 * Both localStorage and IndexedDB providers must conform to this contract.
 * Methods are async to accommodate IndexedDB's asynchronous API —
 * the localStorage implementation resolves synchronously inside Promises.
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<object[]>} loadProjects
 * @property {(projects: object[]) => Promise<void>} saveProjects
 * @property {(id: string) => Promise<object|null>} getProject
 * @property {(project: object) => Promise<void>} saveProject
 * @property {(id: string) => Promise<void>} deleteProject
 * @property {() => Promise<{used: number, quota: number}>} getStorageStats
 * @property {(key: string) => Promise<string|null>} getMeta
 * @property {(key: string, value: string) => Promise<void>} setMeta
 * @property {(key: string) => Promise<void>} deleteMeta
 * @property {(prefix: string) => Promise<{key: string, value: string}[]>} getMetaEntries
 *
 *  -- Media (content-addressable blob store) --
 * @property {(hash: string, blob: Blob, mime?: string) => Promise<void>} putMedia
 * @property {(hash: string) => Promise<{hash: string, blob: Blob, mime: string, size: number, createdAt: number, lastUsedAt: number}|null>} getMedia
 * @property {(hash: string) => Promise<boolean>} hasMedia
 * @property {(hash: string) => Promise<void>} deleteMedia
 * @property {() => Promise<string[]>} listMediaHashes
 * @property {() => Promise<{count: number, bytes: number}>} getMediaStats
 */

const MEDIA_PREFIX = 'scaffold-media-'

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Create a localStorage-backed storage adapter.
 * Used as the test adapter and for legacy migration scenarios.
 */
export function createLocalStorageAdapter() {
  const META_PREFIX = 'scaffold-meta-'

  return {
    async loadProjects() {
      const raw = localStorage.getItem('outline-projects')
      if (!raw) return []
      return JSON.parse(raw)
    },

    async saveProjects(projects) {
      localStorage.setItem('outline-projects', JSON.stringify(projects))
    },

    async getProject(id) {
      const projects = await this.loadProjects()
      return projects.find((p) => p.id === id) || null
    },

    async saveProject(project) {
      const projects = await this.loadProjects()
      const idx = projects.findIndex((p) => p.id === project.id)
      if (idx >= 0) {
        projects[idx] = project
      } else {
        projects.push(project)
      }
      await this.saveProjects(projects)
    },

    async deleteProject(id) {
      const projects = await this.loadProjects()
      const filtered = projects.filter((p) => p.id !== id)
      await this.saveProjects(filtered)
    },

    async getStorageStats() {
      let used = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        const value = localStorage.getItem(key)
        if (value) used += key.length + value.length
      }
      return { used: used * 2, quota: 5 * 1024 * 1024 }
    },

    async getMeta(key) {
      return localStorage.getItem(`${META_PREFIX}${key}`)
    },

    async setMeta(key, value) {
      localStorage.setItem(`${META_PREFIX}${key}`, value)
    },

    async deleteMeta(key) {
      localStorage.removeItem(`${META_PREFIX}${key}`)
    },

    async getMetaEntries(prefix) {
      const fullPrefix = `${META_PREFIX}${prefix}`
      const entries = []
      for (let i = 0; i < localStorage.length; i++) {
        const lsKey = localStorage.key(i)
        if (lsKey && lsKey.startsWith(fullPrefix)) {
          entries.push({
            key: lsKey.slice(META_PREFIX.length),
            value: localStorage.getItem(lsKey),
          })
        }
      }
      return entries
    },

    async putMedia(hash, blob, mime) {
      const buffer = await blob.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)
      const now = Date.now()
      let createdAt = now
      const existingRaw = localStorage.getItem(`${MEDIA_PREFIX}${hash}`)
      if (existingRaw) {
        try {
          const existing = JSON.parse(existingRaw)
          if (typeof existing.createdAt === 'number') {
            createdAt = existing.createdAt
          }
        } catch {
          // ignore corrupt entry; will overwrite
        }
      }
      const record = {
        hash,
        mime: mime || blob.type || 'application/octet-stream',
        size: blob.size,
        base64,
        createdAt,
        lastUsedAt: now,
      }
      localStorage.setItem(`${MEDIA_PREFIX}${hash}`, JSON.stringify(record))
    },

    async getMedia(hash) {
      const raw = localStorage.getItem(`${MEDIA_PREFIX}${hash}`)
      if (!raw) return null
      try {
        const record = JSON.parse(raw)
        const bytes = base64ToBytes(record.base64)
        const blob = new Blob([bytes], { type: record.mime || 'application/octet-stream' })
        return {
          hash: record.hash || hash,
          blob,
          mime: record.mime || blob.type,
          size: typeof record.size === 'number' ? record.size : blob.size,
          createdAt: record.createdAt || 0,
          lastUsedAt: record.lastUsedAt || 0,
        }
      } catch {
        return null
      }
    },

    async hasMedia(hash) {
      return localStorage.getItem(`${MEDIA_PREFIX}${hash}`) !== null
    },

    async deleteMedia(hash) {
      localStorage.removeItem(`${MEDIA_PREFIX}${hash}`)
    },

    async listMediaHashes() {
      const out = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(MEDIA_PREFIX)) {
          out.push(k.slice(MEDIA_PREFIX.length))
        }
      }
      return out
    },

    async getMediaStats() {
      let count = 0
      let bytes = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith(MEDIA_PREFIX)) continue
        count++
        try {
          const record = JSON.parse(localStorage.getItem(k))
          if (record && typeof record.size === 'number') {
            bytes += record.size
          }
        } catch {
          // ignore corrupt entries
        }
      }
      return { count, bytes }
    },
  }
}

const DB_NAME = 'scaffoldDb'
const DB_VERSION = 2
const PROJECTS_STORE = 'projects'
const META_STORE = 'meta'
const MEDIA_STORE = 'media'

function openDb(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      const oldVersion = event.oldVersion || 0

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' })
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          const store = db.createObjectStore(MEDIA_STORE, { keyPath: 'hash' })
          store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbTransaction(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode)
    const result = work(tx)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'))
  })
}

/**
 * Create an IndexedDB-backed storage adapter.
 * @param {IDBFactory} [indexedDB] - Override for testing with fake-indexeddb
 */
export function createIndexedDbAdapter(indexedDB) {
  let dbPromise = null

  function getDb() {
    if (!dbPromise) {
      dbPromise = openDb(indexedDB)
    }
    return dbPromise
  }

  return {
    async loadProjects() {
      const db = await getDb()
      return idbTransaction(db, PROJECTS_STORE, 'readonly', (tx) => {
        const store = tx.objectStore(PROJECTS_STORE)
        const req = store.getAll()
        return new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result)
        })
      })
    },

    async saveProjects(projects) {
      const db = await getDb()
      await idbTransaction(db, PROJECTS_STORE, 'readwrite', (tx) => {
        const store = tx.objectStore(PROJECTS_STORE)
        store.clear()
        for (const project of projects) {
          store.put(project)
        }
      })
    },

    async getProject(id) {
      const db = await getDb()
      const tx = db.transaction(PROJECTS_STORE, 'readonly')
      const result = await idbRequest(tx.objectStore(PROJECTS_STORE).get(id))
      return result || null
    },

    async saveProject(project) {
      const db = await getDb()
      await idbTransaction(db, PROJECTS_STORE, 'readwrite', (tx) => {
        tx.objectStore(PROJECTS_STORE).put(project)
      })
    },

    async deleteProject(id) {
      const db = await getDb()
      await idbTransaction(db, PROJECTS_STORE, 'readwrite', (tx) => {
        tx.objectStore(PROJECTS_STORE).delete(id)
      })
    },

    async getStorageStats() {
      if (navigator?.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        return { used: estimate.usage || 0, quota: estimate.quota || 0 }
      }
      return { used: 0, quota: 0 }
    },

    async getMeta(key) {
      const db = await getDb()
      const tx = db.transaction(META_STORE, 'readonly')
      const record = await idbRequest(tx.objectStore(META_STORE).get(key))
      return record ? record.value : null
    },

    async setMeta(key, value) {
      const db = await getDb()
      await idbTransaction(db, META_STORE, 'readwrite', (tx) => {
        tx.objectStore(META_STORE).put({ key, value })
      })
    },

    async deleteMeta(key) {
      const db = await getDb()
      await idbTransaction(db, META_STORE, 'readwrite', (tx) => {
        tx.objectStore(META_STORE).delete(key)
      })
    },

    async getMetaEntries(prefix) {
      const db = await getDb()
      return idbTransaction(db, META_STORE, 'readonly', (tx) => {
        const store = tx.objectStore(META_STORE)
        const req = store.getAll()
        return new Promise((resolve) => {
          req.onsuccess = () => {
            const all = req.result || []
            resolve(
              all
                .filter((r) => r.key.startsWith(prefix))
                .map((r) => ({ key: r.key, value: r.value })),
            )
          }
        })
      })
    },

    async putMedia(hash, blob, mime) {
      // Serialize the bytes up front. Storing ArrayBuffer (rather than
      // Blob directly) gives us identical behavior across real browsers,
      // fake-indexeddb in tests, and any future structured-clone-light
      // backends. The cost is one extra ArrayBuffer materialization per
      // write, which dominates only for very large uploads.
      const buffer = await blob.arrayBuffer()
      const db = await getDb()
      return idbTransaction(db, MEDIA_STORE, 'readwrite', (tx) => {
        const store = tx.objectStore(MEDIA_STORE)
        const getReq = store.get(hash)
        return new Promise((resolve, reject) => {
          getReq.onsuccess = () => {
            const existing = getReq.result
            const now = Date.now()
            const record = {
              hash,
              buffer,
              mime: mime || blob.type || 'application/octet-stream',
              size: typeof blob.size === 'number' ? blob.size : buffer.byteLength,
              createdAt: existing?.createdAt || now,
              lastUsedAt: now,
            }
            const putReq = store.put(record)
            putReq.onsuccess = () => resolve()
            putReq.onerror = () => reject(putReq.error)
          }
          getReq.onerror = () => reject(getReq.error)
        })
      })
    },

    async getMedia(hash) {
      const db = await getDb()
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const record = await idbRequest(tx.objectStore(MEDIA_STORE).get(hash))
      if (!record) return null

      const mime = record.mime || record.blob?.type || 'application/octet-stream'
      let blob
      if (record.buffer) {
        blob = new Blob([record.buffer], { type: mime })
      } else if (record.blob) {
        blob = record.blob
      } else {
        return null
      }

      return {
        hash: record.hash,
        blob,
        mime,
        size: typeof record.size === 'number' ? record.size : blob.size || 0,
        createdAt: record.createdAt || 0,
        lastUsedAt: record.lastUsedAt || 0,
      }
    },

    async hasMedia(hash) {
      const db = await getDb()
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const result = await idbRequest(tx.objectStore(MEDIA_STORE).getKey(hash))
      return result !== undefined
    },

    async deleteMedia(hash) {
      const db = await getDb()
      await idbTransaction(db, MEDIA_STORE, 'readwrite', (tx) => {
        tx.objectStore(MEDIA_STORE).delete(hash)
      })
    },

    async listMediaHashes() {
      const db = await getDb()
      const tx = db.transaction(MEDIA_STORE, 'readonly')
      const keys = await idbRequest(tx.objectStore(MEDIA_STORE).getAllKeys())
      return Array.isArray(keys) ? keys : []
    },

    async getMediaStats() {
      const db = await getDb()
      return idbTransaction(db, MEDIA_STORE, 'readonly', (tx) => {
        const store = tx.objectStore(MEDIA_STORE)
        const req = store.getAll()
        return new Promise((resolve) => {
          req.onsuccess = () => {
            const records = req.result || []
            let bytes = 0
            for (const record of records) {
              if (record && typeof record.size === 'number') {
                bytes += record.size
              } else if (record?.blob?.size) {
                bytes += record.blob.size
              }
            }
            resolve({ count: records.length, bytes })
          }
        })
      })
    },
  }
}
