import { describe, it, expect } from 'vitest'
import {
  createContextScopedAdapter,
  getContextMetaPrefix,
} from 'src/utils/storage/context-scoped.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'

function makeBlob(text, mime = 'text/plain') {
  return new Blob([new TextEncoder().encode(text)], { type: mime })
}

describe('createContextScopedAdapter', () => {
  it('rejects construction without a context id', () => {
    const base = createLocalStorageAdapter()
    expect(() => createContextScopedAdapter(base, '')).toThrow()
    expect(() => createContextScopedAdapter(base, null)).toThrow()
  })

  it('rejects construction without a base adapter', () => {
    expect(() => createContextScopedAdapter(null, 'a')).toThrow()
  })

  it('namespaces meta reads/writes under ctx:<id>:', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const b = createContextScopedAdapter(base, 'beta')

    await a.setMeta('hello', 'A')
    await b.setMeta('hello', 'B')

    expect(await a.getMeta('hello')).toBe('A')
    expect(await b.getMeta('hello')).toBe('B')
    expect(await base.getMeta('hello')).toBeNull()
    expect(await base.getMeta('ctx:alpha:hello')).toBe('A')
    expect(await base.getMeta('ctx:beta:hello')).toBe('B')
  })

  it('returns getMetaEntries with the ctx prefix stripped', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')

    await a.setMeta('scaffold-version-p1-v1', 'one')
    await a.setMeta('scaffold-version-p1-v2', 'two')
    await a.setMeta('scaffold-version-p2-v3', 'three')
    await a.setMeta('something-else', 'four')

    const entries = await a.getMetaEntries('scaffold-version-p1-')
    expect(entries.map((e) => e.key).sort()).toEqual([
      'scaffold-version-p1-v1',
      'scaffold-version-p1-v2',
    ])
  })

  it('isolates projects between contexts', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const b = createContextScopedAdapter(base, 'beta')

    await a.saveProjects([{ id: 'pa', name: 'A1' }])
    await b.saveProjects([{ id: 'pb', name: 'B1' }, { id: 'pb2', name: 'B2' }])

    expect((await a.loadProjects()).map((p) => p.id)).toEqual(['pa'])
    expect((await b.loadProjects()).map((p) => p.id).sort()).toEqual(['pb', 'pb2'])

    // Underlying base.loadProjects() (the legacy path) is not used
    // by the scoped adapter, so it stays empty.
    expect(await base.loadProjects()).toEqual([])
  })

  it('saveProject upserts within a single context only', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const b = createContextScopedAdapter(base, 'beta')

    await a.saveProject({ id: 'shared', name: 'A copy' })
    await b.saveProject({ id: 'shared', name: 'B copy' })

    expect((await a.getProject('shared')).name).toBe('A copy')
    expect((await b.getProject('shared')).name).toBe('B copy')
  })

  it('deleteMeta removes only the namespaced key', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const b = createContextScopedAdapter(base, 'beta')

    await a.setMeta('shared', 'A')
    await b.setMeta('shared', 'B')

    await a.deleteMeta('shared')
    expect(await a.getMeta('shared')).toBeNull()
    expect(await b.getMeta('shared')).toBe('B')
  })

  it('passes media calls through to the base adapter', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const b = createContextScopedAdapter(base, 'beta')

    const HASH = 'a'.repeat(64)
    await a.putMedia(HASH, makeBlob('shared bytes'), 'text/plain')

    // Both contexts see the same blob: the physical media store is
    // intentionally shared because content-addressable bytes are
    // identical regardless of which context references them.
    expect(await a.hasMedia(HASH)).toBe(true)
    expect(await b.hasMedia(HASH)).toBe(true)

    const stats = await a.getMediaStats()
    expect(stats.count).toBe(1)
  })

  it('getStorageStats passes through unchanged', async () => {
    const base = createLocalStorageAdapter()
    const a = createContextScopedAdapter(base, 'alpha')
    const stats = await a.getStorageStats()
    expect(typeof stats.used).toBe('number')
    expect(typeof stats.quota).toBe('number')
  })

  it('handles malformed projects payload gracefully', async () => {
    const base = createLocalStorageAdapter()
    await base.setMeta('ctx:alpha:projects', 'not-json')
    const a = createContextScopedAdapter(base, 'alpha')
    expect(await a.loadProjects()).toEqual([])
  })

  it('returns empty when projects JSON is not an array', async () => {
    const base = createLocalStorageAdapter()
    await base.setMeta('ctx:alpha:projects', '{"oops": true}')
    const a = createContextScopedAdapter(base, 'alpha')
    expect(await a.loadProjects()).toEqual([])
  })
})

describe('getContextMetaPrefix', () => {
  it('returns ctx:<id>: for valid ids', () => {
    expect(getContextMetaPrefix('alpha')).toBe('ctx:alpha:')
    expect(getContextMetaPrefix('default')).toBe('ctx:default:')
  })

  it('throws on empty id', () => {
    expect(() => getContextMetaPrefix('')).toThrow()
    expect(() => getContextMetaPrefix(null)).toThrow()
  })
})
