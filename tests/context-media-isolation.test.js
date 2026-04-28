import { describe, it, expect } from 'vitest'
import {
  collectLiveMediaHashes,
  collectLiveMediaHashesExcludingProject,
  runMediaGc,
} from 'src/utils/media/gc.js'
import {
  getBaseStorageAdapter,
  setActiveContextId,
} from 'src/utils/storage/index.js'
import { setMediaAdapter, resetMediaAdapter } from 'src/utils/media/index.js'
import {
  cloneContextData,
  createContext,
  ensureDefaultContext,
} from 'src/utils/context/session.js'
import { buildMediaRef } from 'src/utils/media/references.js'

// Hashes must match the `[0-9a-f]{64}` regex used by
// extractRefHashesFromHtml, so we use a hex-letter-only suffix
// instead of arbitrary mnemonic letters.
const HASH_DEFAULT_ONLY = 'd'.repeat(64)
const HASH_PERSONAL_ONLY = 'a'.repeat(64)
const HASH_SHARED = 'b'.repeat(64)
const HASH_VERSION_ONLY = 'c'.repeat(64)
const HASH_DOOMED_PROJECT = 'e'.repeat(64)

function projectsBlobWith(hashes) {
  return JSON.stringify(
    hashes.map((h, i) => ({
      id: `p-${h.slice(0, 4)}-${i}`,
      name: 'P',
      lists: [
        {
          id: `i-${i}`,
          kind: 'item',
          text: '',
          children: [],
          longNotes: [{ id: `ln-${i}`, text: `<img src="${buildMediaRef(h)}">` }],
        },
      ],
    })),
  )
}

function versionEntryWith(projectId, hash) {
  return JSON.stringify({
    id: 'v1',
    projectId,
    timestamp: 1,
    data: {
      formatVersion: '1.0',
      projects: [
        {
          id: projectId,
          items: [
            {
              id: 'vi',
              kind: 'item',
              longNotes: [{ id: 'vn', text: `<img src="${buildMediaRef(hash)}">` }],
              children: [],
            },
          ],
        },
      ],
    },
  })
}

async function seedTwoContexts() {
  await ensureDefaultContext()
  const personal = await createContext('Personal')
  const base = getBaseStorageAdapter()

  // Default context references HASH_DEFAULT_ONLY + HASH_SHARED.
  await base.setMeta(
    'ctx:default:projects',
    projectsBlobWith([HASH_DEFAULT_ONLY, HASH_SHARED]),
  )
  // Default context has a version snapshot referencing HASH_VERSION_ONLY.
  await base.setMeta(
    'ctx:default:scaffold-version-p-default-v1',
    versionEntryWith('p-default', HASH_VERSION_ONLY),
  )

  // Personal context references HASH_PERSONAL_ONLY + HASH_SHARED.
  await base.setMeta(
    `ctx:${personal.id}:projects`,
    projectsBlobWith([HASH_PERSONAL_ONLY, HASH_SHARED]),
  )

  return { personal }
}

function makeFakeMediaAdapter(initial) {
  const blobs = new Map()
  for (const hash of initial) {
    blobs.set(hash, {
      hash,
      blob: new Blob([new Uint8Array(8)]),
      mime: 'image/png',
      size: 8,
      createdAt: 0,
      lastUsedAt: 0,
    })
  }
  const log = { deleted: [] }
  return {
    log,
    blobs,
    has: async (h) => blobs.has(h),
    get: async (h) => blobs.get(h) || null,
    put: async () => {},
    delete: async (h) => {
      log.deleted.push(h)
      blobs.delete(h)
    },
    listHashes: async () => Array.from(blobs.keys()),
    getStats: async () => ({ count: blobs.size, bytes: 0 }),
  }
}

