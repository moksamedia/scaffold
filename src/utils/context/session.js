/**
 * Context registry and active-context helpers.
 *
 * A "context" is a first-class user-like profile that fully isolates
 * the app's persisted state: projects, version snapshots, program-
 * wide settings, and any media-backend configuration. Every context
 * has a stable id used to namespace all of its data via the
 * context-scoped storage adapter. Switching contexts feels like
 * signing in as a different user, except everything stays local.
 *
 * The registry itself (the list of contexts and which one is
 * currently active) lives at the BASE adapter level — outside any
 * context — so the switching layer can read/write it without
 * circular dependencies.
 *
 * Future-auth-readiness: each context carries placeholders for
 * `authProvider` and `externalSubject`. Local profiles use
 * `authProvider: 'local'` with a random id and `externalSubject:
 * null`. When real authentication is added (e.g. signed-in users,
 * OAuth subjects), the same record can carry the auth provider name
 * and the external subject id without changing any consumer of the
 * context model.
 */

import { getBaseStorageAdapter } from '../storage/index.js'
import { logger } from '../logging/logger.js'

const CONTEXTS_META_KEY = 'scaffold-contexts'
const ACTIVE_CONTEXT_META_KEY = 'scaffold-active-context'

export const DEFAULT_CONTEXT_ID = 'default'
export const DEFAULT_CONTEXT_NAME = 'Default'

/**
 * @typedef {Object} ScaffoldContext
 * @property {string} id
 * @property {string} name
 * @property {'local' | string} authProvider
 *   Always 'local' for now. Reserved so signed-in / OAuth contexts
 *   can carry their provider name when auth is added.
 * @property {string | null} externalSubject
 *   Reserved for the auth provider's stable user identifier.
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

function generateContextId() {
  return `ctx-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function buildLocalContext({ id, name }) {
  const ts = nowIso()
  return {
    id,
    name,
    authProvider: 'local',
    externalSubject: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

/**
 * Read the persisted list of contexts. Returns an empty array when
 * no registry has been written yet (i.e. before the first migration).
 *
 * @returns {Promise<ScaffoldContext[]>}
 */
