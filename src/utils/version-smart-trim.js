import { parseVersionStorageValue } from 'src/utils/version-storage.js'

const MS_DAY = 86400000
const MS_48H = 48 * 60 * 60 * 1000
const MS_3D = 3 * MS_DAY
const MS_7D = 7 * MS_DAY
const MS_14D = 14 * MS_DAY

/**
 * @param {string} projectId
 * @returns {{ key: string, version: object }[]}
 */
export function listVersionEntriesForProject(projectId) {
  const prefix = `scaffold-version-${projectId}-`
  const entries = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    const raw = localStorage.getItem(key)
    if (raw == null) continue
    try {
      const version = parseVersionStorageValue(raw)
      if (version) entries.push({ key, version })
    } catch {
      // skip corrupt entries
    }
  }
  return entries
}

/**
 * Pure: which storage keys to remove (only auto-interval; never unknown trigger).
 * @param {{ key: string, version: object }[]} entries
 * @param {number} nowMs
 * @returns {Set<string>}
 */
export function selectIntervalVersionKeysToDelete(entries, nowMs) {
  const autoOnly = entries.filter((e) => e.version.trigger === 'auto-interval')
  const toDelete = new Set()

  for (const e of autoOnly) {
    const age = nowMs - e.version.timestamp
    if (age >= MS_14D) toDelete.add(e.key)
  }

  const band7_14 = autoOnly.filter((e) => {
    const age = nowMs - e.version.timestamp
    return age >= MS_7D && age < MS_14D
  })
  const buckets48 = new Map()
  for (const e of band7_14) {
    const age = nowMs - e.version.timestamp
    const bid = Math.floor(age / MS_48H)
    const prev = buckets48.get(bid)
    if (!prev || e.version.timestamp > prev.ts) {
      buckets48.set(bid, { key: e.key, ts: e.version.timestamp })
    }
  }
  const keep48 = new Set([...buckets48.values()].map((x) => x.key))
  for (const e of band7_14) {
    if (!keep48.has(e.key)) toDelete.add(e.key)
  }

  const band3_7 = autoOnly.filter((e) => {
    const age = nowMs - e.version.timestamp
    return age >= MS_3D && age < MS_7D
  })
  const dayMap = new Map()
  for (const e of band3_7) {
    const d = new Date(e.version.timestamp)
    const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const prev = dayMap.get(dayStr)
    if (!prev || e.version.timestamp > prev.ts) {
      dayMap.set(dayStr, { key: e.key, ts: e.version.timestamp })
    }
  }
  const keepDay = new Set([...dayMap.values()].map((x) => x.key))
  for (const e of band3_7) {
    if (!keepDay.has(e.key)) toDelete.add(e.key)
  }

  return toDelete
}

/**
 * @param {string} projectId
 * @param {number} [nowMs]
 */
export function applySmartTrimForProject(projectId, nowMs = Date.now()) {
  const entries = listVersionEntriesForProject(projectId)
  const keys = selectIntervalVersionKeysToDelete(entries, nowMs)
  for (const key of keys) {
    localStorage.removeItem(key)
  }
}

/**
 * Trim interval versions for every project in outline-projects.
 * @param {number} [nowMs]
 */
export function applySmartTrimForAllProjects(nowMs = Date.now()) {
  try {
    const raw = localStorage.getItem('outline-projects')
    if (!raw) return
    const projects = JSON.parse(raw)
    if (!Array.isArray(projects)) return
    for (const p of projects) {
      if (p?.id) applySmartTrimForProject(p.id, nowMs)
    }
  } catch {
    // ignore
  }
}
