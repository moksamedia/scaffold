/**
 * Singleton accessors for the media storage adapter and media resolver.
 *
 * Tests can swap implementations with `setMediaAdapter` / `resetMediaAdapter`
 * and `setMediaResolver` / `resetMediaResolver`.
 */

import { createMediaStorageAdapter } from './adapter.js'
import { getStorageAdapter } from '../storage/index.js'
import { createMediaResolver } from './resolver.js'
import { createOpfsMediaAdapter, isOpfsAvailable } from './opfs-adapter.js'
import { createLayeredMediaAdapter } from './layered-adapter.js'
import {
  createUserFolderMediaAdapter,
  ensureUserFolderPermission,
  isUserFolderApiAvailable,
  loadUserFolderHandle,
} from './userfolder-adapter.js'

let _adapter = null

export function getMediaAdapter() {
  if (!_adapter) {
    _adapter = createMediaStorageAdapter(getStorageAdapter)
  }
  return _adapter
}

/** @param {import('./adapter.js').MediaStorageAdapter} adapter */
export function setMediaAdapter(adapter) {
  _adapter = adapter
  resetMediaResolver()
}

export function resetMediaAdapter() {
  _adapter = null
  resetMediaResolver()
}

/**
 * Capability-based adapter selection. Selection priority:
 *   1. User-picked folder (Phase 3 opt-in, Chromium-only): if a folder
 *      handle was previously saved and still has read/write permission,
 *      use it as the primary layer with IDB underneath as a read-only
 *      fallback for any media that hasn't been moved over yet.
 *   2. OPFS (Phase 2): drop-in upgrade over IDB; layered with IDB.
 *   3. IndexedDB (Phase 1): default for browsers without OPFS.
 *
 * The probe is non-interactive: a saved user folder whose permission
 * has lapsed is detected here as "not granted" and we fall through to
 * OPFS / IDB. The Settings UI re-prompts on the next user gesture.
 *
 * Idempotent: calling twice has the same effect as calling once. Tests
 * can stub `setMediaAdapter` ahead of time to bypass this entirely.
 *
 * @param {{
 *   isOpfsAvailable?: () => boolean,
 *   createOpfs?: () => import('./adapter.js').MediaStorageAdapter,
 *   createIdb?: () => import('./adapter.js').MediaStorageAdapter,
 *   isUserFolderAvailable?: () => boolean,
 *   loadUserFolderHandle?: () => Promise<FileSystemDirectoryHandle | null>,
 *   ensureUserFolderPermission?: (handle: FileSystemDirectoryHandle, options?: { interactive?: boolean }) => Promise<string|null>,
 *   createUserFolder?: (handle: FileSystemDirectoryHandle) => import('./adapter.js').MediaStorageAdapter,
 * }} [overrides]
 * @returns {Promise<{ backend: 'userfolder+idb' | 'opfs+idb' | 'idb', error?: Error | null }>}
 */
export async function selectMediaAdapter(overrides = {}) {
  const opfsAvailable = overrides.isOpfsAvailable || isOpfsAvailable
  const createOpfs = overrides.createOpfs || (() => createOpfsMediaAdapter())
  const createIdb = overrides.createIdb || (() => createMediaStorageAdapter(getStorageAdapter))
  const userFolderAvailable = overrides.isUserFolderAvailable || isUserFolderApiAvailable
  const loadHandle = overrides.loadUserFolderHandle || loadUserFolderHandle
  const ensurePermission =
    overrides.ensureUserFolderPermission ||
    ((handle, options) => ensureUserFolderPermission(handle, options))
  const createUserFolder =
    overrides.createUserFolder || ((handle) => createUserFolderMediaAdapter(handle))

  // Tier 1: user-picked folder (opt-in, persisted handle, granted perm).
  if (userFolderAvailable()) {
    try {
      const handle = await loadHandle()
      if (handle) {
        const state = await ensurePermission(handle, { interactive: false })
        if (state === 'granted') {
          const userFolderAdapter = createUserFolder(handle)
          await userFolderAdapter.listHashes()
          const idbFallback = createIdb()
          setMediaAdapter(createLayeredMediaAdapter([userFolderAdapter, idbFallback]))
          return { backend: 'userfolder+idb', error: null }
        }
      }
    } catch (error) {
      // Fall through to OPFS / IDB and let Settings UI re-prompt later.
      console.warn('User-folder media adapter unavailable, falling back:', error)
    }
  }

  // Tier 2: OPFS layered over IDB.
  if (opfsAvailable()) {
    try {
      const opfsAdapter = createOpfs()
      await opfsAdapter.listHashes()
      const idbAdapter = createIdb()
      setMediaAdapter(createLayeredMediaAdapter([opfsAdapter, idbAdapter]))
      return { backend: 'opfs+idb', error: null }
    } catch (error) {
      // Fall through to IDB.
      const idbAdapter = createIdb()
      setMediaAdapter(idbAdapter)
      return { backend: 'idb', error }
    }
  }

  // Tier 3: IDB only.
  setMediaAdapter(createIdb())
  return { backend: 'idb', error: null }
}

let _resolver = null

export function getMediaResolver() {
  if (!_resolver) {
    _resolver = createMediaResolver(getMediaAdapter)
  }
  return _resolver
}

/** @param {ReturnType<typeof createMediaResolver>} resolver */
export function setMediaResolver(resolver) {
  _resolver = resolver
}

export function resetMediaResolver() {
  if (_resolver?.dispose) {
    try {
      _resolver.dispose()
    } catch {
      // ignore disposal errors during reset
    }
  }
  _resolver = null
}
