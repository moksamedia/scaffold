import { describe, it, expect, beforeEach } from 'vitest'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'
import { makeProject, makeItem } from './fixtures/projects.js'

describe('localStorage adapter', () => {
  let adapter

  beforeEach(() => {
    adapter = createLocalStorageAdapter()
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
    expect(loaded[0].id).toBe('a')
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
    localStorage.setItem('test-key', 'test-value')
    const stats = await adapter.getStorageStats()
    expect(stats.used).toBeGreaterThan(0)
    expect(stats.quota).toBeGreaterThan(0)
  })

  it('getMeta / setMeta roundtrips', async () => {
    await adapter.setMeta('test', 'value')
    expect(await adapter.getMeta('test')).toBe('value')
    expect(await adapter.getMeta('missing')).toBeNull()
  })
})
