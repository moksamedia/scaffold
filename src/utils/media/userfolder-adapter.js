/**
 * User-picked folder media adapter (Chromium-only, opt-in).
 *
 * Backed by `showDirectoryPicker()`: the user explicitly selects a
 * folder on their disk where Scaffold should write media files. The
 * resulting `FileSystemDirectoryHandle` is persisted in IndexedDB
 * (handles are structured-cloneable in supported browsers) so it
 * survives reloads, and a permission re-request happens lazily on the
 * next user gesture.
 *
 * Layout matches the OPFS adapter so the on-disk shape is portable:
 *   <chosen-folder>/scaffold/media/<hash>
 *   <chosen-folder>/scaffold/media/<hash>.meta.json
 */

import { createOpfsMediaAdapter } from './opfs-adapter.js'
import { getActiveContextId, getStorageAdapter } from '../storage/index.js'

// Marker key written into the meta store. The wrapping
// context-scoped adapter automatically prefixes this with
// `ctx:<contextId>:`, so each context has its own marker.
const HANDLE_META_KEY = 'media-userfolder-handle'

// Key used inside the private `scaffoldHandles` IndexedDB to retrieve
// the actual `FileSystemDirectoryHandle`. We include the active
// context id so that each context's chosen folder handle stays
// isolated from the others.
function buildHandleStoreKey() {
  const contextId = getActiveContextId() || 'default'
  return `${HANDLE_META_KEY}:${contextId}`
}

export function isUserFolderApiAvailable() {
  if (typeof window === 'undefined') return false
  return typeof window.showDirectoryPicker === 'function'
}

/**
 * Prompt the user to pick a writable folder and persist the resulting
 * directory handle in IDB meta. Must be invoked from a user gesture.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickUserFolder() {
  if (!isUserFolderApiAvailable()) {
    throw new Error('Your browser does not support choosing a folder for media storage.')
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await persistUserFolderHandle(handle)
  return handle
}

async function persistUserFolderHandle(handle) {
  const storage = getStorageAdapter()
  const storeKey = buildHandleStoreKey()
  // The IDB meta store accepts string values; the easiest way to keep
  // a handle there without changing the schema is to wrap it through
  // an out-of-band `setMeta` extension in the future. For now we go
  // through a private object store on the existing scaffoldDb.
  await openHandleStore().then(async (db) => {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('userfolder-handle', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore('userfolder-handle').put({ key: storeKey, handle })
    })
  })
  // Drop a marker in the regular meta store so other tabs/components
  // can detect that a user folder is configured without opening the
  // private object store. The marker key is automatically scoped to
  // the active context by the context-scoped storage adapter.
  await storage.setMeta(HANDLE_META_KEY, '1')
}

/**
 * Read a previously stored directory handle, or null if none was saved.
 *
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function loadUserFolderHandle() {
  if (!isUserFolderApiAvailable()) return null
  const storage = getStorageAdapter()
  const marker = await storage.getMeta(HANDLE_META_KEY)
  if (!marker) return null
  const storeKey = buildHandleStoreKey()
  try {
    const db = await openHandleStore()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('userfolder-handle', 'readonly')
      const req = tx.objectStore('userfolder-handle').get(storeKey)
      req.onsuccess = () => resolve(req.result?.handle || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function clearUserFolderHandle() {
  const storage = getStorageAdapter()
  await storage.deleteMeta(HANDLE_META_KEY)
  const storeKey = buildHandleStoreKey()
  try {
    const db = await openHandleStore()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('userfolder-handle', 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore('userfolder-handle').delete(storeKey)
    })
  } catch {
    // best-effort: marker is already cleared, the handle row leaks at most
  }
}

/**
 * Ensure the saved handle still has read/write permission. Returns the
 * permission state ('granted' | 'denied' | 'prompt') or null if there
 * is no handle / the API is unavailable. When `interactive` is true
 * AND we're in a user gesture, this will trigger the permission prompt.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @param {{ interactive?: boolean }} [options]
 * @returns {Promise<'granted' | 'denied' | 'prompt' | null>}
 */
export async function ensureUserFolderPermission(handle, options = {}) {
  if (!handle || typeof handle.queryPermission !== 'function') return null
  const current = await handle.queryPermission({ mode: 'readwrite' })
  if (current === 'granted') return 'granted'
  if (!options.interactive) return current
  if (typeof handle.requestPermission !== 'function') return current
  return handle.requestPermission({ mode: 'readwrite' })
}

/**
 * Build a media adapter backed by the user's chosen folder. Internally
 * reuses the OPFS adapter implementation since the File System Access
 * API surface is identical — only the root handle differs.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @returns {import('./adapter.js').MediaStorageAdapter}
 */
export function createUserFolderMediaAdapter(handle) {
  if (!handle) throw new Error('createUserFolderMediaAdapter: handle is required')
  return createOpfsMediaAdapter({
    rootHandleProvider: async () => handle,
  })
}

// Internal: open a tiny secondary IndexedDB database that holds the
// directory handle. We cannot store a FileSystemDirectoryHandle in the
// main `scaffoldDb` v2 meta store because that store has `keyPath: 'key'`
// and JSON-stringifies values; handles must round-trip via structured
// clone, which means a dedicated record shape. A private DB keeps the
// schema upgrade story simple.
function openHandleStore() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('scaffoldHandles', 1)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('userfolder-handle')) {
        db.createObjectStore('userfolder-handle', { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
