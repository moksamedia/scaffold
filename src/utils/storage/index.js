import { createIndexedDbAdapter } from './storage-adapter.js'

let _adapter = null

/**
 * Returns the shared IndexedDB storage adapter singleton.
 * Override with setStorageAdapter() in tests.
 */
export function getStorageAdapter() {
  if (!_adapter) {
    _adapter = createIndexedDbAdapter()
  }
  return _adapter
}

/**
 * Replace the adapter singleton (for tests or custom providers).
 * @param {import('./storage-adapter.js').StorageAdapter} adapter
 */
export function setStorageAdapter(adapter) {
  _adapter = adapter
}
