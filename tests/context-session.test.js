import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT_ID,
  cloneContextData,
  createContext,
  deleteContext,
  ensureDefaultContext,
  getStoredActiveContextId,
  loadContextRegistry,
  renameContext,
  resolveActiveContextId,
  saveContextRegistry,
  setStoredActiveContextId,
} from 'src/utils/context/session.js'
import { getBaseStorageAdapter } from 'src/utils/storage/index.js'

describe('context session registry', () => {
  it('returns an empty registry before any context is created', async () => {
    expect(await loadContextRegistry()).toEqual([])
  })

  it('ensureDefaultContext seeds a default context exactly once', async () => {
    const first = await ensureDefaultContext()
    expect(first).toHaveLength(1)
    expect(first[0].id).toBe(DEFAULT_CONTEXT_ID)
    expect(first[0].name).toBe('Default')
    expect(first[0].authProvider).toBe('local')
    expect(first[0].externalSubject).toBeNull()

    // Re-running is a no-op (idempotent).
    const second = await ensureDefaultContext()
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe(DEFAULT_CONTEXT_ID)
  })

  it('createContext appends a fresh context with future-auth fields', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('Work')
    expect(ctx.name).toBe('Work')
    expect(ctx.id).not.toBe(DEFAULT_CONTEXT_ID)
    expect(ctx.authProvider).toBe('local')
    expect(ctx.externalSubject).toBeNull()
    expect(typeof ctx.createdAt).toBe('string')
    expect(typeof ctx.updatedAt).toBe('string')

    const registry = await loadContextRegistry()
    expect(registry.map((c) => c.name).sort()).toEqual(['Default', 'Work'])
  })

  it('createContext trims whitespace and falls back when name is empty', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('   ')
    expect(ctx.name).toBe('New Context')
  })

  it('renameContext updates name and updatedAt; rejects empty names', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('Original')

    const renamed = await renameContext(ctx.id, '   ')
    expect(renamed).toBeNull()

    // Sleep ≥1ms so the regenerated `updatedAt` differs at ISO
    // millisecond resolution.
    await new Promise((r) => setTimeout(r, 5))

    const ok = await renameContext(ctx.id, 'Renamed')
    expect(ok.name).toBe('Renamed')
    expect(ok.updatedAt).not.toBe(ctx.updatedAt)
  })

  it('renameContext returns null for unknown ids', async () => {
    expect(await renameContext('does-not-exist', 'X')).toBeNull()
  })

  it('deleteContext removes the context and erases its meta entries', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('Doomed')

    // Drop some meta + version entries inside this context's
    // namespace so we can verify they're cleaned up.
    const base = getBaseStorageAdapter()
    await base.setMeta(`ctx:${ctx.id}:projects`, '[]')
    await base.setMeta(`ctx:${ctx.id}:program-settings`, '{"foo":1}')
    await base.setMeta(`ctx:${ctx.id}:scaffold-version-p1-v1`, '{"id":"v1"}')

    const result = await deleteContext(ctx.id)
    expect(result.deleted).toBe(true)

    const registry = await loadContextRegistry()
    expect(registry.find((c) => c.id === ctx.id)).toBeUndefined()

    expect(await base.getMeta(`ctx:${ctx.id}:projects`)).toBeNull()
    expect(await base.getMeta(`ctx:${ctx.id}:program-settings`)).toBeNull()
    expect(await base.getMeta(`ctx:${ctx.id}:scaffold-version-p1-v1`)).toBeNull()
  })

  it('deleteContext refuses to remove the last remaining context', async () => {
    await ensureDefaultContext()
    const result = await deleteContext(DEFAULT_CONTEXT_ID)
    expect(result.deleted).toBe(false)
    expect(result.reason).toBe('last-context')
  })

  it('deleteContext reports not-found for unknown ids', async () => {
    await ensureDefaultContext()
    await createContext('Other') // ensure registry has >1 entry
    const result = await deleteContext('no-such-id')
    expect(result.deleted).toBe(false)
    expect(result.reason).toBe('not-found')
  })
})

