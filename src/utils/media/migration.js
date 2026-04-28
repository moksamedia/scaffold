/**
 * One-time migration from inline `data:` URIs in long-note HTML to the
 * `scaffold-media://<hash>` reference scheme.
 *
 * Idempotent: re-running the migration is a no-op because IDs are
 * content hashes. Safe to invoke on every app load.
 */

import { getStorageAdapter } from '../storage/index.js'
import { rewriteDataUrisToRefs, transformLongNoteHtmlInPlace } from './references.js'
import { ingestDataUrl } from './ingest.js'

async function ingestAndReturnHash(dataUrl) {
  const { hash } = await ingestDataUrl(dataUrl)
  return hash
}

async function rewriteItems(items) {
  return transformLongNoteHtmlInPlace(items, async (html) => {
    return rewriteDataUrisToRefs(html, ingestAndReturnHash)
  })
}

/**
 * Migrate every project's long-note HTML in place. Returns whether any
 * project was rewritten (so the caller can decide whether to persist).
 *
 * @returns {Promise<{migratedProjectCount: number, anyChanged: boolean}>}
 */
export async function migrateProjectsToReferences() {
  const storage = getStorageAdapter()
  const projects = await storage.loadProjects()
  let migratedProjectCount = 0
  for (const project of projects) {
    const changed = await rewriteItems(project.lists || [])
    if (changed) migratedProjectCount++
  }
  if (migratedProjectCount > 0) {
    await storage.saveProjects(projects)
  }
  return { migratedProjectCount, anyChanged: migratedProjectCount > 0 }
}

/**
 * Migrate every persisted version snapshot's long-note HTML in place.
 * Version snapshots use `items` (export shape), not `lists` (runtime
 * shape), but `transformLongNoteHtmlInPlace` walks any tree that uses
 * `longNotes` + `children`, which both shapes share.
 *
 * @returns {Promise<{migratedVersionCount: number}>}
 */
export async function migrateVersionsToReferences() {
  const storage = getStorageAdapter()
  const entries = await storage.getMetaEntries('scaffold-version-')
  let migratedVersionCount = 0

  for (const entry of entries) {
    let parsed = null
    try {
      parsed = JSON.parse(entry.value)
    } catch {
      continue
    }
    const versionProjects = parsed?.data?.projects || []
    let anyChanged = false
    for (const project of versionProjects) {
      const items = Array.isArray(project.lists)
        ? project.lists
        : Array.isArray(project.items)
          ? project.items
          : []
      if (items.length === 0) continue
      const changed = await rewriteItems(items)
      if (changed) anyChanged = true
    }
    if (anyChanged) {
      await storage.setMeta(entry.key, JSON.stringify(parsed))
      migratedVersionCount++
    }
  }

  return { migratedVersionCount }
}

/**
 * Run both project and version migrations.
 *
 * @returns {Promise<{migratedProjectCount: number, migratedVersionCount: number}>}
 */
export async function runMediaMigration() {
  const projectsResult = await migrateProjectsToReferences()
  const versionsResult = await migrateVersionsToReferences()
  return {
    migratedProjectCount: projectsResult.migratedProjectCount,
    migratedVersionCount: versionsResult.migratedVersionCount,
  }
}