describe('media GC across contexts', () => {
  it('collectLiveMediaHashes unions live sets from every registered context', async () => {
    await seedTwoContexts()
    const live = await collectLiveMediaHashes()
    expect(live.has(HASH_DEFAULT_ONLY)).toBe(true)
    expect(live.has(HASH_PERSONAL_ONLY)).toBe(true)
    expect(live.has(HASH_SHARED)).toBe(true)
    expect(live.has(HASH_VERSION_ONLY)).toBe(true)
  })

  it('falls back to legacy unprefixed layout when no context registry exists', async () => {
    // Simulate pre-migration state: legacy projects + version entries
    // sit at the unprefixed root and there is no `scaffold-contexts`
    // registry yet.
    const base = getBaseStorageAdapter()
    await base.saveProjects([
      {
        id: 'legacy',
        name: 'Legacy',
        lists: [
          {
            id: 'i',
            kind: 'item',
            text: '',
            children: [],
            longNotes: [{ id: 'n', text: `<img src="${buildMediaRef(HASH_DEFAULT_ONLY)}">` }],
          },
        ],
      },
    ])

    const live = await collectLiveMediaHashes()
    expect(live.has(HASH_DEFAULT_ONLY)).toBe(true)
  })

  it('runMediaGc does not delete media that only another context references', async () => {
    // Seed two contexts and PIN the active context to "default", as a
    // running app would after `setActiveContextId('default')`.
    const { personal } = await seedTwoContexts()
    setActiveContextId('default')

    // The shared media store contains all four hashes.
    const fake = makeFakeMediaAdapter([
      HASH_DEFAULT_ONLY,
      HASH_PERSONAL_ONLY,
      HASH_SHARED,
      HASH_VERSION_ONLY,
    ])
    setMediaAdapter(fake)
    try {
      const stats = await runMediaGc({ now: Date.now(), graceMs: 0 })
      // Nothing should have been deleted: every hash is live in
      // *some* context. The bug this guards against is a context
      // switch followed by GC wiping out the other context's media.
      expect(fake.log.deleted).toEqual([])
      expect(stats.deleted).toBe(0)
      expect(stats.kept).toBe(4)
      expect(personal.id).toBeTruthy()
    } finally {
      resetMediaAdapter()
      setActiveContextId(null)
    }
  })

  it('runMediaGc still deletes hashes that no context references', async () => {
    await seedTwoContexts()
    setActiveContextId('default')

    const ORPHAN = 'f'.repeat(64)
    const fake = makeFakeMediaAdapter([
      HASH_DEFAULT_ONLY,
      HASH_PERSONAL_ONLY,
      HASH_SHARED,
      HASH_VERSION_ONLY,
      ORPHAN,
    ])
    setMediaAdapter(fake)
    try {
      const stats = await runMediaGc({ now: Date.now(), graceMs: 0 })
      expect(fake.log.deleted).toEqual([ORPHAN])
      expect(stats.deleted).toBe(1)
    } finally {
      resetMediaAdapter()
      setActiveContextId(null)
    }
  })
})

describe('collectLiveMediaHashesExcludingProject', () => {
  it('excludes the targeted project but keeps every other context+version hash live', async () => {
    await ensureDefaultContext()
    const base = getBaseStorageAdapter()

    // Default context: doomed project (will be excluded) and one survivor.
    await base.setMeta(
      'ctx:default:projects',
      JSON.stringify([
        {
          id: 'doomed',
          name: 'Doomed',
          lists: [
            {
              id: 'i1',
              kind: 'item',
              text: '',
              children: [],
              longNotes: [
                { id: 'n1', text: `<img src="${buildMediaRef(HASH_DOOMED_PROJECT)}">` },
              ],
            },
          ],
        },
        {
          id: 'survivor',
          name: 'Survivor',
          lists: [
            {
              id: 'i2',
              kind: 'item',
              text: '',
              children: [],
              longNotes: [
                { id: 'n2', text: `<img src="${buildMediaRef(HASH_SHARED)}">` },
              ],
            },
          ],
        },
      ]),
    )
    // Default context's version snapshot of the doomed project still
    // references the doomed-only hash. The orphan calculation must
    // count this as live (the snapshot is preserved separately).
    await base.setMeta(
      'ctx:default:scaffold-version-doomed-v1',
      versionEntryWith('doomed', HASH_DOOMED_PROJECT),
    )

    // A second context references HASH_DOOMED_PROJECT independently.
    const personal = await createContext('Personal')
    await base.setMeta(
      `ctx:${personal.id}:projects`,
      projectsBlobWith([HASH_DOOMED_PROJECT]),
    )

    const live = await collectLiveMediaHashesExcludingProject('doomed')
    // HASH_SHARED comes from the surviving sibling project.
    expect(live.has(HASH_SHARED)).toBe(true)
    // HASH_DOOMED_PROJECT survives twice over: in the version
    // snapshot (default context) and in the personal context's
    // active project.
    expect(live.has(HASH_DOOMED_PROJECT)).toBe(true)
  })

  it('returns empty when no context registry exists', async () => {
    const live = await collectLiveMediaHashesExcludingProject('whatever')
    expect(live.size).toBe(0)
  })
})

describe('cross-context cloning preserves shared media reachability', () => {
  it('cloneContextData makes refs in the clone count toward the live set', async () => {
    await ensureDefaultContext()
    const base = getBaseStorageAdapter()
    await base.setMeta(
      'ctx:default:projects',
      projectsBlobWith([HASH_DEFAULT_ONLY]),
    )

    const cloned = await createContext('Clone', { cloneFromId: 'default' })
    // Now delete the source-context's projects and verify that the
    // clone still keeps the hash live — proves cloning produced an
    // independent live reference, not a pointer to the source.
    await base.setMeta('ctx:default:projects', JSON.stringify([]))

    const live = await collectLiveMediaHashes()
    expect(live.has(HASH_DEFAULT_ONLY)).toBe(true)
    expect(cloned.id).toBeTruthy()
  })
})
