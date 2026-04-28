import { createIndexedDbAdapter } from './storage-adapter.js'
import { createContextScopedAdapter } from './context-scoped.js'

let _baseAdapter = null
let _scopedAdapter = null
let _activeContextId = null

function getOrCreateBaseAdapter() {
  if (!_baseAdapter) {
    _baseAdapter = createIndexedDbAdapter()
  }
  return _baseAdapter
}

/**
 * Returns the storage adapter callers should use for normal
 * persistence operations. When an active context is set, the returned
 * adapter is a context-scoped wrapper that namespaces every meta key
 * (and the projects blob) under `ctx:<contextId>:`. Without an active
 * context, the raw base adapter is returned — this is needed so that
 * cross-context primitives (the context registry, the migration
 * routine, and tests that read/write before the store hydrates) keep
 * working.
 */
export function getStorageAdapter() {
  if (!_activeContextId) return getOrCreateBaseAdapter()
  if (!_scopedAdapter) {
    _scopedAdapter = createContextScopedAdapter(getOrCreateBaseAdapter(), _activeContextId)
  }
  return _scopedAdapter
}

/**
 * Direct access to the unscoped/base adapter. Used by:
 *   - the context registry (which must live outside any one context)
 *   - the legacy → context-scoped migration
 *   - any future tooling that needs to walk all contexts at once.
 *
 * Most callers should prefer `getStorageAdapter()` and let active-
 * context scoping happen automatically.
 */
export function getBaseStorageAdapter() {
  return getOrCreateBaseAdapter()
}

/**
 * Replace the adapter singleton. Used by tests to inject a
 * localStorage-backed adapter and by future custom providers. Resets
 * the cached scoped adapter and the active context so the next caller
 * starts from a clean slate.
 *
 * @param {import('./storage-adapter.js').StorageAdapter} adapter
 */
export function setStorageAdapter(adapter) {
  _baseAdapter = adapter
  _scopedAdapter = null
  _activeContextId = null
}

/**
 * Set (or clear) the active context id. Subsequent calls to
 * `getStorageAdapter()` will return a scoped adapter that namespaces
 * its keys under this context. Pass `null` to revert to the base
 * adapter (used during early bootstrap before a context is resolved).
 *
 * @param {string | null} id
 */
export function setActiveContextId(id) {
  if (_activeContextId === id) return
  _activeContextId = id || null
  _scopedAdapter = null
}

/**
 * @returns {string | null} The currently active context id, or null
 *   when no context has been resolved yet.
 */
export function getActiveContextId() {
  return _activeContextId
}