export async function loadContextRegistry() {
  const base = getBaseStorageAdapter()
  const raw = await base.getMeta(CONTEXTS_META_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Persist the registry. Callers should always pass the full,
 * already-mutated array — this function does no merging.
 *
 * @param {ScaffoldContext[]} contexts
 */
export async function saveContextRegistry(contexts) {
  const base = getBaseStorageAdapter()
  await base.setMeta(CONTEXTS_META_KEY, JSON.stringify(contexts || []))
}

/**
 * @returns {Promise<string | null>} Persisted active context id, or
 *   null when none has been set yet.
 */
export async function getStoredActiveContextId() {
  const base = getBaseStorageAdapter()
  const value = await base.getMeta(ACTIVE_CONTEXT_META_KEY)
  return value || null
}

/**
 * Persist the active context id. Pass null/empty to clear it.
 *
 * @param {string | null} id
 */
export async function setStoredActiveContextId(id) {
  const base = getBaseStorageAdapter()
  if (id) {
    await base.setMeta(ACTIVE_CONTEXT_META_KEY, id)
  } else {
    await base.deleteMeta(ACTIVE_CONTEXT_META_KEY)
  }
}

/**
 * Make sure at least one context exists. When the registry is empty
 * we seed the canonical "Default" context so the app always has a
 * place to put data.
 *
 * @returns {Promise<ScaffoldContext[]>} The (possibly newly seeded)
 *   registry.
 */
export async function ensureDefaultContext() {
  let contexts = await loadContextRegistry()
  if (contexts.length === 0) {
    contexts = [
      buildLocalContext({ id: DEFAULT_CONTEXT_ID, name: DEFAULT_CONTEXT_NAME }),
    ]
    await saveContextRegistry(contexts)
  }
  return contexts
}

/**
 * Append a new local context to the registry. The supplied name is
 * trimmed; an empty/whitespace-only name falls back to "New Context".
 *
 * When `options.cloneFromId` is supplied, every meta entry stored
 * under the source context's `ctx:<sourceId>:` prefix is copied into
 * the new context's namespace before this function returns. The
 * caller is responsible for ensuring any in-flight in-memory state
 * has been flushed to storage first (typically by awaiting a
 * persistence helper on the outline store).
 *
 * @param {string} name
 * @param {{ cloneFromId?: string }} [options]
 * @returns {Promise<ScaffoldContext>}
 */
export async function createContext(name, options = {}) {
  const trimmed = (name || '').trim() || 'New Context'
  const contexts = await loadContextRegistry()
  const ctx = buildLocalContext({ id: generateContextId(), name: trimmed })
  contexts.push(ctx)
  await saveContextRegistry(contexts)
  if (options.cloneFromId) {
    await cloneContextData(options.cloneFromId, ctx.id)
  }
  return ctx
}

/**
 * Copy every meta entry stored under `ctx:<sourceId>:` into
 * `ctx:<targetId>:`. Used by `createContext({ cloneFromId })` so a
 * new context can start as a fresh fork of an existing one
 * (projects, versions, program settings, S3 config marker, etc.).
 *
 * Media bytes themselves don't need to be copied — they're content-
 * addressable and shared across contexts — only the references and
 * configuration metadata.
 *
 * Skips identical or missing ids and tolerates per-entry copy
 * failures so a single bad row can't abort the rest of the clone.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @returns {Promise<{ copied: number }>}
 */
export async function cloneContextData(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return { copied: 0 }
  }
  const base = getBaseStorageAdapter()
  const sourcePrefix = `ctx:${sourceId}:`
  const targetPrefix = `ctx:${targetId}:`
  let copied = 0
  try {
    const entries = await base.getMetaEntries(sourcePrefix)
    for (const entry of entries) {
      const suffix = entry.key.slice(sourcePrefix.length)
      try {
        await base.setMeta(`${targetPrefix}${suffix}`, entry.value)
        copied += 1
      } catch (error) {
        logger.error('context.clone.copy.failed', error, {
          legacyKey: entry.key,
          sourceContextId: sourceId,
          targetContextId: targetId,
        })
      }
    }
  } catch (error) {
    logger.error('context.clone.enumerate.failed', error, {
      sourceContextId: sourceId,
      targetContextId: targetId,
    })
  }
  return { copied }
}

/**
 * Rename an existing context. Returns the updated record, or null
 * when the context isn't found / the new name is empty.
 *
 * @param {string} id
 * @param {string} name
 * @returns {Promise<ScaffoldContext | null>}
 */
export async function renameContext(id, name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const contexts = await loadContextRegistry()
  const ctx = contexts.find((c) => c.id === id)
  if (!ctx) return null
  ctx.name = trimmed
  ctx.updatedAt = nowIso()
  await saveContextRegistry(contexts)
  return ctx
}

/**
 * Remove a context from the registry and erase every meta entry
 * stored under its `ctx:<id>:` prefix. The shared media store is
 * left untouched: bytes referenced by other contexts must remain
 * reachable, and orphans get cleaned up by the regular media GC pass
 * when those references go away.
 *
 * Refuses to delete the last remaining context — there must always
 * be at least one place for data to live.
 *
 * @param {string} id
 * @returns {Promise<{ deleted: boolean, reason?: string }>}
 */
export async function deleteContext(id) {
  const base = getBaseStorageAdapter()
  const contexts = await loadContextRegistry()
  if (contexts.length <= 1) {
    return { deleted: false, reason: 'last-context' }
  }
  const filtered = contexts.filter((c) => c.id !== id)
  if (filtered.length === contexts.length) {
    return { deleted: false, reason: 'not-found' }
  }
  await saveContextRegistry(filtered)

  // Wipe meta entries belonging to this context (projects blob,
  // versions, program-settings, S3 config, etc.).
  const prefix = `ctx:${id}:`
  try {
    const entries = await base.getMetaEntries(prefix)
    for (const entry of entries) {
      try {
        await base.deleteMeta(entry.key)
      } catch (error) {
        logger.error('context.delete.entry.failed', error, {
          legacyKey: entry.key,
          contextId: id,
        })
      }
    }
  } catch (error) {
    logger.error('context.delete.enumerate.failed', error, {
      contextId: id,
    })
  }

  return { deleted: true }
}

/**
 * Resolve the context id that should be made active right now. When
 * the persisted active id is missing or no longer in the registry,
 * fall back to the first available context.
 *
 * @returns {Promise<string | null>}
 */
export async function resolveActiveContextId() {
  const contexts = await loadContextRegistry()
  if (contexts.length === 0) return null
  const stored = await getStoredActiveContextId()
  if (stored && contexts.some((c) => c.id === stored)) {
    return stored
  }
  return contexts[0].id
}
