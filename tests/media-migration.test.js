import { describe, it, expect } from 'vitest'
import {
  runMediaMigration,
  migrateProjectsToReferences,
  migrateVersionsToReferences,
} from 'src/utils/media/migration.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { sha256Hex } from 'src/utils/media/hash.js'
import { dataUrlToBlob } from 'src/utils/media/ingest.js'
import { MEDIA_REF_PROTOCOL, buildMediaRef } from 'src/utils/media/references.js'

const PNG_DATA = 'data:image/png;base64,aGVsbG8='
const MP3_DATA = 'data:audio/mpeg;base64,d29ybGQ='

async function expectedHashFor(dataUrl) {
  const { blob } = dataUrlToBlob(dataUrl)
  return sha256Hex(blob)
}

describe('migrateProjectsToReferences', () => {
  it('rewrites long-note data: URIs to scaffold-media references and ingests blobs', async () => {
    const storage = getStorageAdapter()
    const html = `<p>before</p><img src="${PNG_DATA}"><audio src="${MP3_DATA}"></audio>`
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [
          {
            longNotes: [{ text: html }],
            children: [],
          },
        ],
      },
    ])

    const result = await migrateProjectsToReferences()
    expect(result.anyChanged).toBe(true)

    const projects = await storage.loadProjects()
    const note = projects[0].lists[0].longNotes[0].text
    expect(note).not.toContain('data:image/png')
    expect(note).not.toContain('data:audio/mpeg')
    expect(note).toContain(MEDIA_REF_PROTOCOL)

    const expectedPng = await expectedHashFor(PNG_DATA)
    const expectedMp3 = await expectedHashFor(MP3_DATA)
    const adapter = getMediaAdapter()
    expect(await adapter.has(expectedPng)).toBe(true)
    expect(await adapter.has(expectedMp3)).toBe(true)
  })

  it('is idempotent: re-running migration is a no-op', async () => {
    const storage = getStorageAdapter()
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [{ longNotes: [{ text: `<img src="${PNG_DATA}">` }], children: [] }],
      },
    ])

    const first = await migrateProjectsToReferences()
    expect(first.anyChanged).toBe(true)
    const second = await migrateProjectsToReferences()
    expect(second.anyChanged).toBe(false)
  })

  it('leaves projects without media untouched', async () => {
    const storage = getStorageAdapter()
    await storage.saveProjects([
      { id: 'p1', lists: [{ longNotes: [{ text: '<p>plain text</p>' }], children: [] }] },
    ])
    const result = await migrateProjectsToReferences()
    expect(result.anyChanged).toBe(false)
  })

  it('preserves existing scaffold-media references and only rewrites data URIs', async () => {
    const expectedPng = await expectedHashFor(PNG_DATA)
    const existingRef = buildMediaRef('e'.repeat(64))
    const storage = getStorageAdapter()
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [
          {
            longNotes: [
              {
                text:
                  `<img src="${existingRef}">` +
                  `<img src="${PNG_DATA}">`,
              },
            ],
            children: [],
          },
        ],
      },
    ])

    await migrateProjectsToReferences()
    const projects = await storage.loadProjects()
    const note = projects[0].lists[0].longNotes[0].text
    expect(note).toContain(existingRef)
    expect(note).toContain(buildMediaRef(expectedPng))
  })
})

describe('migrateVersionsToReferences', () => {
  it('rewrites data URIs in version snapshots stored in meta', async () => {
    const storage = getStorageAdapter()
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
                {
                  longNotes: [{ text: `<img src="${PNG_DATA}">` }],
                  children: [],
                },
              ],
            },
          ],
        },
      }),
    )

    const result = await migrateVersionsToReferences()
    expect(result.migratedVersionCount).toBe(1)

    const raw = await storage.getMeta('scaffold-version-p1-v1')
    const parsed = JSON.parse(raw)
    const note = parsed.data.projects[0].items[0].longNotes[0].text
    expect(note).not.toContain('data:image/png')
    expect(note).toContain(MEDIA_REF_PROTOCOL)
  })

  it('skips malformed JSON entries quietly', async () => {
    const storage = getStorageAdapter()
    await storage.setMeta('scaffold-version-bad', '{not-json')
    const result = await migrateVersionsToReferences()
    expect(result.migratedVersionCount).toBe(0)
  })
})

describe('runMediaMigration', () => {
  it('runs both migrations and returns combined counts', async () => {
    const storage = getStorageAdapter()
    await storage.saveProjects([
      {
        id: 'p1',
        lists: [{ longNotes: [{ text: `<img src="${PNG_DATA}">` }], children: [] }],
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
              items: [{ longNotes: [{ text: `<audio src="${MP3_DATA}"></audio>` }], children: [] }],
            },
          ],
        },
      }),
    )

    const result = await runMediaMigration()
    expect(result.migratedProjectCount).toBe(1)
    expect(result.migratedVersionCount).toBe(1)
  })
})
