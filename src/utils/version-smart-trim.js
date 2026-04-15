import { parseVersionStorageValue } from 'src/utils/version-storage.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'

const MS_DAY = 86400000
const MS_48H = 48 * 60 * 60 * 1000
const MS_3D = 3 * MS_DAY
const MS_7D = 7 * MS_DAY
const MS_14D = 14 * MS_DAY

/**
 * @param {string} projectId
 * @param {import('../storage/storage-adapter.js').StorageAdapter} [adapter]
 * @returns {Promise<{ key: string, version: object }[]>}
 */
export async function listVersionEntriesForProject(projectId, adapter) {
  const a = adapter || getStorageAdapter()
  const prefix = `scaffold-version-${projectId}-`
  const raw = await a.getMetaEntries(prefix)
  const entries = []
  for (const { key, value } of raw) {
    if (value == null) continue
    try {
      const version = parseVersionStorageValue(value)
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
 * @param {import('../storage/storage-adapter.js').StorageAdapter} [adapter]
 */
export async function applySmartTrimForProject(projectId, nowMs = Date.now(), adapter) {
  const a = adapter || getStorageAdapter()
  const entries = await listVersionEntriesForProject(projectId, a)
  const keys = selectIntervalVersionKeysToDelete(entries, nowMs)
  for (const key of keys) {
    await a.deleteMeta(key)
  }
}

/**
 * Trim interval versions for every project.
 * @param {number} [nowMs]
 * @param {import('../storage/storage-adapter.js').StorageAdapter} [adapter]
 */
export async function applySmartTrimForAllProjects(nowMs = Date.now(), adapter) {
  try {
    const a = adapter || getStorageAdapter()
    const projects = await a.loadProjects()
    if (!Array.isArray(projects)) return
    for (const p of projects) {
      if (p?.id) await applySmartTrimForProject(p.id, nowMs, a)
    }
  } catch {
    // ignore
  }
}
