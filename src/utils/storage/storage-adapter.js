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
 */

/**
 * Create a localStorage-backed storage adapter.
 * This wraps the existing localStorage persistence with the adapter interface.
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
  }
}

const DB_NAME = 'scaffoldDb'
const DB_VERSION = 1
const PROJECTS_STORE = 'projects'
const META_STORE = 'meta'

function openDb(indexedDB = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
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
  }
}
