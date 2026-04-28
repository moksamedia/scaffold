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
 * Capability-based adapter selection. Prefers OPFS when reachable
 * (Chrome 102+, Firefox 111+, Safari 15.2+), falling back to the
 * IndexedDB adapter otherwise. When OPFS is selected the result is a
 * layered adapter: writes go to OPFS, reads check OPFS first and
 * lazily promote IDB-stored bytes on a primary miss. This makes the
 * upgrade transparent to existing users — their previous uploads
 * remain readable and migrate to OPFS the first time they're touched.
 *
 * Idempotent: calling twice has the same effect as calling once. Tests
 * can stub `setMediaAdapter` ahead of time to bypass this entirely.
 *
 * @param {{ isAvailable?: () => boolean, createOpfs?: () => import('./adapter.js').MediaStorageAdapter, createIdb?: () => import('./adapter.js').MediaStorageAdapter }} [overrides]
 * @returns {Promise<{ backend: 'opfs' | 'opfs+idb' | 'idb', error?: Error | null }>}
 */
export async function selectMediaAdapter(overrides = {}) {
  const isAvailable = overrides.isAvailable || isOpfsAvailable
  const createOpfs = overrides.createOpfs || (() => createOpfsMediaAdapter())
  const createIdb = overrides.createIdb || (() => createMediaStorageAdapter(getStorageAdapter))

  if (!isAvailable()) {
    setMediaAdapter(createIdb())
    return { backend: 'idb', error: null }
  }

  let opfsAdapter
  try {
    opfsAdapter = createOpfs()
    // Probe by listing hashes — cheap and forces OPFS root resolution.
    await opfsAdapter.listHashes()
  } catch (error) {
    setMediaAdapter(createIdb())
    return { backend: 'idb', error }
  }

  const idbAdapter = createIdb()
  setMediaAdapter(createLayeredMediaAdapter([opfsAdapter, idbAdapter]))
  return { backend: 'opfs+idb', error: null }
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
