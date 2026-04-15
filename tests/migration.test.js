import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MIGRATION_STATES,
  getMigrationStatus,
  runMigration,
} from 'src/utils/storage/migration.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'
import { makeProject, makeItem, makeDivider, makeComplexProject } from './fixtures/projects.js'

/**
 * In-memory adapter that behaves like IndexedDB for testing.
 * Allows injecting failures via options.
 */
function createMemoryAdapter(opts = {}) {
  const store = { projects: [], meta: {} }

  return {
    _store: store,

    async loadProjects() {
      if (opts.failOnLoad) throw new Error('Load failed')
      return JSON.parse(JSON.stringify(store.projects))
    },

    async saveProjects(projects) {
      if (opts.failOnSave) throw new Error('Save failed')
      store.projects = JSON.parse(JSON.stringify(projects))
    },

    async getProject(id) {
      return store.projects.find((p) => p.id === id) || null
    },

    async saveProject(project) {
      if (opts.failOnSave) throw new Error('Save failed')
      const idx = store.projects.findIndex((p) => p.id === project.id)
      if (idx >= 0) store.projects[idx] = JSON.parse(JSON.stringify(project))
      else store.projects.push(JSON.parse(JSON.stringify(project)))
    },

    async deleteProject(id) {
      store.projects = store.projects.filter((p) => p.id !== id)
    },

    async getStorageStats() {
      const json = JSON.stringify(store)
      return { used: json.length * 2, quota: 50 * 1024 * 1024 }
    },

    async getMeta(key) {
      return store.meta[key] || null
    },

    async setMeta(key, value) {
      store.meta[key] = value
    },
  }
}

// Migration tests prioritize data safety guarantees:
// idempotency, non-destructive behavior, and explicit failure states.
describe('getMigrationStatus', () => {
  it('returns not_started when no meta exists', async () => {
    const adapter = createMemoryAdapter()
    expect(await getMigrationStatus(adapter)).toBe(MIGRATION_STATES.NOT_STARTED)
  })

  it('returns stored status', async () => {
    const adapter = createMemoryAdapter()
    await adapter.setMeta(
      'migration-status',
      JSON.stringify({ status: MIGRATION_STATES.COMPLETED }),
    )
    expect(await getMigrationStatus(adapter)).toBe(MIGRATION_STATES.COMPLETED)
  })

  it('returns not_started for corrupt meta', async () => {
    const adapter = createMemoryAdapter()
    await adapter.setMeta('migration-status', 'NOT JSON')
    expect(await getMigrationStatus(adapter)).toBe(MIGRATION_STATES.NOT_STARTED)
  })
})

describe('runMigration', () => {
  let source
  let target

  beforeEach(() => {
    source = createLocalStorageAdapter()
    target = createMemoryAdapter()
  })

  it('migrates projects from source to target', async () => {
    const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })]
    localStorage.setItem('outline-projects', JSON.stringify(projects))

    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.COMPLETED)
    expect(result.projectCount).toBe(2)

    const loaded = await target.loadProjects()
    expect(loaded).toHaveLength(2)
  })

  it('preserves complex project structure through migration', async () => {
    const complex = makeComplexProject()
    localStorage.setItem('outline-projects', JSON.stringify([complex]))

    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.COMPLETED)

    const loaded = await target.loadProjects()
    expect(loaded[0].lists).toHaveLength(3)
    expect(loaded[0].lists[0].children).toHaveLength(2)
    expect(loaded[0].lists[1].kind).toBe('divider')
  })

  it('is idempotent — second run is a no-op', async () => {
    localStorage.setItem('outline-projects', JSON.stringify([makeProject({ id: 'p1' })]))

    const first = await runMigration(source, target)
    expect(first.status).toBe(MIGRATION_STATES.COMPLETED)

    const second = await runMigration(source, target)
    expect(second.status).toBe(MIGRATION_STATES.COMPLETED)
    expect(second.projectCount).toBe(1)

    // Target still has exactly one project
    const loaded = await target.loadProjects()
    expect(loaded).toHaveLength(1)
  })

  it('does not modify source data', async () => {
    const original = JSON.stringify([makeProject({ id: 'p1', name: 'Original' })])
    localStorage.setItem('outline-projects', original)

    await runMigration(source, target)

    expect(localStorage.getItem('outline-projects')).toBe(original)
  })

  it('handles empty source gracefully', async () => {
    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.COMPLETED)
    expect(result.projectCount).toBe(0)
  })

  it('fails when source data is corrupt (not JSON)', async () => {
    localStorage.setItem('outline-projects', 'NOT JSON')

    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.FAILED)
    expect(result.error).toBeTruthy()
  })

  it('fails when target save throws (quota simulation)', async () => {
    localStorage.setItem('outline-projects', JSON.stringify([makeProject({ id: 'p1' })]))
    target = createMemoryAdapter({ failOnSave: true })

    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.FAILED)
    expect(result.error).toContain('Save failed')
  })

  it('fails when verification read fails', async () => {
    localStorage.setItem('outline-projects', JSON.stringify([makeProject({ id: 'p1' })]))

    // Adapter that saves OK but fails on the verification readback
    let saveCount = 0
    const badTarget = createMemoryAdapter()
    const origLoad = badTarget.loadProjects.bind(badTarget)
    let callCount = 0
    badTarget.loadProjects = async () => {
      callCount++
      // First call is the initial status check (via getMigrationStatus doesn't call loadProjects),
      // but runMigration calls loadProjects for verification — fail on that call.
      if (callCount > 0 && badTarget._store.projects.length > 0) {
        throw new Error('Verification read failed')
      }
      return origLoad()
    }

    const result = await runMigration(source, badTarget)
    expect(result.status).toBe(MIGRATION_STATES.FAILED)
  })

  it('can retry after failure', async () => {
    localStorage.setItem('outline-projects', JSON.stringify([makeProject({ id: 'p1' })]))

    // First attempt fails on save
    const failTarget = createMemoryAdapter({ failOnSave: true })
    const firstResult = await runMigration(source, failTarget)
    expect(firstResult.status).toBe(MIGRATION_STATES.FAILED)

    // Retry with working target (reusing the same meta store to simulate same DB)
    const retryTarget = createMemoryAdapter()
    retryTarget._store.meta = failTarget._store.meta
    const retryResult = await runMigration(source, retryTarget)
    expect(retryResult.status).toBe(MIGRATION_STATES.COMPLETED)
    expect(retryResult.projectCount).toBe(1)
  })

  it('handles source returning non-array', async () => {
    localStorage.setItem('outline-projects', '"not an array"')

    const result = await runMigration(source, target)
    expect(result.status).toBe(MIGRATION_STATES.FAILED)
    expect(result.error).toContain('not an array')
  })

  it('sets timestamps on completion', async () => {
    localStorage.setItem('outline-projects', JSON.stringify([makeProject({ id: 'p1' })]))
    await runMigration(source, target)

    const tsRaw = await target.getMeta('migration-completed-at')
    expect(tsRaw).toBeTruthy()
    const ts = JSON.parse(tsRaw)
    expect(typeof ts).toBe('number')
    expect(ts).toBeGreaterThan(0)
  })
})
