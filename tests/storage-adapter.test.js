import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLocalStorageAdapter,
  createIndexedDbAdapter,
} from 'src/utils/storage/storage-adapter.js'
import { makeProject, makeItem } from './fixtures/projects.js'

/**
 * Shared contract tests that both adapters must pass.
 */
function adapterContractTests(createAdapter) {
  let adapter

  beforeEach(async () => {
    adapter = await createAdapter()
  })

  it('loadProjects returns empty array when nothing stored', async () => {
    const result = await adapter.loadProjects()
    expect(result).toEqual([])
  })

  it('saveProjects + loadProjects roundtrips', async () => {
    const projects = [makeProject({ id: 'a' }), makeProject({ id: 'b' })]
    await adapter.saveProjects(projects)
    const loaded = await adapter.loadProjects()
    expect(loaded).toHaveLength(2)
    expect(loaded.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })

  it('getProject returns matching project or null', async () => {
    await adapter.saveProjects([makeProject({ id: 'x', name: 'X' })])
    expect((await adapter.getProject('x')).name).toBe('X')
    expect(await adapter.getProject('missing')).toBeNull()
  })

  it('saveProject upserts into existing list', async () => {
    await adapter.saveProjects([makeProject({ id: 'a', name: 'Old' })])
    await adapter.saveProject(makeProject({ id: 'a', name: 'New' }))
    const loaded = await adapter.loadProjects()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('New')
  })

  it('saveProject appends when project does not exist', async () => {
    await adapter.saveProjects([makeProject({ id: 'a' })])
    await adapter.saveProject(makeProject({ id: 'b' }))
    expect(await adapter.loadProjects()).toHaveLength(2)
  })

  it('deleteProject removes by id', async () => {
    await adapter.saveProjects([makeProject({ id: 'a' }), makeProject({ id: 'b' })])
    await adapter.deleteProject('a')
    const loaded = await adapter.loadProjects()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('b')
  })

  it('getStorageStats returns used and quota', async () => {
    const stats = await adapter.getStorageStats()
    expect(typeof stats.used).toBe('number')
    expect(typeof stats.quota).toBe('number')
  })

  it('getMeta / setMeta roundtrips', async () => {
    await adapter.setMeta('test', 'value')
    expect(await adapter.getMeta('test')).toBe('value')
    expect(await adapter.getMeta('missing')).toBeNull()
  })

  it('deleteMeta removes a key', async () => {
    await adapter.setMeta('doomed', 'x')
    expect(await adapter.getMeta('doomed')).toBe('x')
    await adapter.deleteMeta('doomed')
    expect(await adapter.getMeta('doomed')).toBeNull()
  })

  it('deleteMeta is safe for non-existent key', async () => {
    await adapter.deleteMeta('nope')
  })

  it('getMetaEntries returns matching entries', async () => {
    await adapter.setMeta('version-p1-a', 'data-a')
    await adapter.setMeta('version-p1-b', 'data-b')
    await adapter.setMeta('version-p2-c', 'data-c')
    await adapter.setMeta('other-key', 'other')

    const entries = await adapter.getMetaEntries('version-p1-')
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.key).sort()).toEqual(['version-p1-a', 'version-p1-b'])
  })

  it('getMetaEntries returns empty array when no match', async () => {
    const entries = await adapter.getMetaEntries('nonexistent-')
    expect(entries).toEqual([])
  })
}

describe('localStorage adapter', () => {
  adapterContractTests(() => createLocalStorageAdapter())
})

describe('IndexedDB adapter', () => {
  let dbCounter = 0

  adapterContractTests(async () => {
    const { indexedDB } = await import('fake-indexeddb')
    return createIndexedDbAdapter(indexedDB)
  })
})
