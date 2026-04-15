import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTabInstanceId,
  readProjectLock,
  isLockRecordFresh,
  isProjectLockedByOtherTab,
  writeProjectLock,
  removeProjectLock,
  isProjectLockStorageKey,
  getProjectLockStorageKey,
  PROJECT_LOCK_KEY_PREFIX,
  PROJECT_LOCK_STALE_MS,
} from 'src/utils/project-tab-lock.js'

describe('getTabInstanceId', () => {
  it('returns a string', () => {
    expect(typeof getTabInstanceId()).toBe('string')
  })

  it('returns the same id on repeated calls (stable per session)', () => {
    const id1 = getTabInstanceId()
    const id2 = getTabInstanceId()
    expect(id1).toBe(id2)
  })

  it('stores id in sessionStorage', () => {
    const id = getTabInstanceId()
    expect(sessionStorage.getItem('scaffold-tab-instance-id')).toBe(id)
  })
})

describe('writeProjectLock / readProjectLock', () => {
  it('writes and reads a lock record', () => {
    writeProjectLock('proj-1', 'tab-abc')
    const record = readProjectLock('proj-1')

    expect(record).not.toBeNull()
    expect(record.holderTabId).toBe('tab-abc')
    expect(typeof record.heartbeatAt).toBe('number')
  })

  it('returns null for non-existent lock', () => {
    expect(readProjectLock('no-such-project')).toBeNull()
  })

  it('returns null for malformed lock data', () => {
    localStorage.setItem(getProjectLockStorageKey('bad'), 'not-json')
    expect(readProjectLock('bad')).toBeNull()
  })

  it('returns null for lock missing required fields', () => {
    localStorage.setItem(
      getProjectLockStorageKey('partial'),
      JSON.stringify({ holderTabId: 'x' }),
    )
    expect(readProjectLock('partial')).toBeNull()
  })
})

describe('isLockRecordFresh', () => {
  it('returns true for fresh record', () => {
    const record = { holderTabId: 'x', heartbeatAt: Date.now() }
    expect(isLockRecordFresh(record)).toBe(true)
  })

  it('returns false for stale record', () => {
    const record = { holderTabId: 'x', heartbeatAt: Date.now() - PROJECT_LOCK_STALE_MS - 1 }
    expect(isLockRecordFresh(record)).toBe(false)
  })

  it('returns false for null record', () => {
    expect(isLockRecordFresh(null)).toBe(false)
  })

  it('respects custom now parameter', () => {
    const record = { holderTabId: 'x', heartbeatAt: 1000 }
    expect(isLockRecordFresh(record, 1000 + PROJECT_LOCK_STALE_MS)).toBe(true)
    expect(isLockRecordFresh(record, 1000 + PROJECT_LOCK_STALE_MS + 1)).toBe(false)
  })
})

describe('isProjectLockedByOtherTab', () => {
  it('returns false when no lock exists', () => {
    expect(isProjectLockedByOtherTab('proj-1', 'tab-me')).toBe(false)
  })

  it('returns false when lock is held by same tab', () => {
    writeProjectLock('proj-1', 'tab-me')
    expect(isProjectLockedByOtherTab('proj-1', 'tab-me')).toBe(false)
  })

  it('returns true when lock is held by different tab and fresh', () => {
    writeProjectLock('proj-1', 'tab-other')
    expect(isProjectLockedByOtherTab('proj-1', 'tab-me')).toBe(true)
  })

  it('returns false when lock by other tab is stale', () => {
    localStorage.setItem(
      getProjectLockStorageKey('proj-1'),
      JSON.stringify({
        holderTabId: 'tab-other',
        heartbeatAt: Date.now() - PROJECT_LOCK_STALE_MS - 1000,
      }),
    )
    expect(isProjectLockedByOtherTab('proj-1', 'tab-me')).toBe(false)
  })
})

describe('removeProjectLock', () => {
  it('removes existing lock', () => {
    writeProjectLock('proj-1', 'tab-x')
    expect(readProjectLock('proj-1')).not.toBeNull()
    removeProjectLock('proj-1')
    expect(readProjectLock('proj-1')).toBeNull()
  })

  it('does not throw for non-existent lock', () => {
    expect(() => removeProjectLock('nonexistent')).not.toThrow()
  })
})

describe('isProjectLockStorageKey', () => {
  it('returns true for valid lock keys', () => {
    expect(isProjectLockStorageKey(`${PROJECT_LOCK_KEY_PREFIX}proj-1`)).toBe(true)
  })

  it('returns false for other keys', () => {
    expect(isProjectLockStorageKey('outline-projects')).toBe(false)
    expect(isProjectLockStorageKey('')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isProjectLockStorageKey(null)).toBe(false)
    expect(isProjectLockStorageKey(123)).toBe(false)
  })
})
