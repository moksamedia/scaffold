import { describe, it, expect } from 'vitest'
import { runContextMigration } from 'src/utils/context/migration.js'
import {
  DEFAULT_CONTEXT_ID,
  loadContextRegistry,
  getStoredActiveContextId,
} from 'src/utils/context/session.js'
import { getBaseStorageAdapter } from 'src/utils/storage/index.js'

const META_PREFIX = 'scaffold-meta-'

describe('runContextMigration', () => {
  it('moves legacy projects, flat meta, and version entries into ctx:default:', async () => {
    // Seed legacy storage state directly via localStorage so we can
    // observe the migration side-effects with no abstraction in the way.
    localStorage.setItem(
      'outline-projects',
      JSON.stringify([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]),
    )
    localStorage.setItem(`${META_PREFIX}current-project`, 'p1')
    localStorage.setItem(`${META_PREFIX}font-scale`, '125')
    localStorage.setItem(
      `${META_PREFIX}program-settings`,
      JSON.stringify({ defaultListType: 'unordered' }),
    )
    localStorage.setItem(`${META_PREFIX}scaffold-version-p1-v1`, '{"id":"v1"}')
    localStorage.setItem(`${META_PREFIX}scaffold-version-p2-v2`, '{"id":"v2"}')

    const result = await runContextMigration()
    expect(result.migrated).toBe(true)
    expect(result.contextId).toBe(DEFAULT_CONTEXT_ID)

    // Registry now has the default context and the active id is set.
    const contexts = await loadContextRegistry()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].id).toBe(DEFAULT_CONTEXT_ID)
    expect(await getStoredActiveContextId()).toBe(DEFAULT_CONTEXT_ID)

    // Legacy keys have been migrated into the namespaced layout.
    const base = getBaseStorageAdapter()
    expect(await base.getMeta('ctx:default:current-project')).toBe('p1')
    expect(await base.getMeta('ctx:default:font-scale')).toBe('125')
    expect(JSON.parse(await base.getMeta('ctx:default:program-settings')))
      .toEqual({ defaultListType: 'unordered' })

    const projectsBlob = await base.getMeta('ctx:default:projects')
    expect(JSON.parse(projectsBlob)).toEqual([
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ])

    const versionEntries = await base.getMetaEntries('ctx:default:scaffold-version-')
    expect(versionEntries.map((e) => e.key).sort()).toEqual([
      'ctx:default:scaffold-version-p1-v1',
      'ctx:default:scaffold-version-p2-v2',
    ])

    // Legacy meta keys are removed after migration. The bulk
    // "outline-projects" key is reset to an empty array because the
    // localStorage adapter has no concept of "clear" — equivalent to
    // deleted, since subsequent loads return [] and skip migration.
    const residualProjects = localStorage.getItem('outline-projects')
    expect(residualProjects === null || residualProjects === '[]').toBe(true)
    expect(localStorage.getItem(`${META_PREFIX}current-project`)).toBeNull()
    expect(localStorage.getItem(`${META_PREFIX}font-scale`)).toBeNull()
    expect(localStorage.getItem(`${META_PREFIX}program-settings`)).toBeNull()
    expect(localStorage.getItem(`${META_PREFIX}scaffold-version-p1-v1`)).toBeNull()
  })

  it('is a no-op once the registry has at least one context', async () => {
    // Pre-populate the registry: simulates a second app launch.
    const base = getBaseStorageAdapter()
    await base.setMeta(
      'scaffold-contexts',
      JSON.stringify([
        {
          id: 'existing',
          name: 'Existing',
          authProvider: 'local',
          externalSubject: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
    )

    // Add a "legacy" key to confirm we don't touch it.
    localStorage.setItem('outline-projects', JSON.stringify([{ id: 'p' }]))

    const result = await runContextMigration()
    expect(result.migrated).toBe(false)
    expect(localStorage.getItem('outline-projects')).toBe(
      JSON.stringify([{ id: 'p' }]),
    )
  })

  it('still creates a default context when no legacy data exists', async () => {
    const result = await runContextMigration()
    expect(result.migrated).toBe(true)

    const contexts = await loadContextRegistry()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].id).toBe(DEFAULT_CONTEXT_ID)
  })

  it('skips entries that already live under ctx: prefixes', async () => {
    // A pre-existing namespaced version entry should NOT be re-moved
    // under another `ctx:default:` prefix during migration. This guards
    // against accidental double-namespacing if registry detection ever
    // produces a false negative.
    const base = getBaseStorageAdapter()
    await base.setMeta(
      'ctx:default:scaffold-version-p1-v1',
      JSON.stringify({ id: 'v1' }),
    )

    const result = await runContextMigration()
    expect(result.migrated).toBe(true)

    // Only one entry should exist, not duplicated.
    const entries = await base.getMetaEntries('ctx:default:scaffold-version-')
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('ctx:default:scaffold-version-p1-v1')
  })
})
