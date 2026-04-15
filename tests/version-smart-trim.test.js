import { describe, it, expect, beforeEach } from 'vitest'
import {
  listVersionEntriesForProject,
  selectIntervalVersionKeysToDelete,
  applySmartTrimForProject,
} from 'src/utils/version-smart-trim.js'

const MS_DAY = 86400000

function seedVersion(projectId, versionId, timestamp, trigger = 'auto-interval') {
  const key = `scaffold-version-${projectId}-${versionId}`
  const data = {
    id: versionId,
    projectId,
    timestamp,
    trigger,
    stats: { items: 1, notes: 0 },
    data: {},
  }
  localStorage.setItem(key, JSON.stringify(data))
  return key
}

describe('listVersionEntriesForProject', () => {
  it('returns empty array when no versions exist', () => {
    expect(listVersionEntriesForProject('proj-1')).toEqual([])
  })

  it('lists all versions for a given project', () => {
    seedVersion('proj-1', 'v1', 1000)
    seedVersion('proj-1', 'v2', 2000)
    seedVersion('proj-2', 'v3', 3000)

    const entries = listVersionEntriesForProject('proj-1')
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.version.projectId === 'proj-1')).toBe(true)
  })

  it('skips corrupt entries', () => {
    seedVersion('proj-1', 'v1', 1000)
    localStorage.setItem('scaffold-version-proj-1-bad', 'NOT JSON')

    const entries = listVersionEntriesForProject('proj-1')
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
    // Two entries in the same 48h bucket (ages differ by a few hours).
    // The algorithm keeps the most recent per bucket and deletes the rest.
    const MS_48H = 48 * 60 * 60 * 1000
    // Place both entries at the same age bucket.  age = now - timestamp.
    // Bucket id = Math.floor(age / MS_48H). Use an age of exactly 8 days.
    const ageBase = 8 * MS_DAY
    const tsOlder = now - ageBase - 2 * 3600000 // 2 hours deeper into bucket
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

    // Verify both land in the same bucket
    expect(Math.floor((now - tsOlder) / MS_48H)).toBe(Math.floor((now - tsNewer) / MS_48H))

    const result = selectIntervalVersionKeysToDelete(entries, now)
    // b is more recent in the same bucket so it's kept; a is deleted
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
  it('removes keys selected for deletion from localStorage', () => {
    const now = Date.now()
    const oldKey = seedVersion('proj-1', 'old', now - 15 * MS_DAY, 'auto-interval')

    expect(localStorage.getItem(oldKey)).not.toBeNull()
    applySmartTrimForProject('proj-1', now)
    expect(localStorage.getItem(oldKey)).toBeNull()
  })

  it('is idempotent (second run removes nothing more)', () => {
    const now = Date.now()
    seedVersion('proj-1', 'old', now - 15 * MS_DAY, 'auto-interval')
    seedVersion('proj-1', 'recent', now - MS_DAY, 'auto-interval')

    applySmartTrimForProject('proj-1', now)
    const afterFirst = listVersionEntriesForProject('proj-1')

    applySmartTrimForProject('proj-1', now)
    const afterSecond = listVersionEntriesForProject('proj-1')

    expect(afterSecond).toHaveLength(afterFirst.length)
  })

  it('preserves manual versions regardless of age', () => {
    const now = Date.now()
    const manualKey = seedVersion('proj-1', 'manual-old', now - 30 * MS_DAY, 'manual')

    applySmartTrimForProject('proj-1', now)
    expect(localStorage.getItem(manualKey)).not.toBeNull()
  })
})
