/**
 * Per-tab advisory locks in localStorage so another tab in the same browser
 * profile cannot select a project that is already open elsewhere.
 * Cross-browser / cross-device: out of scope (no shared storage).
 */

export const PROJECT_LOCK_KEY_PREFIX = 'scaffold-project-lock-'
export const TAB_INSTANCE_SESSION_KEY = 'scaffold-tab-instance-id'

/** Locks older than this are ignored (crashed tab / closed without unload). */
export const PROJECT_LOCK_STALE_MS = 15000

/** How often the owning tab renews its lock while a project is selected. */
export const PROJECT_LOCK_HEARTBEAT_MS = 4000

export function getProjectLockStorageKey(projectId) {
  return `${PROJECT_LOCK_KEY_PREFIX}${projectId}`
}

function randomTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Stable for the lifetime of this tab (sessionStorage). */
export function getTabInstanceId() {
  try {
    let id = sessionStorage.getItem(TAB_INSTANCE_SESSION_KEY)
    if (!id) {
      id = randomTabId()
      sessionStorage.setItem(TAB_INSTANCE_SESSION_KEY, id)
    }
    return id
  } catch {
    // sessionStorage unavailable (e.g. some private modes)
    return randomTabId()
  }
}

export function readProjectLock(projectId) {
  try {
    const raw = localStorage.getItem(getProjectLockStorageKey(projectId))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data.holderTabId !== 'string' || typeof data.heartbeatAt !== 'number') {
      return null
    }
    return data
  } catch {
    return null
  }
}

export function isLockRecordFresh(record, now = Date.now()) {
  if (!record) return false
  return now - record.heartbeatAt <= PROJECT_LOCK_STALE_MS
}

/** True if another tab holds a fresh lock on this project. */
export function isProjectLockedByOtherTab(projectId, myTabId = getTabInstanceId()) {
  const record = readProjectLock(projectId)
  if (!isLockRecordFresh(record)) return false
  return record.holderTabId !== myTabId
}

export function writeProjectLock(projectId, tabId = getTabInstanceId()) {
  try {
    const payload = JSON.stringify({
      holderTabId: tabId,
      heartbeatAt: Date.now(),
    })
    localStorage.setItem(getProjectLockStorageKey(projectId), payload)
  } catch {
    // quota / disabled storage
  }
}

export function removeProjectLock(projectId) {
  try {
    localStorage.removeItem(getProjectLockStorageKey(projectId))
  } catch {
    // ignore
  }
}

export function isProjectLockStorageKey(key) {
  return typeof key === 'string' && key.startsWith(PROJECT_LOCK_KEY_PREFIX)
}
