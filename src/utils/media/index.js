/**
 * Singleton accessors for the media storage adapter and media resolver.
 *
 * Tests can swap implementations with `setMediaAdapter` / `resetMediaAdapter`
 * and `setMediaResolver` / `resetMediaResolver`.
 */

import { createMediaStorageAdapter } from './adapter.js'
import { getStorageAdapter } from '../storage/index.js'
import { createMediaResolver } from './resolver.js'

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
}

export function resetMediaAdapter() {
  _adapter = null
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
