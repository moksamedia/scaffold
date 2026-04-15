import { beforeEach, vi } from 'vitest'
import { setStorageAdapter } from 'src/utils/storage/index.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setStorageAdapter(createLocalStorageAdapter())
})

// Stub HTMLAnchorElement.click globally so download-triggering code
// doesn't crash happy-dom with URL constructor errors.
const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
  const el = origCreateElement(tag, options)
  if (tag === 'a') {
    el.click = () => {}
  }
  return el
})
