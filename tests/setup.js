import { beforeEach, vi } from 'vitest'
import { setStorageAdapter } from 'src/utils/storage/index.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'
import { resetMediaAdapter, resetMediaResolver } from 'src/utils/media/index.js'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setStorageAdapter(createLocalStorageAdapter())
  resetMediaAdapter()
  resetMediaResolver()
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

// happy-dom does not provide URL.createObjectURL/revokeObjectURL by default
// for Blob inputs in some versions. Provide deterministic stubs so resolver
// and renderer tests can verify behavior.
let blobUrlCounter = 0
const blobUrlMap = new Map()
if (!('createObjectURL' in URL)) {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob) => {
      const id = `blob:scaffold/${++blobUrlCounter}`
      blobUrlMap.set(id, blob)
      return id
    },
  })
}
if (!('revokeObjectURL' in URL)) {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url) => {
      blobUrlMap.delete(url)
    },
  })
}
