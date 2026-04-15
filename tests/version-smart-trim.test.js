import { describe, it, expect } from 'vitest'
import {
  listVersionEntriesForProject,
  selectIntervalVersionKeysToDelete,
  applySmartTrimForProject,
  applySmartTrimForAllProjects,
} from 'src/utils/version-smart-trim.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'

const MS_DAY = 86400000

async function seedVersion(projectId, versionId, timestamp, trigger = 'auto-interval') {
  const key = `scaffold-version-${projectId}-${versionId}`
  const data = {
    id: versionId,
    projectId,
    timestamp,
    trigger,
    stats: { items: 1, notes: 0 },
    data: {},
  }
  await getStorageAdapter().setMeta(key, JSON.stringify(data))
  return key
}

async function metaExists(key) {
  const val = await getStorageAdapter().getMeta(key)
  return val !== null
}

describe('listVersionEntriesForProject', () => {
  it('returns empty array when no versions exist', async () => {
    expect(await listVersionEntriesForProject('proj-1')).toEqual([])
  })

  it('lists all versions for a given project', async () => {
    await seedVersion('proj-1', 'v1', 1000)
    await seedVersion('proj-1', 'v2', 2000)
    await seedVersion('proj-2', 'v3', 3000)

    const entries = await listVersionEntriesForProject('proj-1')
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.version.projectId === 'proj-1')).toBe(true)
  })

  it('skips corrupt entries', async () => {
    await seedVersion('proj-1', 'v1', 1000)
    await getStorageAdapter().setMeta('scaffold-version-proj-1-bad', 'NOT JSON')

    const entries = await listVersionEntriesForProject('proj-1')
    expect(entries).toHaveLength(1)
  })
})

describe('selectIntervalVersionKeysToDelete', () => {
  const now = Date.now()

  it('returns empty set when no entries', () => {
    const result = selectIntervalVersionKeysToDelete([], now)
    expect(result.size).toBe(0)
  })

  it('does not touch non-auto-interval entries', () => {
    const entries = [
      {
        key: 'scaffold-version-p1-v1',
        version: { timestamp: now - 15 * MS_DAY, trigger: 'manual' },
      },
    ]
    const result = selectIntervalVersionKeysToDelete(entries, now)
    expect(result.size).toBe(0)
  })

  it('deletes auto-interval entries older than 14 days', () => {
    const entries = [
      {
        key: 'scaffold-version-p1-old',
        version: { timestamp: now - 15 * MS_DAY, trigger: 'auto-interval' },
      },
    ]
    const result = selectIntervalVersionKeysToDelete(entries, now)
    expect(result.has('scaffold-version-p1-old')).toBe(true)
  })

  it('keeps most recent auto-interval entry per 48h bucket in 7-14d band', () => {
    const MS_48H = 48 * 60 * 60 * 1000
    const ageBase = 8 * MS_DAY
    const tsOlder = now - ageBase - 2 * 3600000
    const tsNewer = now - ageBase

    const entries = [
      {
        key: 'scaffold-version-p1-a',
        version: { timestamp: tsOlder, trigger: 'auto-interval' },
      },
      {
        key: 'scaffold-version-p1-b',
        version: { timestamp: tsNewer, trigger: 'auto-interval' },
      },
    ]

    expect(Math.floor((now - tsOlder) / MS_48H)).toBe(Math.floor((now - tsNewer) / MS_48H))

    const result = selectIntervalVersionKeysToDelete(entries, now)
    expect(result.has('scaffold-version-p1-a')).toBe(true)
    expect(result.has('scaffold-version-p1-b')).toBe(false)
  })

  it('keeps most recent auto-interval entry per day in 3-7d band', () => {
    const base = now - 5 * MS_DAY
    const entries = [
      {
        key: 'scaffold-version-p1-morning',
        version: { timestamp: base, trigger: 'auto-interval' },
      },
      {
        key: 'scaffold-version-p1-evening',
        version: { timestamp: base + 6 * 3600000, trigger: 'auto-interval' },
      },
    ]
    const result = selectIntervalVersionKeysToDelete(entries, now)
    expect(result.has('scaffold-version-p1-morning')).toBe(true)
    expect(result.has('scaffold-version-p1-evening')).toBe(false)
  })

  it('does not delete entries less than 3 days old', () => {
    const entries = [
      {
        key: 'scaffold-version-p1-recent',
        version: { timestamp: now - 1 * MS_DAY, trigger: 'auto-interval' },
      },
    ]
    const result = selectIntervalVersionKeysToDelete(entries, now)
    expect(result.size).toBe(0)
  })
})

describe('applySmartTrimForProject', () => {
  it('removes keys selected for deletion', async () => {
    const now = Date.now()
    const oldKey = await seedVersion('proj-1', 'old', now - 15 * MS_DAY, 'auto-interval')

    expect(await metaExists(oldKey)).toBe(true)
    await applySmartTrimForProject('proj-1', now)
    expect(await metaExists(oldKey)).toBe(false)
  })

  it('is idempotent (second run removes nothing more)', async () => {
    const now = Date.now()
    await seedVersion('proj-1', 'old', now - 15 * MS_DAY, 'auto-interval')
    await seedVersion('proj-1', 'recent', now - MS_DAY, 'auto-interval')

    await applySmartTrimForProject('proj-1', now)
    const afterFirst = await listVersionEntriesForProject('proj-1')

    await applySmartTrimForProject('proj-1', now)
    const afterSecond = await listVersionEntriesForProject('proj-1')

    expect(afterSecond).toHaveLength(afterFirst.length)
  })

  it('preserves manual versions regardless of age', async () => {
    const now = Date.now()
    const manualKey = await seedVersion('proj-1', 'manual-old', now - 30 * MS_DAY, 'manual')

    await applySmartTrimForProject('proj-1', now)
    expect(await metaExists(manualKey)).toBe(true)
  })
})

describe('applySmartTrimForAllProjects', () => {
  it('no-ops when no projects exist', async () => {
    await expect(applySmartTrimForAllProjects(Date.now())).resolves.not.toThrow()
  })

  it('trims versions only for projects in storage', async () => {
    const now = Date.now()
    const adapter = getStorageAdapter()
    await adapter.saveProjects([{ id: 'proj-a' }, { id: 'proj-b' }])
    const oldA = await seedVersion('proj-a', 'old', now - 16 * MS_DAY)
    const oldB = await seedVersion('proj-b', 'old', now - 16 * MS_DAY)
    const oldOther = await seedVersion('proj-other', 'old', now - 16 * MS_DAY)

    await applySmartTrimForAllProjects(now)

    expect(await metaExists(oldA)).toBe(false)
    expect(await metaExists(oldB)).toBe(false)
    expect(await metaExists(oldOther)).toBe(true)
  })
})
