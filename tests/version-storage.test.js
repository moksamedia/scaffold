import { describe, it, expect } from 'vitest'
import {
  parseVersionStorageValue,
  serializeVersionForStorage,
  VERSION_STORAGE_LZ_PREFIX,
} from 'src/utils/version-storage.js'

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
