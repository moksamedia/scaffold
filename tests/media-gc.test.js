import { describe, it, expect } from 'vitest'
import { runMediaGc, collectLiveMediaHashes } from 'src/utils/media/gc.js'
import { ingestBlob } from 'src/utils/media/ingest.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { buildMediaRef } from 'src/utils/media/references.js'
import { sha256Hex } from 'src/utils/media/hash.js'

async function ingestText(text) {
  const blob = new Blob([new TextEncoder().encode(text)], { type: 'text/plain' })
  return ingestBlob(blob)
}

describe('collectLiveMediaHashes', () => {
  it('finds hashes referenced in any project list and any version snapshot', async () => {
    const { hash: hashA } = await ingestText('image-a')
    const { hash: hashB } = await ingestText('audio-b')
    const { hash: hashC } = await ingestText('image-c')

    const storage = getStorageAdapter()
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [
          { longNotes: [{ text: `<img src="${buildMediaRef(hashA)}">` }], children: [] },
        ],
      },
    ])

    await storage.setMeta(
      'scaffold-version-p1-v1',
      JSON.stringify({
        id: 'v1',
        timestamp: 1,
        data: {
          projects: [
            {
              id: 'p1',
              items: [
                { longNotes: [{ text: `<audio src="${buildMediaRef(hashB)}"></audio>` }], children: [] },
              ],
            },
          ],
        },
      }),
    )

    const live = await collectLiveMediaHashes()
    expect(live.has(hashA)).toBe(true)
    expect(live.has(hashB)).toBe(true)
    expect(live.has(hashC)).toBe(false)
  })
})

describe('runMediaGc', () => {
  it('deletes blobs that are not referenced and outside the grace window', async () => {
    const { hash: live } = await ingestText('still-live')
    const { hash: dead } = await ingestText('orphan-blob')

    const storage = getStorageAdapter()
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [
          { longNotes: [{ text: `<img src="${buildMediaRef(live)}">` }], children: [] },
        ],
      },
    ])

    const farFuture = Date.now() + 1000 * 60 * 60 * 48
    const stats = await runMediaGc({ now: farFuture })

    expect(stats.deleted).toBe(1)
    expect(stats.kept).toBe(1)

    const adapter = getMediaAdapter()
    expect(await adapter.has(live)).toBe(true)
    expect(await adapter.has(dead)).toBe(false)
  })

  it('respects the grace window for recently-uploaded blobs', async () => {
    await ingestText('fresh-orphan')
    const stats = await runMediaGc()
    expect(stats.deleted).toBe(0)
    expect(stats.skippedByGrace).toBe(1)
  })

  it('keeps blobs referenced only by version history (not in projects)', async () => {
    const { hash } = await ingestText('only-in-version')
    const storage = getStorageAdapter()
    await storage.saveProjects([{ id: 'p1', lists: [] }])
    await storage.setMeta(
      'scaffold-version-p1-v1',
      JSON.stringify({
        id: 'v1',
        timestamp: 1,
        data: {
          projects: [
            {
              id: 'p1',
              items: [
                { longNotes: [{ text: `<img src="${buildMediaRef(hash)}">` }], children: [] },
              ],
            },
          ],
        },
      }),
    )

    const farFuture = Date.now() + 1000 * 60 * 60 * 48
    const stats = await runMediaGc({ now: farFuture })
    expect(stats.kept).toBe(1)
    expect(stats.deleted).toBe(0)
  })

  it('treats unreferenced blob as garbage even when version snapshot exists for the same project', async () => {
    const { hash: orphan } = await ingestText('orphan-with-other-versions')
    // Add a hash via sha256Hex that isn't actually stored - it shouldn't matter
    const phantom = await sha256Hex(new TextEncoder().encode('phantom'))

    const storage = getStorageAdapter()
    await storage.saveProjects([{ id: 'p1', lists: [] }])
    await storage.setMeta(
      'scaffold-version-p1-v1',
      JSON.stringify({
        id: 'v1',
        timestamp: 1,
        data: { projects: [{ id: 'p1', items: [{ longNotes: [{ text: `<img src="${buildMediaRef(phantom)}">` }], children: [] }] }] },
      }),
    )

    const farFuture = Date.now() + 1000 * 60 * 60 * 48
    const stats = await runMediaGc({ now: farFuture })
    expect(stats.deleted).toBe(1)

    const adapter = getMediaAdapter()
    expect(await adapter.has(orphan)).toBe(false)
  })
})
