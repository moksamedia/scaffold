/**
 * Mark-and-sweep garbage collection for the media store.
 *
 * The live set is computed from persisted projects + persisted version
 * snapshots, not from in-memory state, so multi-tab edits and undo/redo
 * stacks don't accidentally classify still-referenced media as garbage.
 *
 * Crucially the live set is computed across EVERY context, not just
 * the active one. Media bytes are content-addressable and physically
 * shared across contexts (the IDB / OPFS / S3 store is per-origin,
 * not per-context), so a hash referenced by any context — even one
 * we're not currently in — must be kept. Without this, switching
 * contexts and then triggering GC would delete media that other
 * contexts still need.
 *
 * A grace window protects newly uploaded blobs that haven't yet been
 * saved into a long note (e.g., the user closed the editor without
 * saving). The default 24h window matches typical "did I mean to keep
 * this?" recovery time.
 */

import { getBaseStorageAdapter } from '../storage/index.js'
import { getMediaAdapter } from './index.js'
import { collectProjectRefHashes } from './references.js'

export const DEFAULT_MEDIA_GC_GRACE_MS = 24 * 60 * 60 * 1000

const CONTEXTS_META_KEY = 'scaffold-contexts'

/**
 * Pull the registered context ids out of the base meta store.
 *
 * @param {import('../storage/storage-adapter.js').StorageAdapter} base
 * @returns {Promise<string[]>}
 */
async function readRegisteredContextIds(base) {
  const raw = await base.getMeta(CONTEXTS_META_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((c) => c?.id).filter((id) => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * Read the projects blob and version meta entries belonging to a
 * single context (via the unscoped base adapter), and add every
 * media reference encountered to `live`.
 *
 * @param {import('../storage/storage-adapter.js').StorageAdapter} base
 * @param {string | null} contextId
 *   When null, reads the legacy unprefixed layout (used as a
 *   fallback when no context registry exists yet — e.g. on the
 *   very first launch before migration runs).
 * @param {Set<string>} live
 */
async function addLiveHashesForNamespace(base, contextId, live) {
  if (contextId === null) {
    const projects = await base.loadProjects()
    for (const hash of collectProjectRefHashes(projects)) live.add(hash)
    const versionEntries = await base.getMetaEntries('scaffold-version-')
    for (const entry of versionEntries) {
      let parsed = null
      try {
        parsed = JSON.parse(entry.value)
      } catch {
        continue
      }
      const versionProjects = parsed?.data?.projects || []
      for (const hash of collectProjectRefHashes(versionProjects)) live.add(hash)
    }
    return
  }

  const prefix = `ctx:${contextId}:`
  const projectsRaw = await base.getMeta(`${prefix}projects`)
  if (projectsRaw) {
    try {
      const projects = JSON.parse(projectsRaw)
      if (Array.isArray(projects)) {
        for (const hash of collectProjectRefHashes(projects)) live.add(hash)
      }
    } catch {
      // Skip malformed projects payload but keep walking other namespaces.
    }
  }

  const versionEntries = await base.getMetaEntries(`${prefix}scaffold-version-`)
  for (const entry of versionEntries) {
    let parsed = null
    try {
      parsed = JSON.parse(entry.value)
    } catch {
      continue
    }
    const versionProjects = parsed?.data?.projects || []
    for (const hash of collectProjectRefHashes(versionProjects)) live.add(hash)
  }
}

/**
 * Build the union of live media hashes referenced by any context's
 * persisted projects or version snapshots.
 *
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveMediaHashes() {
  const base = getBaseStorageAdapter()
  const live = new Set()

  const contextIds = await readRegisteredContextIds(base)

  if (contextIds.length === 0) {
    // No context registry yet (e.g. first launch before migration).
    // Fall back to the legacy single-namespace layout so GC still
    // works during the bootstrap window.
    await addLiveHashesForNamespace(base, null, live)
    return live
  }

  for (const id of contextIds) {
    await addLiveHashesForNamespace(base, id, live)
  }
  return live
}

/**
 * Live-set helper used by the shared-bucket "purge from S3" prompt.
 * Returns the union of media hashes referenced by every persisted
 * context EXCEPT the project being deleted. Used to guarantee we
 * never propose evicting a hash that another context still needs.
 *
 * @param {string} excludeProjectId - project id to ignore inside its
 *   context's projects blob (its versions are still considered live).
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveMediaHashesExcludingProject(excludeProjectId) {
  const base = getBaseStorageAdapter()
  const live = new Set()
  const contextIds = await readRegisteredContextIds(base)
  if (contextIds.length === 0) return live

  for (const id of contextIds) {
    const prefix = `ctx:${id}:`

    // Projects (with the targeted project removed).
    const projectsRaw = await base.getMeta(`${prefix}projects`)
    if (projectsRaw) {
      try {
        const projects = JSON.parse(projectsRaw)
        if (Array.isArray(projects)) {
          const filtered = projects.filter((p) => p?.id !== excludeProjectId)
          for (const hash of collectProjectRefHashes(filtered)) live.add(hash)
        }
      } catch {
        // Skip malformed payload.
      }
    }

    // Version snapshots — kept as-is. A version of the deleted
    // project is still a snapshot the user might restore, so its
    // hashes count as live.
    const versionEntries = await base.getMetaEntries(`${prefix}scaffold-version-`)
    for (const entry of versionEntries) {
      let parsed = null
      try {
        parsed = JSON.parse(entry.value)
      } catch {
        continue
      }
      const versionProjects = parsed?.data?.projects || []
      for (const hash of collectProjectRefHashes(versionProjects)) live.add(hash)
    }
  }
  return live
}

/**
 * Walk every blob in the media store and delete any whose hash is not in
 * the live set, subject to the grace window for recently-created blobs.
 *
 * @param {{ now?: number, graceMs?: number }} [options]
 * @returns {Promise<{deleted: number, kept: number, skippedByGrace: number}>}
 */
export async function runMediaGc(options = {}) {
  const adapter = getMediaAdapter()
  const now = options.now ?? Date.now()
  const graceMs = options.graceMs ?? DEFAULT_MEDIA_GC_GRACE_MS

  const live = await collectLiveMediaHashes()
  const stats = { deleted: 0, kept: 0, skippedByGrace: 0 }

  const hashes = await adapter.listHashes()
  for (const hash of hashes) {
    if (live.has(hash)) {
      stats.kept++
      continue
    }
    const row = await adapter.get(hash)
    const createdAt = row?.createdAt || 0
    if (createdAt && now - createdAt < graceMs) {
      stats.skippedByGrace++
      continue
    }
    await adapter.delete(hash)
    stats.deleted++
  }

  return stats
}
