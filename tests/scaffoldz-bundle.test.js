/**
 * `.scaffoldz` bundle round-trip tests. Builds a bundle from a project
 * with embedded media references, parses it back, and asserts:
 *   - manifest is a normal JSON export envelope (no `media` map)
 *   - media bytes live as separate `media/<hash>` entries
 *   - import re-ingests media into the local adapter and keeps existing
 *     warnings flowing
 *   - zip-magic sniff lets us auto-detect the bundle format
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setMediaAdapter, getMediaAdapter } from 'src/utils/media/index.js'
import { createMediaStorageAdapter } from 'src/utils/media/adapter.js'
import { setStorageAdapter } from 'src/utils/storage/index.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'
import { sha256Hex } from 'src/utils/media/hash.js'
import {
  buildScaffoldzBundle,
  importScaffoldzBundle,
  isZipMagic,
} from 'src/utils/export/scaffoldz.js'
import { parseZip } from 'src/utils/export/zip.js'

async function freshAdapters() {
  // localStorage is shared globally; wipe it so a "fresh" adapter
  // really starts empty.
  localStorage.clear()
  const storage = createLocalStorageAdapter()
  setStorageAdapter(storage)
  setMediaAdapter(createMediaStorageAdapter(() => storage))
}

function makeProjectWithMedia(hashes) {
  const note = hashes
    .map(
      (h, i) =>
        `<p>${i % 2 === 0 ? '<img' : '<audio controls'} src="scaffold-media://${h}" /></p>`,
    )
    .join('')
  return {
    id: 'p1',
    name: 'Project With Media',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    rootListType: 'unordered',
    settings: {},
    lists: [
      {
        id: 'i1',
        kind: 'item',
        text: 'item one',
        listType: 'unordered',
        children: [],
        longNotes: [{ id: 'n1', text: note }],
      },
    ],
  }
}

describe('scaffoldz bundle round-trip', () => {
  beforeEach(async () => {
    await freshAdapters()
  })

  it('emits a zip whose first bytes match the PK\\003\\004 magic', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const adapter = getMediaAdapter()
    const hash = await sha256Hex(bytes)
    await adapter.put(hash, new Blob([bytes], { type: 'image/png' }), 'image/png')

    const project = makeProjectWithMedia([hash])
    const bundle = await buildScaffoldzBundle([project], 'p1')
    expect(bundle).toBeInstanceOf(Uint8Array)
    expect(isZipMagic(bundle)).toBe(true)
  })

  it('writes outline.json + media/<hash> + media/<hash>.meta.json', async () => {
    const bytes = new Uint8Array([7, 8, 9])
    const adapter = getMediaAdapter()
    const hash = await sha256Hex(bytes)
    await adapter.put(hash, new Blob([bytes], { type: 'image/png' }), 'image/png')

    const project = makeProjectWithMedia([hash])
    const bundle = await buildScaffoldzBundle([project], 'p1')
    const entries = parseZip(bundle)
    const paths = entries.map((e) => e.path).sort()
    expect(paths).toEqual([
      `media/${hash}`,
      `media/${hash}.meta.json`,
      'outline.json',
    ])

    const manifest = JSON.parse(
      new TextDecoder().decode(entries.find((e) => e.path === 'outline.json').data),
    )
    expect(manifest.formatVersion).toBeTruthy()
    expect(manifest.application).toBe('Scaffold')
    expect(manifest.media).toBeUndefined() // bytes live as separate files

    const meta = JSON.parse(
      new TextDecoder().decode(entries.find((e) => e.path.endsWith('.meta.json')).data),
    )
    expect(meta.mime).toBe('image/png')
    expect(meta.size).toBe(3)
  })

  it('re-ingests media on import even if the local adapter starts empty', async () => {
    const bytes = new Uint8Array([42, 43, 44])
    let adapter = getMediaAdapter()
    const hash = await sha256Hex(bytes)
    await adapter.put(hash, new Blob([bytes], { type: 'audio/mpeg' }), 'audio/mpeg')
    const project = makeProjectWithMedia([hash])
    const bundle = await buildScaffoldzBundle([project], 'p1')

    // Reset adapters so the import has to repopulate the media store.
    await freshAdapters()
    adapter = getMediaAdapter()
    expect(await adapter.has(hash)).toBe(false)

    const result = await importScaffoldzBundle(bundle)
    expect(result.projects).toHaveLength(1)
    expect(result.importedMediaCount).toBe(1)
    expect(await adapter.has(hash)).toBe(true)
    const stored = await adapter.get(hash)
    expect(stored.mime).toBe('audio/mpeg')
    expect(stored.size).toBe(bytes.length)
  })

  it('rejects a bundle missing outline.json', async () => {
    const { createZip } = await import('src/utils/export/zip.js')
    const bogus = createZip([{ path: 'unrelated.txt', data: 'no manifest' }])
    await expect(importScaffoldzBundle(bogus)).rejects.toThrow(/outline\.json/)
  })

  it('isZipMagic distinguishes JSON from zip bytes', () => {
    const json = new TextEncoder().encode('{"hello":"world"}')
    expect(isZipMagic(json)).toBe(false)
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa])
    expect(isZipMagic(zipHead)).toBe(true)
  })
})
