import { describe, it, expect } from 'vitest'
import {
  getMediaAdapter,
  selectMediaAdapter,
  resetMediaAdapter,
} from 'src/utils/media/index.js'

describe('selectMediaAdapter', () => {
  it('falls back to the IDB-wrapped adapter when OPFS is unavailable', async () => {
    resetMediaAdapter()
    const result = await selectMediaAdapter({
      isAvailable: () => false,
      createOpfs: () => {
        throw new Error('should not be called')
      },
    })
    expect(result.backend).toBe('idb')

    const adapter = getMediaAdapter()
    expect(adapter).toBeTruthy()
    expect(typeof adapter.put).toBe('function')
  })

  it('uses a layered OPFS+IDB adapter when OPFS is available and probe succeeds', async () => {
    resetMediaAdapter()
    let opfsListed = false
    let opfsPut = 0
    const opfs = {
      has: async () => false,
      get: async () => null,
      put: async () => {
        opfsPut += 1
      },
      delete: async () => {},
      listHashes: async () => {
        opfsListed = true
        return []
      },
      getStats: async () => ({ count: 0, bytes: 0 }),
    }

    const result = await selectMediaAdapter({
      isAvailable: () => true,
      createOpfs: () => opfs,
    })
    expect(result.backend).toBe('opfs+idb')
    expect(opfsListed).toBe(true)

    // Writes should now route to OPFS (the primary in the layered adapter).
    const adapter = getMediaAdapter()
    await adapter.put(
      'a'.repeat(64),
      new Blob([new TextEncoder().encode('x')], { type: 'text/plain' }),
      'text/plain',
    )
    expect(opfsPut).toBe(1)
  })

  it('falls back to IDB when the OPFS probe throws', async () => {
    resetMediaAdapter()
    const opfs = {
      has: async () => false,
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      listHashes: async () => {
        throw new Error('quota exceeded')
      },
      getStats: async () => ({ count: 0, bytes: 0 }),
    }
    const result = await selectMediaAdapter({
      isAvailable: () => true,
      createOpfs: () => opfs,
    })
    expect(result.backend).toBe('idb')
    expect(result.error).toBeInstanceOf(Error)
  })
})