describe('active context resolution', () => {
  it('returns null when no contexts exist', async () => {
    expect(await resolveActiveContextId()).toBeNull()
  })

  it('returns the persisted id when it points at an existing context', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('Personal')
    await setStoredActiveContextId(ctx.id)
    expect(await resolveActiveContextId()).toBe(ctx.id)
  })

  it('falls back to the first context when the persisted id is missing', async () => {
    await ensureDefaultContext()
    const ctx = await createContext('Personal')
    await setStoredActiveContextId('orphaned-id')
    const resolved = await resolveActiveContextId()
    // First registered context wins (the default).
    expect(resolved).toBe(DEFAULT_CONTEXT_ID)
    // We'd also accept the freshly-created one if iteration order
    // changed, but our seeding always puts the default first.
    expect([DEFAULT_CONTEXT_ID, ctx.id]).toContain(resolved)
  })

  it('clears persisted active id when set to null', async () => {
    await setStoredActiveContextId('x')
    await setStoredActiveContextId(null)
    expect(await getStoredActiveContextId()).toBeNull()
  })
})

describe('cloneContextData / createContext({ cloneFromId })', () => {
  it('cloneContextData copies every meta entry under ctx:<source>: into ctx:<target>:', async () => {
    const base = getBaseStorageAdapter()
    await base.setMeta('ctx:source:projects', '[{"id":"p1"}]')
    await base.setMeta('ctx:source:program-settings', '{"defaultListType":"unordered"}')
    await base.setMeta('ctx:source:scaffold-version-p1-v1', '{"id":"v1"}')
    // Unrelated entry that must NOT bleed into the target.
    await base.setMeta('ctx:other:projects', '[{"id":"x"}]')

    const result = await cloneContextData('source', 'target')
    expect(result.copied).toBe(3)

    expect(await base.getMeta('ctx:target:projects')).toBe('[{"id":"p1"}]')
    expect(await base.getMeta('ctx:target:program-settings')).toBe(
      '{"defaultListType":"unordered"}',
    )
    expect(await base.getMeta('ctx:target:scaffold-version-p1-v1')).toBe(
      '{"id":"v1"}',
    )
    // Source data must remain untouched.
    expect(await base.getMeta('ctx:source:projects')).toBe('[{"id":"p1"}]')
    // Other contexts' data must remain untouched.
    expect(await base.getMeta('ctx:target:other')).toBeNull()
  })

  it('cloneContextData is a no-op when source equals target', async () => {
    const base = getBaseStorageAdapter()
    await base.setMeta('ctx:same:projects', '[{"id":"p"}]')
    const result = await cloneContextData('same', 'same')
    expect(result.copied).toBe(0)
    // Existing data is preserved.
    expect(await base.getMeta('ctx:same:projects')).toBe('[{"id":"p"}]')
  })

  it('cloneContextData ignores missing ids', async () => {
    const result = await cloneContextData('', 'target')
    expect(result.copied).toBe(0)
  })

  it('createContext with cloneFromId seeds the new context with the source data', async () => {
    await ensureDefaultContext()
    const base = getBaseStorageAdapter()
    await base.setMeta('ctx:default:projects', '[{"id":"p","name":"Cloned"}]')
    await base.setMeta('ctx:default:program-settings', '{"defaultListType":"unordered"}')

    const ctx = await createContext('Forked', { cloneFromId: 'default' })

    expect(await base.getMeta(`ctx:${ctx.id}:projects`)).toBe(
      '[{"id":"p","name":"Cloned"}]',
    )
    expect(await base.getMeta(`ctx:${ctx.id}:program-settings`)).toBe(
      '{"defaultListType":"unordered"}',
    )
  })

  it('createContext without cloneFromId leaves the new namespace empty', async () => {
    await ensureDefaultContext()
    const base = getBaseStorageAdapter()
    await base.setMeta('ctx:default:projects', '[{"id":"p"}]')

    const ctx = await createContext('Fresh')
    expect(await base.getMeta(`ctx:${ctx.id}:projects`)).toBeNull()
  })
})

describe('saveContextRegistry', () => {
  it('persists arbitrary registry shapes verbatim', async () => {
    const registry = [
      {
        id: 'a',
        name: 'A',
        authProvider: 'local',
        externalSubject: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    await saveContextRegistry(registry)
    expect(await loadContextRegistry()).toEqual(registry)
  })
})
