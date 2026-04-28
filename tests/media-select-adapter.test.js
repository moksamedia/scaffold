import { describe, it, expect } from 'vitest'
import {
  getMediaAdapter,
  selectMediaAdapter,
  resetMediaAdapter,
} from 'src/utils/media/index.js'

describe('selectMediaAdapter', () => {
  function makeFakeFsAdapter() {
    return {
      _puts: 0,
      _listed: false,
      _failOnList: false,
      async has() {
        return false
      },
      async get() {
        return null
      },
      async put() {
        this._puts++
      },
      async delete() {},
      async listHashes() {
        this._listed = true
        if (this._failOnList) throw new Error('quota exceeded')
        return []
      },
      async getStats() {
        return { count: 0, bytes: 0 }
      },
    }
  }

  it('falls back to the IDB-wrapped adapter when neither user folder nor OPFS is available', async () => {
    resetMediaAdapter()
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => false,
      isUserFolderAvailable: () => false,
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
    const opfs = makeFakeFsAdapter()

    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      createOpfs: () => opfs,
      isUserFolderAvailable: () => false,
    })
    expect(result.backend).toBe('opfs+idb')
    expect(opfs._listed).toBe(true)

    const adapter = getMediaAdapter()
    await adapter.put(
      'a'.repeat(64),
      new Blob([new TextEncoder().encode('x')], { type: 'text/plain' }),
      'text/plain',
    )
    expect(opfs._puts).toBe(1)
  })

  it('falls back to IDB when the OPFS probe throws', async () => {
    resetMediaAdapter()
    const opfs = makeFakeFsAdapter()
    opfs._failOnList = true
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      createOpfs: () => opfs,
      isUserFolderAvailable: () => false,
    })
    expect(result.backend).toBe('idb')
    expect(result.error).toBeInstanceOf(Error)
  })

  it('prefers user-folder adapter when handle is granted', async () => {
    resetMediaAdapter()
    const user = makeFakeFsAdapter()
    const handle = { /* fake */ }

    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      isUserFolderAvailable: () => true,
      loadUserFolderHandle: async () => handle,
      ensureUserFolderPermission: async () => 'granted',
      createUserFolder: () => user,
      createOpfs: () => {
        throw new Error('OPFS should not be called when user folder wins')
      },
    })
    expect(result.backend).toBe('userfolder+idb')
    expect(user._listed).toBe(true)
  })

  it('falls through to OPFS when user-folder permission is not granted', async () => {
    resetMediaAdapter()
    const opfs = makeFakeFsAdapter()
    const handle = {}

    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      isUserFolderAvailable: () => true,
      loadUserFolderHandle: async () => handle,
      ensureUserFolderPermission: async () => 'prompt',
      createUserFolder: () => {
        throw new Error('user folder adapter should not be created')
      },
      createOpfs: () => opfs,
    })
    expect(result.backend).toBe('opfs+idb')
    expect(opfs._listed).toBe(true)
  })

  it('falls through cleanly when no handle has been saved yet', async () => {
    resetMediaAdapter()
    const opfs = makeFakeFsAdapter()
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      isUserFolderAvailable: () => true,
      loadUserFolderHandle: async () => null,
      ensureUserFolderPermission: async () => null,
      createOpfs: () => opfs,
    })
    expect(result.backend).toBe('opfs+idb')
  })

  it('prefers S3-with-OPFS-cache when S3 config is unlocked', async () => {
    resetMediaAdapter()
    const s3Remote = makeFakeFsAdapter()
    const opfs = makeFakeFsAdapter()
    const cachingCalls = []
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      isUserFolderAvailable: () => false,
      loadS3Config: async () => ({
        publicConfig: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'b',
          prefix: 'p',
          accessKeyId: 'AK',
          mode: 'session',
        },
      }),
      getS3Credentials: () => ({ secretAccessKey: 'sk' }),
      createS3: () => s3Remote,
      createOpfs: () => opfs,
      createCachingS3: ({ remote, cache }) => {
        cachingCalls.push({ remote, cache })
        return remote
      },
    })
    expect(result.backend).toBe('s3+opfs')
    expect(cachingCalls).toHaveLength(1)
    expect(cachingCalls[0].remote).toBe(s3Remote)
    expect(cachingCalls[0].cache).toBe(opfs)
  })

  it('uses S3+IDB when OPFS is unavailable', async () => {
    resetMediaAdapter()
    const s3Remote = makeFakeFsAdapter()
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => false,
      isUserFolderAvailable: () => false,
      loadS3Config: async () => ({
        publicConfig: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'b',
          prefix: 'p',
          accessKeyId: 'AK',
          mode: 'session',
        },
      }),
      getS3Credentials: () => ({ secretAccessKey: 'sk' }),
      createS3: () => s3Remote,
      createCachingS3: ({ remote }) => remote,
    })
    expect(result.backend).toBe('s3+idb')
  })

  it('falls through to local tiers when S3 credentials are not unlocked', async () => {
    resetMediaAdapter()
    const opfs = makeFakeFsAdapter()
    const result = await selectMediaAdapter({
      isOpfsAvailable: () => true,
      isUserFolderAvailable: () => false,
      loadS3Config: async () => ({
        publicConfig: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'b',
          prefix: 'p',
          accessKeyId: 'AK',
          mode: 'persisted',
        },
      }),
      getS3Credentials: () => null,
      createS3: () => {
        throw new Error('S3 adapter must not be created without credentials')
      },
      createOpfs: () => opfs,
    })
    expect(result.backend).toBe('opfs+idb')
  })
})
