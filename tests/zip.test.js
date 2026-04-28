/**
 * STORED-only ZIP reader/writer round-trips. Verifies the archives we
 * emit can be read back by our parser (closing the loop), and that
 * structural invariants (CRC32, magic numbers, central directory
 * pointers) are correct enough that real zip tools would also accept
 * the output.
 */

import { describe, it, expect } from 'vitest'
import { createZip, parseZip, crc32 } from 'src/utils/export/zip.js'

const PK_LOCAL_FILE_MAGIC = 0x04034b50

describe('crc32', () => {
  it('matches the canonical "123456789" check value', () => {
    const bytes = new TextEncoder().encode('123456789')
    expect(crc32(bytes)).toBe(0xcbf43926)
  })

  it('crc32 of empty input is 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('createZip / parseZip', () => {
  it('round-trips a single text entry', () => {
    const zip = createZip([{ path: 'hello.txt', data: 'hi there' }])
    expect(zip).toBeInstanceOf(Uint8Array)
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(0, true)).toBe(PK_LOCAL_FILE_MAGIC)

    const entries = parseZip(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('hello.txt')
    expect(new TextDecoder().decode(entries[0].data)).toBe('hi there')
  })

  it('round-trips multiple entries including binary data', () => {
    const binary = new Uint8Array(256)
    for (let i = 0; i < binary.length; i++) binary[i] = i

    const zip = createZip([
      { path: 'outline.json', data: JSON.stringify({ hello: 'world' }) },
      { path: 'media/abc', data: binary },
      { path: 'media/abc.meta.json', data: JSON.stringify({ mime: 'image/png', size: 256 }) },
    ])

    const entries = parseZip(zip)
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.data]))
    expect(JSON.parse(new TextDecoder().decode(byPath['outline.json']))).toEqual({
      hello: 'world',
    })
    expect(byPath['media/abc']).toEqual(binary)
    expect(JSON.parse(new TextDecoder().decode(byPath['media/abc.meta.json']))).toEqual({
      mime: 'image/png',
      size: 256,
    })
  })

  it('preserves UTF-8 in entry filenames', () => {
    const zip = createZip([{ path: 'note-é-音.json', data: '{}' }])
    const entries = parseZip(zip)
    expect(entries[0].path).toBe('note-é-音.json')
  })

  it('rejects entries with empty paths', () => {
    expect(() => createZip([{ path: '', data: '' }])).toThrow()
  })

  it('rejects parsing a non-zip blob', () => {
    expect(() => parseZip(new Uint8Array([0, 1, 2, 3]))).toThrow(
      /end-of-central-directory/,
    )
  })
})
