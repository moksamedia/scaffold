import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOutlineStore } from 'src/stores/outline-store.js'
import { getStorageAdapter, getBaseStorageAdapter } from 'src/utils/storage/index.js'
import { makeProject } from './fixtures/projects.js'

const META_PREFIX = 'scaffold-meta-'

async function getStore() {
  const store = useOutlineStore()
  await store.initPromise
  return store
}

function seedLegacy(projectsArray) {
  localStorage.setItem('outline-projects', JSON.stringify(projectsArray))
  if (projectsArray.length > 0) {
    localStorage.setItem(`${META_PREFIX}current-project`, projectsArray[0].id)
  }
}

describe('context-aware outline store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exposes a default context after initial hydration', async () => {
    seedLegacy([makeProject({ id: 'p1', name: 'Migrated' })])
    const store = await getStore()

    expect(store.contexts).toHaveLength(1)
    expect(store.contexts[0].id).toBe('default')
    expect(store.activeContextId).toBe('default')
    expect(store.currentProject?.name).toBe('Migrated')
  })

  it('createNewContext switches into the new context with empty projects', async () => {
    seedLegacy([makeProject({ id: 'p1', name: 'Default Project' })])
    const store = await getStore()
    expect(store.projects.find((p) => p.id === 'p1')).toBeTruthy()

    const ctx = await store.createNewContext('Personal', { activate: true })
    expect(ctx.name).toBe('Personal')
    expect(store.activeContextId).toBe(ctx.id)
    // The default context's project should NOT appear in the new context.
    expect(store.projects.find((p) => p.id === 'p1')).toBeUndefined()
  })

  it('switchContext swaps in the other context\'s projects', async () => {
    seedLegacy([makeProject({ id: 'default-1', name: 'Default Project' })])
    const store = await getStore()
    const defaultId = store.activeContextId

    const personal = await store.createNewContext('Personal', { activate: true })
    await store.createProject('Personal Project')
    const personalProjectId = store.projects[store.projects.length - 1].id

    // Back to default → see only the default project.
    const ok = await store.switchContext(defaultId)
    expect(ok).toBe(true)
    expect(store.projects.map((p) => p.id)).toContain('default-1')
    expect(store.projects.find((p) => p.id === personalProjectId)).toBeUndefined()

    // Forward to personal → see only the personal project.
    await store.switchContext(personal.id)
    expect(store.projects.find((p) => p.id === 'default-1')).toBeUndefined()
    expect(store.projects.find((p) => p.id === personalProjectId)).toBeTruthy()
  })

  it('switchContext is a no-op when the requested context is already active', async () => {
    const store = await getStore()
    const result = await store.switchContext(store.activeContextId)
    expect(result).toBe(false)
  })

  it('switchContext rejects unknown context ids', async () => {
    const store = await getStore()
    const result = await store.switchContext('does-not-exist')
    expect(result).toBe(false)
  })

  it('versions and program settings are isolated per context', async () => {
    seedLegacy([makeProject({ id: 'p1', name: 'Default Project' })])
    const store = await getStore()

    // Default context: write program-settings + a version snapshot.
    await getStorageAdapter().setMeta(
      'program-settings',
      JSON.stringify({ defaultListType: 'unordered' }),
    )
    await store.saveVersion('default-snapshot', 'manual')
    const defaultVersionEntries = await getStorageAdapter().getMetaEntries(
      'scaffold-version-',
    )
    expect(defaultVersionEntries.length).toBeGreaterThanOrEqual(1)

    // Switch to a fresh context.
    const fresh = await store.createNewContext('Fresh', { activate: true })

    // The fresh context starts with no program settings + no versions.
    expect(await getStorageAdapter().getMeta('program-settings')).toBeNull()
    expect(await getStorageAdapter().getMetaEntries('scaffold-version-')).toEqual([])

    // Underlying base adapter, however, still has BOTH contexts'
    // namespaced data (we should never accidentally erase one when
    // operating in the other).
    const base = getBaseStorageAdapter()
    const allVersionEntries = await base.getMetaEntries('ctx:')
    const defaultVersions = allVersionEntries.filter((e) =>
      e.key.startsWith('ctx:default:scaffold-version-'),
    )
    expect(defaultVersions.length).toBeGreaterThanOrEqual(1)

    const freshVersions = allVersionEntries.filter((e) =>
      e.key.startsWith(`ctx:${fresh.id}:scaffold-version-`),
    )
    expect(freshVersions).toHaveLength(0)
  })

  it('renameContextById updates the in-memory registry', async () => {
    const store = await getStore()
    const ctx = await store.createNewContext('Tmp', { activate: false })
    await store.renameContextById(ctx.id, 'Renamed')
    const fresh = store.contexts.find((c) => c.id === ctx.id)
    expect(fresh?.name).toBe('Renamed')
  })

  it('deleteContextById refuses when only one context remains', async () => {
    const store = await getStore()
    const result = await store.deleteContextById(store.activeContextId)
    expect(result.deleted).toBe(false)
    expect(result.reason).toBe('last-context')
  })

  it('deleteContextById switches off a deleted active context', async () => {
    const store = await getStore()
    const defaultId = store.activeContextId
    const personal = await store.createNewContext('Personal', { activate: true })
    expect(store.activeContextId).toBe(personal.id)

    const result = await store.deleteContextById(personal.id)
    expect(result.deleted).toBe(true)
    expect(store.activeContextId).toBe(defaultId)
    expect(store.contexts.find((c) => c.id === personal.id)).toBeUndefined()
  })

  it('switchingContext is true while a switch is in flight', async () => {
    const store = await getStore()
    const personal = await store.createNewContext('Personal', { activate: false })

    const switchPromise = store.switchContext(personal.id)
    expect(store.switchingContext).toBe(true)
    await switchPromise
    expect(store.switchingContext).toBe(false)
  })

  it('createNewContext({ cloneFromCurrent: true }) seeds the new context with the active context data', async () => {
    seedLegacy([makeProject({ id: 'p1', name: 'Original' })])
    const store = await getStore()
    const sourceId = store.activeContextId

    // Make a change in the source context that we expect to see in the clone.
    store.setFontScale(140)
    await store.saveVersion('snapshot-before-clone', 'manual')
    const versionEntriesBefore = await getStorageAdapter().getMetaEntries(
      'scaffold-version-',
    )
    expect(versionEntriesBefore.length).toBeGreaterThanOrEqual(1)

    const cloned = await store.createNewContext('Forked', {
      activate: true,
      cloneFromCurrent: true,
    })
    expect(cloned.id).not.toBe(sourceId)
    expect(store.activeContextId).toBe(cloned.id)

    // Cloned context starts with the source's projects + font scale.
    expect(store.projects.find((p) => p.id === 'p1')?.name).toBe('Original')
    expect(store.fontScale).toBe(140)

    // Cloned context also got the version snapshot.
    const clonedVersions = await getStorageAdapter().getMetaEntries(
      'scaffold-version-',
    )
    expect(clonedVersions.length).toBeGreaterThanOrEqual(1)

    // Edits in the clone don't leak back into the source.
    store.renameProject('p1', 'Edited In Clone')
    await store.switchContext(sourceId)
    const sourceProject = store.projects.find((p) => p.id === 'p1')
    expect(sourceProject?.name).toBe('Original')
  })

  it('createNewContext without cloneFromCurrent starts with empty projects regardless of source state', async () => {
    seedLegacy([makeProject({ id: 'p1', name: 'Source-only' })])
    const store = await getStore()

    const ctx = await store.createNewContext('Fresh', {
      activate: true,
      cloneFromCurrent: false,
    })
    expect(store.activeContextId).toBe(ctx.id)
    // Empty contexts get the welcome example project on hydrate, which is
    // never named "Source-only".
    expect(store.projects.find((p) => p.name === 'Source-only')).toBeUndefined()
  })

  it('font-scale persists per context', async () => {
    const store = await getStore()
    const defaultId = store.activeContextId
    store.setFontScale(150)

    const ctx = await store.createNewContext('Other', { activate: true })
    // New context starts with default 100, not 150.
    expect(store.fontScale).toBe(100)
    store.setFontScale(80)

    await store.switchContext(defaultId)
    expect(store.fontScale).toBe(150)

    await store.switchContext(ctx.id)
    expect(store.fontScale).toBe(80)
  })
})
