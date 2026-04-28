import { describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  parseVersionStorageValue,
  serializeVersionForStorage,
  VERSION_STORAGE_LZ_PREFIX,
} from 'src/utils/version-storage.js'
import { useOutlineStore } from 'src/stores/outline-store.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { ingestBlob } from 'src/utils/media/ingest.js'
import { buildMediaRef, MEDIA_REF_PROTOCOL } from 'src/utils/media/references.js'

describe('parseVersionStorageValue', () => {
  it('returns null for null/empty/non-string input', () => {
    expect(parseVersionStorageValue(null)).toBeNull()
    expect(parseVersionStorageValue('')).toBeNull()
    expect(parseVersionStorageValue(undefined)).toBeNull()
    expect(parseVersionStorageValue(123)).toBeNull()
  })

  it('parses plain JSON strings', () => {
    const data = { id: 'v1', timestamp: 12345 }
    const result = parseVersionStorageValue(JSON.stringify(data))
    expect(result).toEqual(data)
  })

  it('throws on invalid plain JSON', () => {
    expect(() => parseVersionStorageValue('not json')).toThrow()
  })

  it('parses LZ-compressed strings', () => {
    const data = { id: 'v2', timestamp: 99999 }
    const serialized = serializeVersionForStorage(data, { compress: true })
    expect(serialized.startsWith(VERSION_STORAGE_LZ_PREFIX)).toBe(true)

    const result = parseVersionStorageValue(serialized)
    expect(result).toEqual(data)
  })

  it('throws for corrupt LZ payload that decompresses to non-JSON', () => {
    const corrupt = VERSION_STORAGE_LZ_PREFIX + 'garbage-not-valid-lz'
    expect(() => parseVersionStorageValue(corrupt)).toThrow()
  })

  it('returns null when LZ decompression yields null', () => {
    // Empty compressed body results in null from decompressFromUTF16
    const result = parseVersionStorageValue(VERSION_STORAGE_LZ_PREFIX)
    expect(result).toBeNull()
  })
})

describe('serializeVersionForStorage', () => {
  it('returns plain JSON when compress is false', () => {
    const data = { id: 'v1' }
    const result = serializeVersionForStorage(data, { compress: false })
    expect(result).toBe(JSON.stringify(data))
    expect(result.startsWith('{')).toBe(true)
  })

  it('returns LZ-prefixed string when compress is true', () => {
    const data = { id: 'v2', nested: { a: 1 } }
    const result = serializeVersionForStorage(data, { compress: true })
    expect(result.startsWith(VERSION_STORAGE_LZ_PREFIX)).toBe(true)
  })

  it('round-trips through serialize → parse', () => {
    const data = {
      id: 'roundtrip',
      projectId: 'proj-1',
      timestamp: Date.now(),
      data: { projects: [{ name: 'Test' }] },
    }

    const plain = serializeVersionForStorage(data, { compress: false })
    expect(parseVersionStorageValue(plain)).toEqual(data)

    const compressed = serializeVersionForStorage(data, { compress: true })
    expect(parseVersionStorageValue(compressed)).toEqual(data)
  })
})

// Asserts the major design invariant of the media-storage architecture:
// version snapshots written after the migration carry only references,
// never inline media bytes. This is what makes per-project version
// history cheap regardless of how much media a project contains.
describe('version snapshots are reference-only after migration', () => {
  it('saved version contains scaffold-media:// refs and no data: URIs', async () => {
    setActivePinia(createPinia())
    const store = useOutlineStore()
    await store.initPromise

    const { hash } = await ingestBlob(
      new Blob([new TextEncoder().encode('image-bytes')], { type: 'image/png' }),
    )

    store.createProject('Media Project')
    const project = store.currentProject
    const item = project.lists[0]
    store.addLongNote(item.id, `<img src="${buildMediaRef(hash)}">`)

    const versionId = await store.saveVersion('snapshot', 'manual')
    expect(versionId).toBeTruthy()

    const adapter = getStorageAdapter()
    const entry = await adapter.getMeta(`scaffold-version-${project.id}-${versionId}`)
    expect(entry).toBeTruthy()

    const parsed = parseVersionStorageValue(entry)
    const serialized = JSON.stringify(parsed)
    expect(serialized).toContain(MEDIA_REF_PROTOCOL)
    expect(serialized).not.toContain('data:image')
  })
})
