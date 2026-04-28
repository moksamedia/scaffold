/**
 * One-time, idempotent migration that converts pre-context legacy
 * data layouts into the new context-scoped namespace.
 *
 * Before context isolation, the app stored everything at the root of
 * the meta store (and in the projects object store). This migration
 * moves that data into the canonical default context's
 * `ctx:default:` namespace and deletes the legacy keys, so that
 * subsequent reads through the context-scoped adapter see the same
 * content the user always had.
 *
 * The migration is gated by the presence of a non-empty
 * `scaffold-contexts` registry: once that exists, the migration is
 * a no-op. Tests that wipe storage between runs will see it execute
 * fresh; production clients see it execute exactly once.
 */

import { getBaseStorageAdapter } from '../storage/index.js'
import {
  DEFAULT_CONTEXT_ID,
  ensureDefaultContext,
  loadContextRegistry,
  setStoredActiveContextId,
} from './session.js'
import { logger } from '../logging/logger.js'

// Meta keys that historically lived at the meta-store root and now
// belong inside the active context. Anything app-wide that isn't
// truly cross-context (the registry, the active-context pointer, and
// app-level lock keys) belongs here.
const LEGACY_FLAT_META_KEYS = [
  'current-project',
  'font-scale',
  'program-settings',
  'media-s3-config',
  'media-userfolder-handle',
]

// Meta key prefixes whose entries are per-context. Each matching
// entry is moved to `ctx:default:<original-key>` and then the legacy
// entry is deleted.
const LEGACY_PREFIX_META_KEYS = ['scaffold-version-']

/**
 * @returns {Promise<{ migrated: boolean, contextId?: string }>}
 */
export async function runContextMigration() {
  const base = getBaseStorageAdapter()

  const existing = await loadContextRegistry()
  if (existing.length > 0) {
    // Registry already populated → migration has run before. Idempotent no-op.
    return { migrated: false }
  }

  // Seed the default context first so concurrent readers always see
  // a stable list while we shuffle data around.
  const contexts = await ensureDefaultContext()
  const targetCtx =
    contexts.find((c) => c.id === DEFAULT_CONTEXT_ID) || contexts[0]
  if (!targetCtx) return { migrated: false }
  const prefix = `ctx:${targetCtx.id}:`

  // 1. Move legacy projects (object store / `outline-projects` key)
  //    into the meta blob. We always clear the legacy projects
  //    backing afterwards so subsequent loads don't double-account.
  try {
    const legacyProjects = await base.loadProjects()
    if (Array.isArray(legacyProjects) && legacyProjects.length > 0) {
      await base.setMeta(`${prefix}projects`, JSON.stringify(legacyProjects))
      await base.saveProjects([])
    }
  } catch (error) {
    logger.error('context.migration.legacyProjects.failed', error, {
      phase: 'projects',
      contextId: targetCtx.id,
    })
  }

  // 2. Move legacy flat meta keys → ctx-prefixed.
  for (const key of LEGACY_FLAT_META_KEYS) {
    try {
      const value = await base.getMeta(key)
      if (value !== null && value !== undefined) {
        await base.setMeta(`${prefix}${key}`, value)
        await base.deleteMeta(key)
      }
    } catch (error) {
      logger.error('context.migration.flatMeta.failed', error, {
        phase: 'flatMeta',
        legacyKey: key,
        contextId: targetCtx.id,
      })
    }
  }

  // 3. Move legacy prefix-based meta keys → ctx-prefixed.
  for (const legacyPrefix of LEGACY_PREFIX_META_KEYS) {
    try {
      const entries = await base.getMetaEntries(legacyPrefix)
      for (const entry of entries) {
        // Skip entries that already live under a `ctx:` namespace
        // (defensive — shouldn't happen on a correctly-versioned store).
        if (entry.key.startsWith('ctx:')) continue
        try {
          await base.setMeta(`${prefix}${entry.key}`, entry.value)
          await base.deleteMeta(entry.key)
        } catch (error) {
          logger.error('context.migration.prefixMeta.move.failed', error, {
            phase: 'prefixMeta',
            legacyKey: entry.key,
            contextId: targetCtx.id,
          })
        }
      }
    } catch (error) {
      logger.error('context.migration.prefixMeta.enumerate.failed', error, {
        phase: 'prefixMeta',
        legacyPrefix,
        contextId: targetCtx.id,
      })
    }
  }

  // Mark the migration's chosen context as the persisted active one
  // so the very next launch comes back to the same place.
  try {
    await setStoredActiveContextId(targetCtx.id)
  } catch (error) {
    logger.error('context.migration.setActive.failed', error, {
      phase: 'activeContext',
      contextId: targetCtx.id,
    })
  }

  return { migrated: true, contextId: targetCtx.id }
}
