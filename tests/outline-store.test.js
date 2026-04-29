import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOutlineStore, DEFAULT_NEW_LIST_ITEM_TEXT } from 'src/stores/outline-store.js'
import { makeProject, makeItem, makeDivider, makeLegacyProject } from './fixtures/projects.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { setMediaAdapter, resetMediaAdapter } from 'src/utils/media/index.js'

const META_PREFIX = 'scaffold-meta-'

function seedStore(projectsArray) {
  localStorage.setItem('outline-projects', JSON.stringify(projectsArray))
  if (projectsArray.length > 0) {
    localStorage.setItem(`${META_PREFIX}current-project`, projectsArray[0].id)
  }
}

async function getStore() {
  const store = useOutlineStore()
  await store.initPromise
  return store
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('Outline Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── Project CRUD ────────────────────────────────────────────────
  describe('project lifecycle', () => {
    it('creates an example project when storage is empty', async () => {
      const store = await getStore()
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
      expect(store.currentProjectId).toBeTruthy()
    })

    it('createProject adds a new project with defaults', async () => {
      const store = await getStore()
      const before = store.projects.length
      const project = await store.createProject('New')
      expect(store.projects.length).toBe(before + 1)
      expect(project.name).toBe('New')
      expect(project.rootListType).toBe('ordered')
      expect(project.settings.indentSize).toBe(32)
    })

    it('createProject uses program-wide defaults from storage', async () => {
      const adapter = getStorageAdapter()
      await adapter.setMeta(
        'program-settings',
        JSON.stringify({ defaultListType: 'unordered', defaultIndentSize: 48 }),
      )
      const store = await getStore()
      const project = await store.createProject('Custom')
      expect(project.rootListType).toBe('unordered')
      expect(project.settings.indentSize).toBe(48)
    })

    it('deleteProject removes the project and updates current', async () => {
      const p1 = makeProject({ id: 'p1', name: 'One' })
      const p2 = makeProject({ id: 'p2', name: 'Two' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')
      const store = await getStore()
      store.deleteProject('p1')

      expect(store.projects.find((p) => p.id === 'p1')).toBeUndefined()
      expect(store.currentProjectId).toBe('p2')
    })

    it('renameProject updates name and updatedAt', async () => {
      const p = makeProject({ id: 'p1', name: 'Old' })
      seedStore([p])
      const store = await getStore()
      store.renameProject('p1', 'New Name')

      expect(store.projects[0].name).toBe('New Name')
    })

    it('selectProject switches current project and syncs settings', async () => {
      const p1 = makeProject({ id: 'p1', settings: { nonTibetanFontSize: 18, indentSize: 40 } })
      const p2 = makeProject({ id: 'p2', settings: { nonTibetanFontSize: 22, indentSize: 50 } })
      seedStore([p1, p2])
      const store = await getStore()

      store.selectProject('p2')
      expect(store.currentProjectId).toBe('p2')
      expect(store.indentSize).toBe(50)
    })

    it('selectProject returns false when project is locked by other tab', async () => {
      const p1 = makeProject({ id: 'p1' })
      const p2 = makeProject({ id: 'p2' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')

      localStorage.setItem(
        'scaffold-project-lock-p2',
        JSON.stringify({ holderTabId: 'other-tab', heartbeatAt: Date.now() }),
      )
      const store = await getStore()
      const result = store.selectProject('p2')
      expect(result).toBe(false)
      expect(store.projectLockBlockedProjectId).toBe('p2')
    })
  })

  // ─── Orphan-media computation & shared-bucket delete prompt ───────
  describe('findOrphanedMediaForProjectRemoval', () => {
    function withLongNoteHashes(itemOverrides, hashes) {
      return makeItem({
        ...itemOverrides,
        longNotes: hashes.map((h, i) => ({
          id: `${itemOverrides.id || 'note'}-${i}`,
          text: `<p>see <img src="scaffold-media://${h}" /></p>`,
          collapsed: false,
        })),
      })
    }

    async function seedAndOpen(projectsArr) {
      seedStore(projectsArr)
      return getStore()
    }

    const HASH_A = 'a'.repeat(64)
    const HASH_B = 'b'.repeat(64)
    const HASH_C = 'c'.repeat(64)

    it('returns hashes referenced only by the deleted project', async () => {
      const targetProject = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_A])],
      })
      const otherProject = makeProject({ id: 'other', lists: [] })
      const store = await seedAndOpen([targetProject, otherProject])

      const orphans = await store.findOrphanedMediaForProjectRemoval('target')
      expect(Array.from(orphans)).toEqual([HASH_A])
    })

    it('excludes hashes also referenced by another project', async () => {
      const target = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_A, HASH_B])],
      })
      const other = makeProject({
        id: 'other',
        lists: [withLongNoteHashes({ id: 'i2' }, [HASH_B])],
      })
      const store = await seedAndOpen([target, other])

      const orphans = await store.findOrphanedMediaForProjectRemoval('target')
      expect(Array.from(orphans).sort()).toEqual([HASH_A])
    })

    it('excludes hashes only referenced by the deleted project version snapshot', async () => {
      const target = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_A])],
      })
      const store = await seedAndOpen([target])

      // Persist a version snapshot for `target` that references HASH_A.
      const adapter = getStorageAdapter()
      const versionPayload = {
        id: 'v1',
        projectId: 'target',
        timestamp: 1700000000000,
        data: {
          formatVersion: '1.0',
          projects: [
            {
              id: 'target',
              name: 'target',
              items: [
                {
                  id: 'i1',
                  kind: 'item',
                  text: 'x',
                  longNotes: [
                    {
                      id: 'ln1',
                      text: `<img src="scaffold-media://${HASH_A}" />`,
                    },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      }
      await adapter.setMeta('scaffold-version-target-v1', JSON.stringify(versionPayload))

      const orphans = await store.findOrphanedMediaForProjectRemoval('target')
      // HASH_A is still held by the persisted version snapshot.
      expect(orphans.size).toBe(0)
    })

    it("excludes hashes also referenced by another project's version snapshot", async () => {
      const target = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_C])],
      })
      const other = makeProject({ id: 'other', lists: [] })
      const store = await seedAndOpen([target, other])

      const adapter = getStorageAdapter()
      const versionPayload = {
        id: 'v1',
        projectId: 'other',
        timestamp: 1700000000000,
        data: {
          formatVersion: '1.0',
          projects: [
            {
              id: 'other',
              name: 'other',
              items: [
                {
                  id: 'oi',
                  kind: 'item',
                  text: 'x',
                  longNotes: [
                    {
                      id: 'oln',
                      text: `<img src="scaffold-media://${HASH_C}" />`,
                    },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      }
      await adapter.setMeta('scaffold-version-other-v1', JSON.stringify(versionPayload))

      const orphans = await store.findOrphanedMediaForProjectRemoval('target')
      expect(orphans.size).toBe(0)
    })

    it('returns empty for unknown project ids', async () => {
      const store = await seedAndOpen([makeProject({ id: 'p1' })])
      const orphans = await store.findOrphanedMediaForProjectRemoval('does-not-exist')
      expect(orphans.size).toBe(0)
    })

    it('deleteProject({ purgeRemoteMedia: true }) calls forceDeleteFromRemote for orphans only', async () => {
      const target = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_A, HASH_B])],
      })
      const other = makeProject({
        id: 'other',
        lists: [withLongNoteHashes({ id: 'i2' }, [HASH_B])],
      })
      const store = await seedAndOpen([target, other])

      const purged = []
      const fakeMediaAdapter = {
        has: async () => false,
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [],
        getStats: async () => ({ count: 0, bytes: 0 }),
        forceDeleteFromRemote: async (hash) => {
          purged.push(hash)
        },
      }
      setMediaAdapter(fakeMediaAdapter)

      try {
        await store.deleteProject('target', { purgeRemoteMedia: true })
        expect(store.projects.find((p) => p.id === 'target')).toBeUndefined()
        expect(purged.sort()).toEqual([HASH_A])
      } finally {
        resetMediaAdapter()
      }
    })

    it('deleteProject without purgeRemoteMedia never touches forceDeleteFromRemote', async () => {
      const target = makeProject({
        id: 'target',
        lists: [withLongNoteHashes({ id: 'i1' }, [HASH_A])],
      })
      const store = await seedAndOpen([target])

      const purged = []
      setMediaAdapter({
        has: async () => false,
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [],
        getStats: async () => ({ count: 0, bytes: 0 }),
        forceDeleteFromRemote: async (hash) => {
          purged.push(hash)
        },
      })

      try {
        await store.deleteProject('target')
        expect(purged).toEqual([])
      } finally {
        resetMediaAdapter()
      }
    })

    it('purgeRemoteMediaHashes is a no-op when the adapter lacks forceDeleteFromRemote', async () => {
      const store = await seedAndOpen([makeProject({ id: 'p' })])
      setMediaAdapter({
        has: async () => false,
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [],
        getStats: async () => ({ count: 0, bytes: 0 }),
      })
      try {
        await expect(
          store.purgeRemoteMediaHashes(['x'.repeat(64)]),
        ).resolves.toBeUndefined()
      } finally {
        resetMediaAdapter()
      }
    })
  })

  // ─── Local-to-remote backfill (post-S3-connect) ──────────────────
  describe('media backfill helpers', () => {
    const HASH_LOCAL = 'd'.repeat(64)
    const HASH_SHARED = 'e'.repeat(64)
    const HASH_REMOTE = 'f'.repeat(64)

    function withLongNoteHashes(itemOverrides, hashes) {
      return makeItem({
        ...itemOverrides,
        longNotes: hashes.map((h, i) => ({
          id: `${itemOverrides.id || 'note'}-${i}`,
          text: `<p><img src="scaffold-media://${h}" /></p>`,
          collapsed: false,
        })),
      })
    }

    function makeFakeS3Adapter({ cache = [], remote = [] } = {}) {
      const cacheSet = new Set(cache)
      const remoteSet = new Set(remote)
      const calls = { backfillCalls: [] }
      return {
        adapter: {
          has: async (h) => cacheSet.has(h) || remoteSet.has(h),
          get: async () => null,
          put: async () => {},
          delete: async () => {},
          listHashes: async () => Array.from(remoteSet),
          getStats: async () => ({ count: remoteSet.size, bytes: 0 }),
          listCachedHashes: async () => Array.from(cacheSet),
          listRemoteHashes: async () => Array.from(remoteSet),
          backfillRemoteFromCache: async ({ hashes } = {}) => {
            const candidates = hashes
              ? Array.from(hashes)
              : Array.from(cacheSet).filter((h) => !remoteSet.has(h))
            calls.backfillCalls.push(candidates.slice())
            let uploaded = 0
            for (const h of candidates) {
              if (cacheSet.has(h) && !remoteSet.has(h)) {
                remoteSet.add(h)
                uploaded++
              }
            }
            return {
              checked: candidates.length,
              uploaded,
              skipped: candidates.length - uploaded,
              failed: 0,
            }
          },
        },
        calls,
        cacheSet,
        remoteSet,
      }
    }

    it('mediaBackendSupportsRemoteSync is false on local-only backends', async () => {
      const store = useOutlineStore()
      await store.initPromise
      // Default IDB-style adapter does not expose backfill methods.
      expect(store.mediaBackendSupportsRemoteSync()).toBe(false)
    })

    it('returns empty unsynced sets on local-only backends', async () => {
      seedStore([makeProject({ id: 'p1', lists: [withLongNoteHashes({ id: 'i' }, [HASH_LOCAL])] })])
      const store = await getStore()
      const all = await store.getAllUnsyncedMedia()
      const perProject = await store.getUnsyncedMediaForProject('p1')
      expect(all.size).toBe(0)
      expect(perProject.size).toBe(0)
    })

    it('getAllUnsyncedMedia returns cache hashes that are not on remote', async () => {
      seedStore([makeProject({ id: 'p' })])
      const store = await getStore()
      const fake = makeFakeS3Adapter({
        cache: [HASH_LOCAL, HASH_SHARED],
        remote: [HASH_SHARED, HASH_REMOTE],
      })
      setMediaAdapter(fake.adapter)
      try {
        expect(store.mediaBackendSupportsRemoteSync()).toBe(true)
        const result = await store.getAllUnsyncedMedia()
        expect(Array.from(result)).toEqual([HASH_LOCAL])
      } finally {
        resetMediaAdapter()
      }
    })

    it('getUnsyncedMediaForProject filters to refs in cache that are not on remote', async () => {
      seedStore([
        makeProject({
          id: 'p1',
          lists: [withLongNoteHashes({ id: 'i' }, [HASH_LOCAL, HASH_SHARED, HASH_REMOTE])],
        }),
      ])
      const store = await getStore()

      const fake = makeFakeS3Adapter({
        cache: [HASH_LOCAL, HASH_SHARED],
        remote: [HASH_SHARED, HASH_REMOTE],
      })
      setMediaAdapter(fake.adapter)
      try {
        const result = await store.getUnsyncedMediaForProject('p1')
        // HASH_LOCAL: in cache, not in remote → unsynced.
        // HASH_SHARED: in cache, in remote → already synced.
        // HASH_REMOTE: in remote, not in cache → can't push from here, excluded.
        expect(Array.from(result)).toEqual([HASH_LOCAL])
      } finally {
        resetMediaAdapter()
      }
    })

    it('backfillMediaToRemote forwards hashes to the adapter and reports stats', async () => {
      seedStore([makeProject({ id: 'p' })])
      const store = await getStore()
      const fake = makeFakeS3Adapter({
        cache: [HASH_LOCAL, HASH_SHARED],
        remote: [HASH_SHARED],
      })
      setMediaAdapter(fake.adapter)
      try {
        const stats = await store.backfillMediaToRemote([HASH_LOCAL])
        expect(stats.supported).toBe(true)
        expect(stats.uploaded).toBe(1)
        expect(stats.failed).toBe(0)
        expect(fake.calls.backfillCalls).toEqual([[HASH_LOCAL]])
        expect(fake.remoteSet.has(HASH_LOCAL)).toBe(true)
      } finally {
        resetMediaAdapter()
      }
    })

    it('backfillMediaToRemote returns supported:false on local-only backends', async () => {
      const store = await getStore()
      const stats = await store.backfillMediaToRemote([HASH_LOCAL])
      expect(stats.supported).toBe(false)
      expect(stats.uploaded).toBe(0)
    })
  })

  // ─── Project media inventory (Settings list view) ────────────────
  describe('getProjectMediaInventory', () => {
    const HASH_IMG = '1'.repeat(64)
    const HASH_AUD = '2'.repeat(64)
    const HASH_BARE = '3'.repeat(64)

    function makeNote(id, html) {
      return { id, text: html, collapsed: false }
    }

    it('returns an empty array for unknown projects', async () => {
      const store = await getStore()
      expect(await store.getProjectMediaInventory('does-not-exist')).toEqual([])
    })

    it('returns an empty array for projects with no long-note media', async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'no media' })] })])
      const store = await getStore()
      expect(await store.getProjectMediaInventory('p1')).toEqual([])
    })

    it('classifies image / audio / unknown refs and reads size+mime via the adapter', async () => {
      const item = makeItem({
        id: 'i1',
        longNotes: [
          makeNote(
            'ln1',
            `<p><img src="scaffold-media://${HASH_IMG}" /></p>` +
              `<p><audio src="scaffold-media://${HASH_AUD}"></audio></p>` +
              `<p>raw ref: scaffold-media://${HASH_BARE}</p>`,
          ),
        ],
      })
      seedStore([makeProject({ id: 'p1', lists: [item] })])
      const store = await getStore()

      const blobs = {
        [HASH_IMG]: { mime: 'image/png', size: 1234 },
        [HASH_AUD]: { mime: 'audio/mpeg', size: 5678 },
      }
      setMediaAdapter({
        has: async () => false,
        get: async (h) =>
          blobs[h]
            ? {
                blob: new Blob([new Uint8Array(blobs[h].size)], { type: blobs[h].mime }),
                mime: blobs[h].mime,
                size: blobs[h].size,
                createdAt: 0,
              }
            : null,
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [],
        getStats: async () => ({ count: 0, bytes: 0 }),
      })
      try {
        const inventory = await store.getProjectMediaInventory('p1')
        const byHash = Object.fromEntries(inventory.map((e) => [e.hash, e]))

        expect(byHash[HASH_IMG]).toEqual({
          hash: HASH_IMG,
          kind: 'image',
          mime: 'image/png',
          size: 1234,
          inCache: true,
          inRemote: null,
        })
        expect(byHash[HASH_AUD]).toEqual({
          hash: HASH_AUD,
          kind: 'audio',
          mime: 'audio/mpeg',
          size: 5678,
          inCache: true,
          inRemote: null,
        })
        // Bare reference (not inside img/audio) is still listed,
        // classified as unknown, with size 0 because the adapter
        // doesn't have it.
        expect(byHash[HASH_BARE]).toEqual({
          hash: HASH_BARE,
          kind: 'unknown',
          mime: null,
          size: 0,
          inCache: false,
          inRemote: null,
        })
      } finally {
        resetMediaAdapter()
      }
    })

    it('reports per-tier presence on layered S3 backends (cache vs remote)', async () => {
      const item = makeItem({
        id: 'i1',
        longNotes: [
          makeNote(
            'ln1',
            `<img src="scaffold-media://${HASH_IMG}" />` +
              `<audio src="scaffold-media://${HASH_AUD}"></audio>` +
              `<img src="scaffold-media://${HASH_BARE}" />`,
          ),
        ],
      })
      seedStore([makeProject({ id: 'p1', lists: [item] })])
      const store = await getStore()

      // HASH_IMG is on both tiers; HASH_AUD is cache-only;
      // HASH_BARE is remote-only (we treat it as an image since
      // the long-note element wrapping it is an <img>).
      const cacheRows = {
        [HASH_IMG]: { mime: 'image/png', size: 100 },
        [HASH_AUD]: { mime: 'audio/mpeg', size: 200 },
      }
      let getCachedCalls = 0
      let getCalls = 0
      setMediaAdapter({
        has: async () => false,
        get: async () => {
          getCalls++
          return null
        },
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [HASH_IMG, HASH_BARE],
        getStats: async () => ({ count: 2, bytes: 0 }),
        listCachedHashes: async () => [HASH_IMG, HASH_AUD],
        listRemoteHashes: async () => [HASH_IMG, HASH_BARE],
        getCached: async (h) => {
          getCachedCalls++
          if (!cacheRows[h]) return null
          return {
            blob: new Blob([new Uint8Array(cacheRows[h].size)], { type: cacheRows[h].mime }),
            mime: cacheRows[h].mime,
            size: cacheRows[h].size,
            createdAt: 0,
          }
        },
        backfillRemoteFromCache: async () => ({ checked: 0, uploaded: 0, skipped: 0, failed: 0 }),
      })
      try {
        const inventory = await store.getProjectMediaInventory('p1')
        const byHash = Object.fromEntries(inventory.map((e) => [e.hash, e]))

        expect(byHash[HASH_IMG]).toMatchObject({
          kind: 'image',
          inCache: true,
          inRemote: true,
          size: 100,
        })
        expect(byHash[HASH_AUD]).toMatchObject({
          kind: 'audio',
          inCache: true,
          inRemote: false,
          size: 200,
        })
        // Remote-only: classified as 'image' because it appears
        // inside an <img>; size 0 because we deliberately don't
        // GET from S3 just to fill the table.
        expect(byHash[HASH_BARE]).toMatchObject({
          kind: 'image',
          inCache: false,
          inRemote: true,
          size: 0,
        })
        // Crucially, the layered code path used getCached, not get.
        expect(getCachedCalls).toBeGreaterThan(0)
        expect(getCalls).toBe(0)
      } finally {
        resetMediaAdapter()
      }
    })

    it("marks inRemote: 'unknown' when listRemoteHashes fails on a layered backend", async () => {
      const item = makeItem({
        id: 'i1',
        longNotes: [
          makeNote('ln1', `<img src="scaffold-media://${HASH_IMG}" />`),
        ],
      })
      seedStore([makeProject({ id: 'p1', lists: [item] })])
      const store = await getStore()

      setMediaAdapter({
        has: async () => false,
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        listHashes: async () => [],
        getStats: async () => ({ count: 0, bytes: 0 }),
        listCachedHashes: async () => [HASH_IMG],
        listRemoteHashes: async () => {
          throw new TypeError('NetworkError when attempting to fetch resource.')
        },
        getCached: async () => ({
          blob: new Blob([new Uint8Array(100)], { type: 'image/png' }),
          mime: 'image/png',
          size: 100,
          createdAt: 0,
        }),
        backfillRemoteFromCache: async () => ({
          checked: 0,
          uploaded: 0,
          skipped: 0,
          failed: 0,
        }),
      })
      try {
        const inventory = await store.getProjectMediaInventory('p1')
        expect(inventory).toHaveLength(1)
        // Cache lookup still succeeded so we know the bytes are local;
        // remote tier is "unknown" rather than null (which would imply
        // a local-only backend) or false (which would imply a definite
        // miss on the remote).
        expect(inventory[0]).toMatchObject({
          hash: HASH_IMG,
          inCache: true,
          inRemote: 'unknown',
        })
      } finally {
        resetMediaAdapter()
      }
    })
  })

  // ─── Outline operations ────────────────────────────────────────
  describe('outline operations', () => {
    let store

    beforeEach(async () => {
      const item1 = makeItem({ id: 'a', text: 'A' })
      const item2 = makeItem({ id: 'b', text: 'B' })
      const item3 = makeItem({ id: 'c', text: 'C' })
      seedStore([makeProject({ id: 'p1', lists: [item1, item2, item3] })])
      store = await getStore()
    })

    it('addRootListItem appends to lists', () => {
      const item = store.addRootListItem()
      expect(item.text).toBe(DEFAULT_NEW_LIST_ITEM_TEXT)
      expect(store.currentProject.lists.at(-1).id).toBe(item.id)
    })

    it('addRootListItemAfter inserts after reference', () => {
      store.addRootListItemAfter('a')
      expect(store.currentProject.lists[1].text).toBe(DEFAULT_NEW_LIST_ITEM_TEXT)
      expect(store.currentProject.lists).toHaveLength(4)
    })

    it('addRootDivider adds a divider', () => {
      const div = store.addRootDivider()
      expect(div.kind).toBe('divider')
      expect(store.currentProject.lists.at(-1).kind).toBe('divider')
    })

    it('addChildItem adds child and uncollapse parent', () => {
      store.currentProject.lists[0].collapsed = true
      const child = store.addChildItem('a')
      expect(child.parentId).toBe('a')
      expect(store.currentProject.lists[0].children).toHaveLength(1)
      expect(store.currentProject.lists[0].collapsed).toBe(false)
    })

    it('addChildItem is blocked on dividers', () => {
      const div = makeDivider({ id: 'div-x' })
      store.currentProject.lists.push(div)
      const result = store.addChildItem('div-x')
      expect(result).toBeUndefined()
    })

    it('updateListItem applies updates', () => {
      store.updateListItem('a', { text: 'Updated A' })
      expect(store.currentProject.lists[0].text).toBe('Updated A')
    })

    it('updateListItem is blocked on dividers', () => {
      const div = makeDivider({ id: 'div-x' })
      store.currentProject.lists.push(div)
      store.updateListItem('div-x', { text: 'Should not work' })
      const found = store.currentProject.lists.find((i) => i.id === 'div-x')
      expect(found.text).toBe('')
    })

    it('deleteListItem removes item', () => {
      store.deleteListItem('b')
      expect(store.currentProject.lists).toHaveLength(2)
      expect(store.currentProject.lists.find((i) => i.id === 'b')).toBeUndefined()
    })

    it('moveItem up swaps positions', () => {
      store.moveItem('b', 'up')
      expect(store.currentProject.lists[0].id).toBe('b')
      expect(store.currentProject.lists[1].id).toBe('a')
    })

    it('moveItem down swaps positions', () => {
      store.moveItem('a', 'down')
      expect(store.currentProject.lists[0].id).toBe('b')
      expect(store.currentProject.lists[1].id).toBe('a')
    })

    it('indentItem makes item child of previous sibling', () => {
      store.indentItem('b')
      expect(store.currentProject.lists).toHaveLength(2)
      expect(store.currentProject.lists[0].children).toHaveLength(1)
      expect(store.currentProject.lists[0].children[0].id).toBe('b')
    })

    it('indentItem is blocked adjacent to divider', () => {
      store.currentProject.lists.splice(1, 0, makeDivider({ id: 'div-block' }))
      const beforeLen = store.currentProject.lists.length
      store.indentItem('div-block')
      expect(store.currentProject.lists.length).toBe(beforeLen)
    })

    it('outdentItem promotes child to parent level', () => {
      store.indentItem('b')
      store.outdentItem('b')
      expect(store.currentProject.lists.find((i) => i.id === 'b')).toBeTruthy()
      expect(store.currentProject.lists[0].children).toHaveLength(0)
    })

    it('toggleRootListType flips between ordered and unordered', () => {
      expect(store.currentProject.rootListType).toBe('ordered')
      store.toggleRootListType()
      expect(store.currentProject.rootListType).toBe('unordered')
      store.toggleRootListType()
      expect(store.currentProject.rootListType).toBe('ordered')
    })

    it('toggleChildrenListType flips for a specific item', () => {
      expect(store.currentProject.lists[0].childrenType).toBe('ordered')
      store.toggleChildrenListType('a')
      expect(store.currentProject.lists[0].childrenType).toBe('unordered')
    })
  })

  // ─── Notes ────────────────────────────────────────────────
  describe('notes', () => {
    let store

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1' })] })])
      store = await getStore()
    })

    it('addShortNote appends note to item', () => {
      store.addShortNote('i1', 'page 5')
      expect(store.currentProject.lists[0].shortNotes).toHaveLength(1)
      expect(store.currentProject.lists[0].shortNotes[0].text).toBe('page 5')
    })

    it('addLongNote appends note and returns id', () => {
      const noteId = store.addLongNote('i1', '<p>detail</p>')
      expect(noteId).toBeTruthy()
      expect(store.currentProject.lists[0].longNotes).toHaveLength(1)
    })

    it('addShortNote is blocked on dividers', () => {
      store.currentProject.lists.push(makeDivider({ id: 'div-n' }))
      store.addShortNote('div-n', 'nope')
      const div = store.currentProject.lists.find((i) => i.id === 'div-n')
      expect(div.shortNotes).toHaveLength(0)
    })

    it('deleteNote removes the specified note', () => {
      store.addShortNote('i1', 'a')
      store.addShortNote('i1', 'b')
      const noteId = store.currentProject.lists[0].shortNotes[0].id
      store.deleteNote('i1', noteId, 'short')
      expect(store.currentProject.lists[0].shortNotes).toHaveLength(1)
    })

    it('updateNote changes text', () => {
      store.addLongNote('i1', 'old')
      const noteId = store.currentProject.lists[0].longNotes[0].id
      store.updateNote('i1', noteId, 'long', 'new')
      expect(store.currentProject.lists[0].longNotes[0].text).toBe('new')
    })

    it('toggleNoteCollapse flips collapsed', () => {
      store.addLongNote('i1', 'text')
      const noteId = store.currentProject.lists[0].longNotes[0].id
      expect(store.currentProject.lists[0].longNotes[0].collapsed).toBe(false)
      store.toggleNoteCollapse('i1', noteId)
      expect(store.currentProject.lists[0].longNotes[0].collapsed).toBe(true)
    })

    it('addLongNote with collapsedBgColor stores normalized hex', () => {
      const id = store.addLongNote('i1', 'with-color', { collapsedBgColor: 'AABBCC' })
      const note = store.currentProject.lists[0].longNotes.find((n) => n.id === id)
      expect(note.collapsedBgColor).toBe('#aabbcc')
    })

    it('addLongNote ignores invalid collapsedBgColor', () => {
      const id = store.addLongNote('i1', 'no-color', { collapsedBgColor: 'banana' })
      const note = store.currentProject.lists[0].longNotes.find((n) => n.id === id)
      expect(note.collapsedBgColor).toBeUndefined()
    })

    it('setLongNoteBackground sets and clears the per-note color', () => {
      const id = store.addLongNote('i1', 'plain')
      store.setLongNoteBackground('i1', id, '#aabbcc')
      let note = store.currentProject.lists[0].longNotes.find((n) => n.id === id)
      expect(note.collapsedBgColor).toBe('#aabbcc')

      store.setLongNoteBackground('i1', id, null)
      note = store.currentProject.lists[0].longNotes.find((n) => n.id === id)
      expect('collapsedBgColor' in note).toBe(false)
    })

    it('setLongNoteBackground ignores invalid colors without clearing existing value', () => {
      const id = store.addLongNote('i1', 'plain', { collapsedBgColor: '#aabbcc' })
      store.setLongNoteBackground('i1', id, 'banana')
      const note = store.currentProject.lists[0].longNotes.find((n) => n.id === id)
      expect(note.collapsedBgColor).toBe('#aabbcc')
    })
  })

  describe('long-note color settings', () => {
    let store

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1' })])
      store = await getStore()
    })

    it('createProject seeds default long-note color settings', async () => {
      const project = await store.createProject('Fresh')
      expect(project.settings.longNoteColorRoot).toBe('#80aaff')
      expect(project.settings.longNoteRecentCustomColors).toEqual([])
    })

    it('setLongNoteColorRoot updates current project with normalized hex', () => {
      store.setLongNoteColorRoot('AABBCC')
      expect(store.currentProject.settings.longNoteColorRoot).toBe('#aabbcc')
    })

    it('setLongNoteColorRoot ignores invalid input', () => {
      const before = store.currentProject.settings.longNoteColorRoot
      store.setLongNoteColorRoot('banana')
      expect(store.currentProject.settings.longNoteColorRoot).toBe(before)
    })

    it('pushLongNoteRecentCustomColor dedupes and caps at 5 entries', () => {
      store.pushLongNoteRecentCustomColor('#111111')
      store.pushLongNoteRecentCustomColor('#222222')
      store.pushLongNoteRecentCustomColor('#333333')
      store.pushLongNoteRecentCustomColor('#444444')
      store.pushLongNoteRecentCustomColor('#555555')
      store.pushLongNoteRecentCustomColor('#666666')
      const list = store.currentProject.settings.longNoteRecentCustomColors
      expect(list).toEqual(['#666666', '#555555', '#444444', '#333333', '#222222'])

      store.pushLongNoteRecentCustomColor('444444')
      const after = store.currentProject.settings.longNoteRecentCustomColors
      expect(after[0]).toBe('#444444')
      expect(after).toHaveLength(5)
    })

  })

  describe('long-note color legacy-load defaults', () => {
    it('legacy projects loaded without color settings get defaults', async () => {
      setActivePinia(createPinia())
      const legacy = makeProject({ id: 'legacy', settings: {} })
      delete legacy.settings.longNoteColorRoot
      delete legacy.settings.longNoteRecentCustomColors
      seedStore([legacy])
      const fresh = await getStore()
      const proj = fresh.projects.find((p) => p.id === 'legacy')
      expect(proj.settings.longNoteColorRoot).toBe('#80aaff')
      expect(proj.settings.longNoteRecentCustomColors).toEqual([])
    })
  })

  // ─── Undo/Redo ────────────────────────────────────────────
  describe('undo/redo', () => {
    let store

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'original' })] })])
      store = await getStore()
    })

    it('undo restores previous state after mutation', () => {
      store.updateListItem('i1', { text: 'changed' })
      expect(store.currentProject.lists[0].text).toBe('changed')
      store.undo()
      expect(store.currentProject.lists[0].text).toBe('original')
    })

    it('redo re-applies after undo', () => {
      store.updateListItem('i1', { text: 'changed' })
      store.undo()
      store.redo()
      expect(store.currentProject.lists[0].text).toBe('changed')
    })

    it('new mutation clears redo stack', () => {
      store.updateListItem('i1', { text: 'v1' })
      store.undo()
      expect(store.canRedo).toBe(true)
      store.updateListItem('i1', { text: 'v2' })
      expect(store.canRedo).toBe(false)
    })

    it('caps history at 50 entries', () => {
      for (let i = 0; i < 55; i++) {
        store.updateListItem('i1', { text: `v${i}` })
      }
      expect(store.canUndo).toBe(true)
      for (let i = 0; i < 50; i++) {
        store.undo()
      }
      expect(store.canUndo).toBe(false)
    })

    it('undo for wrong project is a no-op', async () => {
      store.updateListItem('i1', { text: 'x' })
      const p2 = await store.createProject('Other')
      store.selectProject(p2.id)
      expect(store.canUndo).toBe(false)
    })
  })

  // ─── Bulk operations ──────────────────────────────────────────
  describe('bulk operations', () => {
    let store

    beforeEach(async () => {
      const child = makeItem({ id: 'child', text: 'Child', parentId: 'root' })
      child.longNotes = [{ id: 'ln', text: 'note', collapsed: false }]
      const root = makeItem({ id: 'root', text: 'Root', children: [child] })
      root.collapsed = false
      seedStore([makeProject({ id: 'p1', lists: [root] })])
      store = await getStore()
    })

    it('collapseExpandAllItems collapses items with children', () => {
      store.collapseExpandAllItems(true)
      expect(store.currentProject.lists[0].collapsed).toBe(true)
    })

    it('collapseExpandAllItems expands all', () => {
      store.collapseExpandAllItems(true)
      store.collapseExpandAllItems(false)
      expect(store.currentProject.lists[0].collapsed).toBe(false)
    })

    it('collapseExpandAllLongNotes collapses notes', () => {
      store.collapseExpandAllLongNotes(true)
      const note = store.currentProject.lists[0].children[0].longNotes[0]
      expect(note.collapsed).toBe(true)
    })

    it('showHideAllLongNotes sets hidden flag', () => {
      store.showHideAllLongNotes(false)
      const note = store.currentProject.lists[0].children[0].longNotes[0]
      expect(note.hidden).toBe(true)
      store.showHideAllLongNotes(true)
      expect(note.hidden).toBe(false)
    })
  })

  // ─── Multi-line paste ───────────────────────────────────────
  describe('applyMultiLinePasteAsSiblings', () => {
    it('splits pasted text into sibling items', async () => {
      seedStore([
        makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'first' })] }),
      ])
      const store = await getStore()
      store.applyMultiLinePasteAsSiblings('i1', 'updated first', ['second', 'third'])

      expect(store.currentProject.lists[0].text).toBe('updated first')
      expect(store.currentProject.lists).toHaveLength(3)
      expect(store.currentProject.lists[1].text).toBe('second')
      expect(store.currentProject.lists[2].text).toBe('third')
    })
  })

  // ─── Persistence roundtrip ──────────────────────────────────
  describe('persistence roundtrip', () => {
    it('persistToStorage + loadFromStorage preserves project data', async () => {
      const item = makeItem({ id: 'r1', text: 'Root' })
      seedStore([makeProject({ id: 'p1', name: 'Saved', lists: [item] })])
      const store1 = await getStore()
      expect(store1.currentProject.name).toBe('Saved')

      setActivePinia(createPinia())
      const store2 = await getStore()
      expect(store2.currentProject.name).toBe('Saved')
      expect(store2.currentProject.lists[0].text).toBe('Root')
    })

    it('persists and restores UI preferences', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store1 = await getStore()
      store1.setFontScale(150)
      store1.setIndentSize(48)

      setActivePinia(createPinia())
      const store2 = await getStore()
      expect(store2.fontScale).toBe(150)
      expect(store2.indentSize).toBe(48)
    })

    it('sets storageSaveError when persistence fails', async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'A' })] })])
      const store = await getStore()
      const adapter = getStorageAdapter()
      const originalSaveProjects = adapter.saveProjects

      adapter.saveProjects = vi.fn().mockRejectedValue(new DOMException('Quota reached', 'QuotaExceededError'))
      store.updateListItem('i1', { text: 'B' })
      await flushAsyncWork()

      expect(store.storageSaveError).toContain('Storage is full')
      adapter.saveProjects = originalSaveProjects
    })

    it('sets storageUsageWarning when storage usage is high', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store = await getStore()
      const adapter = getStorageAdapter()
      const originalGetStorageStats = adapter.getStorageStats

      adapter.getStorageStats = vi.fn().mockResolvedValue({
        used: 4.6 * 1024 * 1024,
        quota: 5 * 1024 * 1024,
      })
      store.setFontScale(120)
      await flushAsyncWork()

      expect(store.storageUsageWarning).toContain('Storage usage is high')
      adapter.getStorageStats = originalGetStorageStats
    })
  })

  // ─── Legacy migration-in-load ────────────────────────────────
  describe('legacy migration-in-load', () => {
    it('migrates missing rootListType to ordered', async () => {
      const legacyProject = makeLegacyProject()
      delete legacyProject.rootListType
      seedStore([legacyProject])
      const store = await getStore()
      expect(store.currentProject.rootListType).toBe('ordered')
    })

    it('migrates legacy type to childrenType', async () => {
      seedStore([makeLegacyProject()])
      const store = await getStore()
      const item = store.currentProject.lists[0]
      expect(item.childrenType).toBe('ordered')
      expect(item.type).toBeUndefined()
    })

    it('adds missing kind field as item', async () => {
      seedStore([makeLegacyProject()])
      const store = await getStore()
      expect(store.currentProject.lists[0].kind).toBe('item')
      expect(store.currentProject.lists[0].children[0].kind).toBe('item')
    })

    it('adds missing settings from defaults', async () => {
      const proj = makeLegacyProject()
      delete proj.settings
      seedStore([proj])
      const store = await getStore()
      expect(store.currentProject.settings).toBeTruthy()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
    })

    it('backfills missing dual-script fields in existing settings', async () => {
      const proj = makeLegacyProject()
      proj.settings = { fontSize: 18, indentSize: 32, defaultListType: 'ordered', showIndentGuides: true }
      seedStore([proj])
      const store = await getStore()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
      expect(store.currentProject.settings.nonTibetanFontFamily).toBeTruthy()
    })

    it('creates example project when storage is empty', async () => {
      const store = await getStore()
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
    })

    it('falls back to first project when saved current id not found', async () => {
      const p = makeProject({ id: 'exists' })
      seedStore([p])
      localStorage.setItem(`${META_PREFIX}current-project`, 'deleted-id')
      const store = await getStore()
      expect(store.currentProjectId).toBe('exists')
    })

    it('sets currentProjectId to null if saved project and all fallbacks are locked', async () => {
      const p1 = makeProject({ id: 'p1' })
      const p2 = makeProject({ id: 'p2' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')
      localStorage.setItem(
        'scaffold-project-lock-p1',
        JSON.stringify({ holderTabId: 'other-tab-1', heartbeatAt: Date.now() }),
      )
      localStorage.setItem(
        'scaffold-project-lock-p2',
        JSON.stringify({ holderTabId: 'other-tab-2', heartbeatAt: Date.now() }),
      )

      const store = await getStore()
      expect(store.currentProjectId).toBeNull()
    })
  })

  // ─── Navigation helpers ──────────────────────────────────────
  describe('navigation helpers', () => {
    let store

    beforeEach(async () => {
      const items = [
        makeItem({ id: 'a', text: 'A' }),
        makeDivider({ id: 'div-1' }),
        makeItem({ id: 'b', text: 'B' }),
        makeItem({ id: 'c', text: 'C' }),
      ]
      seedStore([makeProject({ id: 'p1', lists: items })])
      store = await getStore()
    })

    it('findNextSibling wraps around and skips dividers', () => {
      const next = store.findNextSibling('a')
      expect(next.id).toBe('b')
    })

    it('findNextSibling wraps from last to first (skipping dividers)', () => {
      const next = store.findNextSibling('c')
      expect(next.id).toBe('a')
    })

    it('findNextSiblingNoWrap returns null at end', () => {
      const next = store.findNextSiblingNoWrap('c')
      expect(next).toBeNull()
    })

    it('findNextSiblingNoWrap skips dividers', () => {
      const next = store.findNextSiblingNoWrap('a')
      expect(next.id).toBe('b')
    })
  })

  // ─── Settings setters ───────────────────────────────────────
  describe('settings setters', () => {
    let store

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1' })])
      store = await getStore()
    })

    it('setIndentSize updates store and project settings', () => {
      store.setIndentSize(64)
      expect(store.indentSize).toBe(64)
      expect(store.currentProject.settings.indentSize).toBe(64)
    })

    it('setDefaultListType updates store and project', () => {
      store.setDefaultListType('unordered')
      expect(store.defaultListType).toBe('unordered')
      expect(store.currentProject.settings.defaultListType).toBe('unordered')
    })

    it('setShowIndentGuides updates store and project', () => {
      store.setShowIndentGuides(false)
      expect(store.showIndentGuides).toBe(false)
      expect(store.currentProject.settings.showIndentGuides).toBe(false)
    })

    it('setTibetanFontFamily updates store and project', () => {
      store.setTibetanFontFamily('Noto Sans Tibetan')
      expect(store.tibetanFontFamily).toBe('Noto Sans Tibetan')
    })

    it('setNonTibetanFontSize syncs fontSize alias', () => {
      store.setNonTibetanFontSize(20)
      expect(store.nonTibetanFontSize).toBe(20)
      expect(store.fontSize).toBe(20)
    })
  })

  describe('import and versioning branches', () => {
    it('importFromJSONFile rejects when no file is selected', async () => {
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({ target: { files: [] } })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      await expect(store.importFromJSONFile()).rejects.toThrow('No file selected')
    })

    it('importFromJSONFile imports project and resolves collisions', async () => {
      const existing = makeProject({ id: 'dup', name: 'Existing' })
      seedStore([existing])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)
      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Imported',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)
      expect(store.projects).toHaveLength(2)
      expect(store.projects[1].name).toContain('(Imported)')
      expect(store.projects[1].id).not.toBe('dup')
    })

    it('importFromJSONFile restores embedded version history for new project ids', async () => {
      const existing = makeProject({ id: 'dup', name: 'Existing' })
      seedStore([existing])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)

      const innerExport = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Snapshot',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rootListType: 'ordered',
            settings: {},
            items: [],
          },
        ],
      }

      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Imported',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
        projectVersions: {
          dup: [
            {
              id: 'v-good',
              projectId: 'dup',
              name: 'Manual save',
              timestamp: 1700000000000,
              trigger: 'manual',
              stats: { items: 0, notes: 0 },
              data: innerExport,
            },
            // Malformed entry — should be skipped with a warning, not abort import.
            {
              id: 'v-bad',
              projectId: 'dup',
              timestamp: 1700000001000,
            },
          ],
        },
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)
      expect(result.importedVersions).toBe(1)
      expect(result.warnings.some((w) => w.includes('Skipped version'))).toBe(true)

      // Imported project gets a fresh id; persisted version meta must use that id.
      const importedProject = store.projects.find((p) => p.name.includes('(Imported)'))
      expect(importedProject).toBeTruthy()
      expect(importedProject.id).not.toBe('dup')

      const adapter = getStorageAdapter()
      const newEntries = await adapter.getMetaEntries(`scaffold-version-${importedProject.id}-`)
      expect(newEntries).toHaveLength(1)

      const stored = JSON.parse(newEntries[0].value)
      expect(stored.id).toBe('v-good')
      expect(stored.projectId).toBe(importedProject.id)
      expect(stored.data.projects[0].id).toBe(importedProject.id)

      // Original prefix must remain empty — versions were not duplicated.
      const originalEntries = await adapter.getMetaEntries('scaffold-version-dup-')
      expect(originalEntries).toHaveLength(0)
    })

    it('importFromJSONFile keeps original ids when no project collision exists', async () => {
      seedStore([makeProject({ id: 'unrelated' })])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)

      const innerExport = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'fresh',
            name: 'Snapshot',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rootListType: 'ordered',
            settings: {},
            items: [],
          },
        ],
      }

      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'fresh',
            name: 'Fresh Import',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
        projectVersions: {
          fresh: [
            {
              id: 'v-1',
              projectId: 'fresh',
              name: null,
              timestamp: 1700000000000,
              trigger: 'manual',
              stats: { items: 0, notes: 0 },
              data: innerExport,
            },
          ],
        },
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.imported).toBe(1)
      expect(result.importedVersions).toBe(1)

      const importedProject = store.projects.find((p) => p.id === 'fresh')
      expect(importedProject).toBeTruthy()

      const adapter = getStorageAdapter()
      const entries = await adapter.getMetaEntries('scaffold-version-fresh-')
      expect(entries).toHaveLength(1)
    })


    it('saveVersion skips duplicates compared to latest version', async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'a', text: 'A' })] })])
      const store = await getStore()

      const firstId = await store.saveVersion('Initial')
      expect(firstId).toBeTruthy()
      const secondId = await store.saveVersion('Duplicate attempt')
      expect(secondId).toBeNull()
    })

    it('saveVersion duplicate check ignores malformed existing version entries', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store = await getStore()
      await getStorageAdapter().setMeta('scaffold-version-p1-bad', 'NOT_JSON')

      const versionId = await store.saveVersion('After malformed latest')
      expect(versionId).toBeTruthy()
    })

    it('restoreVersion returns null for invalid payloads', async () => {
      const store = await getStore()
      expect(await store.restoreVersion(null)).toBeNull()
      expect(await store.restoreVersion({})).toBeNull()
      expect(await store.restoreVersion({ data: { invalid: true } })).toBeNull()
    })

    it('auto-start versioning creates a version when configured', async () => {
      // We deliberately re-fetch the adapter AFTER store init so we
      // see the context-scoped wrapper (the pre-init adapter
      // reference points at the unscoped base, which is stale once
      // the store hydrates and pins the active context).
      await getStorageAdapter().setMeta(
        'program-settings',
        JSON.stringify({ autoVersioning: ['start'] }),
      )
      seedStore([makeProject({ id: 'p1' })])
      await getStore()

      const entries = await getStorageAdapter().getMetaEntries(
        'scaffold-version-p1-',
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('auto-close and interval versioning paths execute without error', async () => {
      vi.useFakeTimers()
      await getStorageAdapter().setMeta(
        'program-settings',
        JSON.stringify({ autoVersioning: ['close', 'interval'], versioningInterval: 0.001 }),
      )
      seedStore([makeProject({ id: 'p1' })])
      await getStore()

      window.dispatchEvent(new Event('beforeunload'))
      await vi.advanceTimersByTimeAsync(1000)

      const entries = await getStorageAdapter().getMetaEntries(
        'scaffold-version-p1-',
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
      vi.useRealTimers()
    })
  })
})
