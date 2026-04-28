/**
 * Mark-and-sweep garbage collection for the media store.
 *
 * The live set is computed from persisted projects + persisted version
 * snapshots, not from in-memory state, so multi-tab edits and undo/redo
 * stacks don't accidentally classify still-referenced media as garbage.
 *
 * A grace window protects newly uploaded blobs that haven't yet been
 * saved into a long note (e.g., the user closed the editor without
 * saving). The default 24h window matches typical "did I mean to keep
 * this?" recovery time.
 */

import { getStorageAdapter } from '../storage/index.js'
import { getMediaAdapter } from './index.js'
import { collectProjectRefHashes } from './references.js'

export const DEFAULT_MEDIA_GC_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Build the live set of media hashes from persisted state.
 *
 * @returns {Promise<Set<string>>}
 */
export async function collectLiveMediaHashes() {
  const storage = getStorageAdapter()
  const live = new Set()

  const projects = await storage.loadProjects()
  for (const hash of collectProjectRefHashes(projects)) {
    live.add(hash)
  }

  const versionEntries = await storage.getMetaEntries('scaffold-version-')
  for (const entry of versionEntries) {
    let parsed = null
    try {
      parsed = JSON.parse(entry.value)
    } catch {
      continue
    }
    const versionProjects = parsed?.data?.projects || []
    for (const hash of collectProjectRefHashes(versionProjects)) {
      live.add(hash)
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
