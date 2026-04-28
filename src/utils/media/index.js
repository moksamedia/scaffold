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
import { createS3MediaAdapter } from './s3-adapter.js'
import { createCachingMediaAdapter } from './cached-adapter.js'
import { getS3Credentials, loadS3Config } from './s3-config.js'

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
 *   1. S3-compatible remote (Phase 4 opt-in): if a config is saved and
 *      credentials are unlocked in memory, use S3 as the durable
 *      backend with a local cache (OPFS or IDB) in front for speed
 *      and offline reads.
 *   2. User-picked folder (Phase 3 opt-in, Chromium-only): if a folder
 *      handle was previously saved and still has read/write permission,
 *      use it as the primary layer with IDB underneath as a read-only
 *      fallback for any media that hasn't been moved over yet.
 *   3. OPFS (Phase 2): drop-in upgrade over IDB; layered with IDB.
 *   4. IndexedDB (Phase 1): default for browsers without OPFS.
 *
 * The probe is non-interactive: a saved user folder whose permission
 * has lapsed (or an S3 config without unlocked credentials) is detected
 * here as "unavailable" and we fall through to lower tiers. The
 * Settings UI re-prompts on the next user gesture.
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
 *   loadS3Config?: () => Promise<{ publicConfig: object } | null>,
 *   getS3Credentials?: () => object | null,
 *   createS3?: (config: object) => import('./adapter.js').MediaStorageAdapter,
 *   createCachingS3?: (params: { remote: object, cache: object }) => import('./adapter.js').MediaStorageAdapter,
 * }} [overrides]
 * @returns {Promise<{ backend: 's3+opfs' | 's3+idb' | 'userfolder+idb' | 'opfs+idb' | 'idb', error?: Error | null }>}
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
  const loadS3 = overrides.loadS3Config || loadS3Config
  const readS3Credentials = overrides.getS3Credentials || getS3Credentials
  const buildS3 = overrides.createS3 || ((config) => createS3MediaAdapter(config))
  const buildCachingS3 =
    overrides.createCachingS3 ||
    ((params) => createCachingMediaAdapter(params))

  // #region agent log
  fetch('http://127.0.0.1:7652/ingest/aa926f98-514d-4a15-a6d3-0b9951fec4e7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'53352e'},body:JSON.stringify({sessionId:'53352e',hypothesisId:'A',location:'media/index.js:selectMediaAdapter:enter',message:'selectMediaAdapter called',data:{stack:new Error().stack?.split('\n').slice(1,6).join(' | ')},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  // Tier 1: S3-compatible remote with local read-through cache.
  try {
    const stored = await loadS3()
    const credentials = readS3Credentials()
    // #region agent log
    fetch('http://127.0.0.1:7652/ingest/aa926f98-514d-4a15-a6d3-0b9951fec4e7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'53352e'},body:JSON.stringify({sessionId:'53352e',hypothesisId:'A',location:'media/index.js:selectMediaAdapter:s3-check',message:'S3 tier inputs',data:{hasStored:!!stored,hasPublicConfig:!!stored?.publicConfig,publicConfigMode:stored?.publicConfig?.mode,bucket:stored?.publicConfig?.bucket,endpoint:stored?.publicConfig?.endpoint,hasCredentials:!!credentials,hasSecret:!!credentials?.secretAccessKey,sharedBucket:Boolean(stored?.publicConfig?.sharedBucket)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (stored?.publicConfig && credentials?.secretAccessKey) {
      const sharedBucket = Boolean(stored.publicConfig.sharedBucket)
      const remote = buildS3({
        ...stored.publicConfig,
        ...credentials,
        sharedBucket,
      })
      let cache
      let backend
      if (opfsAvailable()) {
        try {
          const opfsAdapter = createOpfs()
          await opfsAdapter.listHashes()
          cache = opfsAdapter
          backend = 's3+opfs'
        } catch {
          cache = createIdb()
          backend = 's3+idb'
        }
      } else {
        cache = createIdb()
        backend = 's3+idb'
      }
      setMediaAdapter(buildCachingS3({ remote, cache, localGcOnly: sharedBucket }))
      // #region agent log
      fetch('http://127.0.0.1:7652/ingest/aa926f98-514d-4a15-a6d3-0b9951fec4e7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'53352e'},body:JSON.stringify({sessionId:'53352e',hypothesisId:'A',location:'media/index.js:selectMediaAdapter:s3-installed',message:'Cached S3 adapter installed',data:{backend,sharedBucket},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return { backend, error: null }
    }
  } catch (error) {
    // Fall through to lower tiers when the S3 config is unreadable.
    console.warn('S3 media adapter unavailable, falling back:', error)
    // #region agent log
    fetch('http://127.0.0.1:7652/ingest/aa926f98-514d-4a15-a6d3-0b9951fec4e7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'53352e'},body:JSON.stringify({sessionId:'53352e',hypothesisId:'D',location:'media/index.js:selectMediaAdapter:s3-error',message:'S3 tier threw',data:{error:String(error?.message||error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }

  // Tier 2: user-picked folder (opt-in, persisted handle, granted perm).
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

  // Tier 3: OPFS layered over IDB.
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

  // Tier 4: IDB only.
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
