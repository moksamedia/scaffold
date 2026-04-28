/**
 * Centralized application logger.
 *
 * Provides three levels — `debug`, `info`, `error` — routed through a
 * single structured-output pipeline so user-reported issues and async
 * flow diagnostics share one schema and one verbosity dial.
 *
 * Output schema:
 *   { level, event, description, operatorHint, ts, ...payload }
 *
 * Where:
 *   - `level`: one of LEVELS.
 *   - `event`: stable dot-style id (e.g. `context.switch.failed`).
 *   - `ts`: ISO timestamp at emission.
 *   - `payload`: structured fields including normalized error data.
 *
 * Behavior:
 *   - Level gating via {@link setLevel}; defaults to `info` (or `debug`
 *     when `LOG_LEVEL` / dev mode is detected).
 *   - Sensitive fields are redacted (see SENSITIVE_KEY_PATTERN).
 *   - Errors are normalized to `{ errorName, errorMessage, errorStack }`.
 *   - String payload truncation to keep console output manageable.
 *   - In-memory ring buffer (default 200 entries) for the diagnostics
 *     export feature (`getRecentLogs`).
 *
 * Tests can swap the underlying sink with {@link setSink} and inspect
 * the ring buffer with {@link getRecentLogs} / clear it with
 * {@link clearLogs}.
 */

export const LEVELS = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  ERROR: 'error',
})

const LEVEL_ORDER = { debug: 10, info: 20, error: 40, silent: 100 }

const EVENT_STATUS_SUFFIX = Object.freeze({
  start: 'started',
  started: 'started',
  success: 'succeeded',
  succeeded: 'succeeded',
  failed: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  skipped: 'skipped',
  hit: 'hit',
  miss: 'missed',
  noop: 'made no changes',
  cleared: 'cleared',
  created: 'created',
  completed: 'completed',
  requested: 'requested',
  detected: 'detected',
  loaded: 'loaded',
  saved: 'saved',
  restored: 'restored',
  disconnected: 'disconnected',
  connected: 'connected',
  disposed: 'disposed',
  migrated: 'migrated',
  unlocked: 'unlocked',
  locked: 'locked',
})

const EVENT_TOKEN_LABELS = Object.freeze({
  app: 'app',
  autoversion: 'auto-versioning',
  context: 'context',
  contexts: 'contexts',
  diagnostics: 'diagnostics',
  docx: 'DOCX',
  gc: 'GC',
  idb: 'IndexedDB',
  import: 'import',
  init: 'init',
  media: 'media',
  opfs: 'OPFS',
  persist: 'persistence',
  s3: 'S3',
  settings: 'settings',
  sync: 'sync',
  uri: 'URI',
  uris: 'URIs',
  userfolder: 'user folder',
  userflow: 'user flow',
  version: 'version',
})

const EVENT_DESCRIPTIONS = Object.freeze({
  'app.init.activeContext.persist.failed':
    'Failed to persist the resolved active context id during app initialization',
  'app.init.activeContext.resolve.failed':
    'Failed to resolve which context should be active during app initialization',
  'app.init.contexts.load.failed': 'Failed to load the persisted context registry during startup',
  'app.init.contexts.start': 'Starting context bootstrap and migration checks',
  'app.init.contexts.success':
    'Finished loading context registry and selecting the active context',
  'app.init.failed': 'Application startup failed',
  'app.init.migration.failed': 'Legacy-to-context storage migration failed during startup',
  'app.init.migration.success': 'Legacy-to-context storage migration completed during startup',
  'app.init.programSettings.parse.failed':
    'Program settings payload was present but could not be parsed for this context',
  'app.init.start': 'Application initialization started',
  'app.init.success': 'Application initialization completed successfully',
  'autoversion.teardown.failed':
    'Failed while tearing down auto-versioning listeners or timers before reconfiguration',
  'context.clone.copy.failed':
    'Failed to copy a namespaced key while cloning one context into another',
  'context.clone.enumerate.failed':
    'Failed to enumerate namespaced keys while cloning context data',
  'context.create.flushBeforeClone.failed':
    'Failed to persist in-memory changes before cloning the current context',
  'context.create.success': 'Created a new context record and optional seed data',
  'context.create.userFlow.failed': 'Create-context dialog flow failed in the UI',
  'context.delete.entry.failed': 'Failed to delete one namespaced entry while deleting a context',
  'context.delete.enumerate.failed':
    'Failed to enumerate namespaced entries while deleting a context',
  'context.delete.userFlow.failed': 'Delete-context dialog flow failed in the UI',
  'context.hydrate.start': 'Started hydrating state for the active context',
  'context.hydrate.success':
    'Finished hydrating the active context including backend selection and settings',
  'context.migration.flatMeta.failed':
    'Failed moving one legacy flat meta key into the default context namespace',
  'context.migration.legacyProjects.failed':
    'Failed migrating legacy projects payload into the default context namespace',
  'context.migration.prefixMeta.enumerate.failed':
    'Failed to enumerate legacy version-prefixed meta keys during context migration',
  'context.migration.prefixMeta.move.failed':
    'Failed moving one legacy version-prefixed meta key into the default context namespace',
  'context.migration.setActive.failed':
    'Failed persisting the default active context id after context migration',
  'context.registry.refresh.failed': 'Failed to refresh the in-memory context registry from storage',
  'context.rename.userFlow.failed': 'Rename-context dialog flow failed in the UI',
  'context.switch.failed':
    'User switched contexts, but rehydrating the destination context failed in the store',
  'context.switch.invalidTarget': 'Context switch requested an id that does not exist in the registry',
  'context.switch.persistActive.failed':
    'Context switch succeeded in memory but failed to persist the active context id',
  'context.switch.start':
    'User selected a context switch; store reset and destination hydration started',
  'context.switch.success':
    'User context switch completed; destination projects/settings loaded and UI can resume',
  'context.switch.userFlow.failed':
    'Header context-switch action failed before store transition could complete',
  'context.switch.userIntent': 'User selected a different context in the header switcher',
  'diagnostics.copy.failed': 'Failed to copy diagnostics JSON to clipboard',
  'diagnostics.download.failed': 'Failed to download diagnostics JSON file',
  'export.all.failed': 'Export-all user flow failed in the sidebar',
  'export.docx.failed': 'DOCX serialization failed while generating export output',
  'export.failed': 'User-triggered project export failed in the export pipeline',
  'export.single.userFlow.failed': 'Single-project export user flow failed in the editor',
  'export.start': 'User-triggered project export started (format build and file generation)',
  'export.success': 'User-triggered project export completed and file payload is ready/downloaded',
  'import.cancelled': 'User cancelled the import file picker',
  'import.failed': 'User-triggered import failed while parsing, deduplicating, or persisting data',
  'import.format.detected': 'Detected import format from extension or file signature',
  'import.start': 'User-triggered import started (format detection, parse, and merge planning)',
  'import.success': 'User-triggered import completed and projects/versions were persisted',
  'import.userFlow.failed': 'Import user flow failed in the sidebar',
  'media.backend.reselect.failed': 'Failed while reselecting media backend after configuration change',
  'media.backend.reselect.success':
    'Media backend reselected successfully after configuration change',
  'media.backend.select.failed':
    'During startup/context hydrate, media backend auto-selection failed and required fallback',
  'media.backend.select.installed':
    'Media backend auto-selection chose this adapter and installed it for runtime use',
  'media.backend.select.s3.inputs': 'Evaluated S3 config and unlock state before selecting backend',
  'media.backend.select.s3.opfs.cache.failed':
    'S3 backend initialization succeeded but OPFS cache-layer setup failed',
  'media.backend.select.s3.skipped.locked':
    'Skipped S3 backend because persisted credentials were still locked',
  'media.backend.select.start':
    'Started media backend auto-selection across S3, user-folder, OPFS, and IDB tiers',
  'media.backend.select.success':
    'Media backend selection succeeded during context hydration and adapter is active',
  'media.backend.select.userfolder.permission':
    'Checked existing permission state for previously selected user folder backend',
  'media.backend.supportsRemoteSync':
    'Checked whether current media backend supports explicit cache-to-remote backfill',
  'media.backend.tier.opfs.failed': 'OPFS media tier failed during backend selection',
  'media.backend.tier.s3.failed': 'S3 media tier failed during backend selection',
  'media.backend.tier.userfolder.failed': 'User-folder media tier failed during backend selection',
  'media.backfill.hash.failed': 'Backfill failed for one media hash while syncing cache to remote',
  'media.backfill.program.failed': 'Program-level media backfill action failed in settings',
  'media.backfill.project.failed': 'Project-level media backfill action failed in settings',
  'media.backfill.start': 'Started cache-to-remote media backfill',
  'media.backfill.success': 'Finished cache-to-remote media backfill',
  'media.cache.adapter.created': 'Created cached media adapter with local cache and remote backend',
  'media.cache.delete.cacheOnly':
    'Skipped remote delete and removed media hash from local cache only',
  'media.cache.delete.failed': 'Failed deleting media hash through cached adapter',
  'media.cache.forceDeleteFromRemote':
    'Force-deleting media hash from remote backend regardless of local GC policy',
  'media.cache.get.cacheHit': 'Resolved media blob from local cache tier',
  'media.cache.get.cacheMiss': 'Media blob was not found in local cache tier',
  'media.cache.get.promoted': 'Fetched media blob from remote and promoted it into local cache',
  'media.cache.has.cacheHit': 'Media existence check hit local cache tier',
  'media.cache.has.remoteCheck':
    'Media existence check fell through to remote backend after cache miss',
  'media.cache.put.failed': 'Failed writing media blob through cached adapter',
  'media.dataUriMigration.failed':
    'Failed migrating inline data URI media references to content-addressed refs',
  'media.gc.completed':
    'Background media GC sweep completed after scanning live references and candidates',
  'media.gc.delete.failed': 'Failed deleting one unreachable media hash during GC sweep',
  'media.gc.failed':
    'Store-triggered media GC failed while collecting live hashes or deleting stale blobs',
  'media.gc.get.failed': 'Failed loading media metadata/blob while evaluating GC candidate',
  'media.gc.start':
    'Background media GC sweep started (live-set collection and stale-hash pruning)',
  'media.gc.success':
    'Store-triggered media GC finished and usage counters can be refreshed',
  'media.idb.delete': 'Deleted media hash from IndexedDB media store',
  'media.idb.delete.failed': 'Failed deleting media hash from IndexedDB media store',
  'media.idb.put.failed': 'Failed writing media blob into IndexedDB media store',
  'media.idb.put.success': 'Stored media blob into IndexedDB media store',
  'media.ingest.deduped':
    'Skipped writing media because identical bytes already existed by hash',
  'media.ingest.failed': 'Failed ingesting media bytes into adapter storage',
  'media.ingest.stored': 'Ingested and stored a new media blob by content hash',
  'media.inventory.read.failed': 'Failed reading media metadata while building project inventory',
  'media.inventory.tierList.failed':
    'Failed listing cache/remote tier hashes while building project media inventory',
  'media.inventory.tiers':
    'Collected cache and remote tier visibility sets for project media inventory',
  'media.layered.adapter.created':
    'Created layered media adapter with primary and fallback promotion layers',
  'media.layered.promote.failed':
    'Failed promoting media blob from fallback layer into primary layer',
  'media.layered.promoted': 'Promoted media blob from fallback layer into primary layer',
  'media.migration.completed':
    'Completed one-time long-note data URI migration and rewrote references',
  'media.migration.failed': 'One-time long-note data URI migration failed',
  'media.migration.noop': 'No inline data URI media found, migration made no changes',
  'media.opfs.delete': 'Deleted media blob and metadata sidecar from OPFS',
  'media.opfs.meta.corrupt': 'Detected corrupt OPFS metadata sidecar and ignored it',
  'media.opfs.put.failed': 'Failed writing media blob and metadata sidecar into OPFS',
  'media.opfs.put.success': 'Stored media blob and metadata sidecar into OPFS',
  'media.orphanScan.fallback':
    'Failed scanning orphaned media with full context-aware path; using safe fallback set',
  'media.purgeRemote.failed': 'Failed force-purging selected media hashes from remote backend',
  'media.resolver.adapter.get.failed':
    'Media resolver failed reading blob from adapter for a referenced hash',
  'media.resolver.createObjectUrl.failed':
    'Media resolver failed creating browser object URL for a retrieved blob',
  'media.resolver.disposed': 'Media resolver disposed and revoked cached object URLs',
  'media.resolver.unresolved': 'Media resolver could not resolve referenced hash to a blob',
  'media.s3.adapter.created': 'Created S3 media adapter with endpoint and bucket configuration',
  'media.s3.config.cleared': 'Cleared persisted/session S3 credentials and unlock state',
  'media.s3.config.saved': 'Saved S3 configuration in session or encrypted persisted mode',
  'media.s3.config.unlock.failed': 'Failed to unlock encrypted persisted S3 credentials',
  'media.s3.config.unlock.skipped':
    'Unlock request skipped because persisted credentials were already unlocked',
  'media.s3.config.unlocked': 'Unlocked encrypted persisted S3 credentials for this session',
  'media.s3.delete.failed':
    'Remote media purge requested, but S3 DELETE returned a non-success response',
  'media.s3.delete.network.failed':
    'Remote media purge requested, but S3 DELETE failed at transport/network layer',
  'media.s3.delete.skipped.sharedBucket':
    'Skipped S3 delete because shared-bucket safety mode disables automatic remote deletes',
  'media.s3.delete.success': 'Remote media purge succeeded; hash was deleted from S3',
  'media.s3.forceDelete': 'Force-deleting media hash from S3 despite shared-bucket safeguards',
  'media.s3.get.failed':
    'Media fetch missed local cache and S3 GET returned a non-success response',
  'media.s3.get.miss': 'S3 get returned not found for media hash',
  'media.s3.get.network.failed':
    'Media fetch missed local cache and S3 GET failed at transport/network layer',
  'media.s3.get.success':
    'Media fetch missed local cache, succeeded from S3, and can be promoted locally',
  'media.s3.has.failed':
    'S3 existence check (HEAD) returned unexpected status while validating media hash',
  'media.s3.has.hit': 'S3 existence check confirmed media hash exists remotely',
  'media.s3.has.miss': 'S3 existence check confirmed media hash is absent remotely',
  'media.s3.has.network.failed':
    'S3 existence check (HEAD) failed at transport/network layer',
  'media.s3.list.failed':
    'S3 inventory/list operation returned a non-success response from ListObjectsV2',
  'media.s3.list.network.failed':
    'S3 inventory/list operation failed at transport/network layer',
  'media.s3.list.page': 'Fetched one paginated page from S3 object listing',
  'media.s3.list.success':
    'S3 inventory/list operation completed across all paginated response pages',
  'media.s3.mismatch.unlockedButNotActive':
    'S3 credentials are unlocked but active backend is not S3, indicating backend mismatch',
  'media.s3.put.failed':
    'Media upload/write-through to S3 returned a non-success response',
  'media.s3.put.network.failed':
    'Media upload/write-through to S3 failed at transport/network layer',
  'media.s3.put.success':
    'Media upload/write-through succeeded; hash was stored in S3',
  'media.sync.listHashes.failed':
    'Failed listing adapter hashes while computing unsynced media references',
  'media.sync.unsynced.failed': 'Failed computing unsynced media hashes for this device',
  'media.sync.unsyncedForProject': 'Computed unsynced media hashes referenced by one project',
  'media.sync.unsyncedForProject.skipped':
    'Skipped unsynced-media scan because backend does not expose remote sync capabilities',
  'media.upload.audio.failed': 'Audio upload from long-note toolbar failed',
  'media.upload.image.failed': 'Image upload from long-note toolbar failed',
  'media.usage.refresh.failed':
    'Failed recalculating media usage counters shown in settings and project summaries',
  'media.userfolder.api.unavailable':
    'User-folder backend is unavailable because Directory Picker API is not supported',
  'media.userfolder.clear.handleStore.failed':
    'Disconnected user-folder backend but failed clearing persisted directory handle',
  'media.userfolder.cleared': 'Cleared selected user-folder backend and related persisted handle',
  'media.userfolder.permission.nonInteractive':
    'Checked user-folder permission state without prompting the browser permission dialog',
  'media.userfolder.permission.requested':
    'Requested user-folder permission through browser permission prompt',
  'media.userfolder.pick.cancelled': 'User cancelled folder selection dialog for media backend',
  'media.userfolder.pick.failed': 'Folder selection failed for user-folder media backend',
  'media.userfolder.picked': 'User picked a folder for user-folder media backend',
  'persist.save.failed':
    'Autosave/persistence failed while writing projects/settings snapshot to storage adapter',
  'project.delete.failed':
    'User-triggered project deletion failed in sidebar flow or store deletion path',
  'project.delete.orphanScan.failed':
    'Project deletion failed while calculating orphaned remote media purge candidates',
  'project.delete.remotePurge.failed':
    'Project deletion failed while force-purging selected remote media hashes',
  'project.delete.success':
    'User-triggered project deletion completed and active project selection was updated',
  'settings.media.syncStatus.failed':
    'Settings screen failed computing media sync-status banners for current backend',
  'settings.project.mediaUsage.skipped':
    'Skipped project media usage refresh because no project is currently selected',
  'settings.s3.config.read.failed':
    'Settings screen failed reading saved S3 config while initializing form state',
  'settings.s3.connect.failed':
    'User clicked Connect in settings, but S3 config save/select flow failed',
  'settings.s3.disconnect.failed':
    'User clicked Disconnect in settings, but S3 teardown/reselect flow failed',
  'settings.s3.refreshState':
    'Settings screen refreshed derived S3 UI state (connected/locked/backend match)',
  'settings.userFolder.choose.cancelled': 'User cancelled choosing media folder in settings',
  'settings.userFolder.choose.failed': 'Choosing media folder failed from settings dialog',
  'settings.userFolder.disconnect.failed': 'Disconnecting media folder failed from settings dialog',
  'settings.userFolder.inspect.failed':
    'Failed inspecting active user-folder backend details for settings display',
  'store.loadFromStorage.success':
    'Loaded projects, active project id, and persisted preferences from storage',
  'version.restore.failed': 'Restoring saved version into a new project failed',
  'version.saveBeforeDelete.failed':
    'Failed saving a safety version snapshot before deleting an outline item',
})

const EVENT_OPERATOR_HINTS = Object.freeze({
  'app.init.failed': 'startup-failed',
  'context.switch.failed': 'context-switch-failed',
  'context.switch.invalidTarget': 'invalid-context-id',
  'context.switch.userFlow.failed': 'ui-action-failed',
  'diagnostics.copy.failed': 'clipboard-write-failed',
  'diagnostics.download.failed': 'file-download-failed',
  'export.failed': 'export-pipeline-failed',
  'export.all.failed': 'ui-action-failed',
  'export.single.userFlow.failed': 'ui-action-failed',
  'import.cancelled': 'user-cancelled',
  'import.failed': 'import-pipeline-failed',
  'import.userFlow.failed': 'ui-action-failed',
  'media.backend.select.failed': 'backend-selection-failed',
  'media.backend.reselect.failed': 'backend-selection-failed',
  'media.backend.tier.s3.failed': 's3-tier-init-failed',
  'media.backend.tier.opfs.failed': 'opfs-tier-init-failed',
  'media.backend.tier.userfolder.failed': 'user-folder-tier-init-failed',
  'media.gc.failed': 'garbage-collection-failed',
  'media.gc.delete.failed': 'media-delete-failed',
  'media.gc.get.failed': 'media-read-failed',
  'media.s3.has.network.failed': 'network-request-failed',
  'media.s3.get.network.failed': 'network-request-failed',
  'media.s3.put.network.failed': 'network-request-failed',
  'media.s3.delete.network.failed': 'network-request-failed',
  'media.s3.list.network.failed': 'network-request-failed',
  'media.s3.has.failed': 'remote-response-failed',
  'media.s3.get.failed': 'remote-response-failed',
  'media.s3.put.failed': 'remote-response-failed',
  'media.s3.delete.failed': 'remote-response-failed',
  'media.s3.list.failed': 'remote-response-failed',
  'media.s3.delete.skipped.sharedBucket': 'shared-bucket-protection',
  'media.sync.listHashes.failed': 'media-list-failed',
  'media.sync.unsynced.failed': 'sync-scan-failed',
  'media.backfill.hash.failed': 'sync-backfill-item-failed',
  'media.backfill.project.failed': 'ui-action-failed',
  'media.backfill.program.failed': 'ui-action-failed',
  'media.upload.image.failed': 'upload-failed',
  'media.upload.audio.failed': 'upload-failed',
  'persist.save.failed': 'storage-write-failed',
  'project.delete.failed': 'project-delete-failed',
  'project.delete.orphanScan.failed': 'orphan-scan-failed',
  'project.delete.remotePurge.failed': 'remote-purge-failed',
  'settings.s3.connect.failed': 'settings-action-failed',
  'settings.s3.disconnect.failed': 'settings-action-failed',
  'settings.userFolder.choose.cancelled': 'user-cancelled',
  'settings.userFolder.choose.failed': 'settings-action-failed',
  'settings.userFolder.disconnect.failed': 'settings-action-failed',
  'version.restore.failed': 'version-restore-failed',
  'version.saveBeforeDelete.failed': 'version-save-failed',
})

/** Keys that should never make it into a log payload (case-insensitive substring match). */
const SENSITIVE_KEY_PATTERN =
  /(secret|password|passphrase|authorization|auth-token|access[-_]?key|signature|cookie|bearer)/i

/** Default cap for string fields; long values are truncated with a sentinel. */
const DEFAULT_STRING_LIMIT = 2000

/** Default ring buffer size for the in-memory diagnostics buffer. */
const DEFAULT_RING_SIZE = 200

/** localStorage key support staff can set in the browser console: `localStorage.setItem('scaffold-log-level', 'debug')`. */
export const LOG_LEVEL_OVERRIDE_KEY = 'scaffold-log-level'

const ringBuffer = []
let ringSize = DEFAULT_RING_SIZE
let currentLevel = resolveDefaultLevel()
let stackInProd = false
let sink = defaultSink

function resolveDefaultLevel() {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem(LOG_LEVEL_OVERRIDE_KEY)
      if (override && LEVEL_ORDER[String(override).toLowerCase()] !== undefined) {
        return String(override).toLowerCase()
      }
    }
  } catch {
    // localStorage unavailable (private mode, server context); fall through.
  }
  try {
    const fromEnv =
      (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) ||
      (typeof import.meta !== 'undefined' &&
        import.meta &&
        import.meta.env &&
        import.meta.env.VITE_LOG_LEVEL)
    if (fromEnv && LEVEL_ORDER[String(fromEnv).toLowerCase()] !== undefined) {
      return String(fromEnv).toLowerCase()
    }
    const isDev =
      (typeof process !== 'undefined' &&
        process.env &&
        (process.env.NODE_ENV === 'development' || process.env.DEV)) ||
      (typeof import.meta !== 'undefined' &&
        import.meta &&
        import.meta.env &&
        (import.meta.env.DEV || import.meta.env.MODE === 'development'))
    return isDev ? LEVELS.DEBUG : LEVELS.INFO
  } catch {
    return LEVELS.INFO
  }
}

function defaultSink(record) {
  if (typeof console === 'undefined') return
  const args = [`[${record.level}] ${record.event}`, record]
  if (record.level === LEVELS.ERROR) {
    console.error(...args)
  } else if (record.level === LEVELS.INFO) {
    console.info(...args)
  } else {
    if (typeof console.debug === 'function') {
      console.debug(...args)
    } else {
      console.log(...args)
    }
  }
}

/** @param {keyof typeof LEVELS | string} level */
export function setLevel(level) {
  if (!level) return
  const normalized = String(level).toLowerCase()
  if (LEVEL_ORDER[normalized] !== undefined) {
    currentLevel = normalized
  }
}

export function getLevel() {
  return currentLevel
}

/** Enable error stack capture when running with `info` (defaults to false). */
export function setIncludeStackInProd(flag) {
  stackInProd = Boolean(flag)
}

/** Override the underlying log sink (tests). Call with no args to restore. */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : defaultSink
}

export function setRingBufferSize(n) {
  if (typeof n === 'number' && n > 0) {
    ringSize = Math.floor(n)
    while (ringBuffer.length > ringSize) ringBuffer.shift()
  }
}

export function getRecentLogs() {
  return ringBuffer.slice()
}

export function clearLogs() {
  ringBuffer.length = 0
}

function shouldEmit(level) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]
}

function isSensitiveKey(key) {
  return typeof key === 'string' && SENSITIVE_KEY_PATTERN.test(key)
}

function truncateString(value, limit = DEFAULT_STRING_LIMIT) {
  if (typeof value !== 'string') return value
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…[truncated ${value.length - limit} chars]`
}

function sentenceCase(value) {
  if (!value) return ''
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function humanizeEventToken(token) {
  if (!token) return ''
  const withSpaces = String(token).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  const parts = withSpaces
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts
    .map((part) => {
      const key = part.toLowerCase()
      return EVENT_TOKEN_LABELS[key] || key
    })
    .join(' ')
}

function describeEvent(event) {
  if (typeof event !== 'string' || event.length === 0) {
    return 'Application log event'
  }
  const tokens = event.split(/[._-]+/).filter(Boolean)
  if (tokens.length === 0) return 'Application log event'
  const lastToken = tokens[tokens.length - 1].toLowerCase()
  const statusSuffix = EVENT_STATUS_SUFFIX[lastToken] || ''
  const subjectTokens = statusSuffix ? tokens.slice(0, -1) : tokens
  const subject = subjectTokens.map((token) => humanizeEventToken(token)).join(' ').trim()
  if (!subject) return sentenceCase(statusSuffix || 'Application log event')
  if (!statusSuffix) return sentenceCase(subject)
  return sentenceCase(`${subject} ${statusSuffix}`)
}

function resolveDescription(event, payload) {
  if (payload && typeof payload === 'object') {
    const explicit = payload.description
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit.trim()
    }
  }
  if (typeof event === 'string' && EVENT_DESCRIPTIONS[event]) {
    return EVENT_DESCRIPTIONS[event]
  }
  return describeEvent(event)
}

function fallbackOperatorHint(event, payload) {
  const normalizedEvent = typeof event === 'string' ? event : ''
  if (/\.cancelled$/i.test(normalizedEvent)) return 'user-cancelled'
  if (/network\.failed$/i.test(normalizedEvent)) return 'network-request-failed'
  if (/\.failed$/i.test(normalizedEvent)) return 'operation-failed'
  if (/\.success$/i.test(normalizedEvent)) return 'operation-succeeded'
  if (/\.start$/i.test(normalizedEvent)) return 'operation-started'
  if (/\.skipped\./i.test(normalizedEvent) || /\.skipped$/i.test(normalizedEvent))
    return 'operation-skipped'
  if (/\.miss$/i.test(normalizedEvent)) return 'cache-miss'
  if (/\.hit$/i.test(normalizedEvent)) return 'cache-hit'
  if (payload && payload.isAbort) return 'request-aborted'
  return 'operation-observed'
}

function resolveOperatorHint(event, payload) {
  if (payload && typeof payload === 'object') {
    const explicit = payload.operatorHint
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit.trim()
    }
  }
  if (typeof event === 'string' && EVENT_OPERATOR_HINTS[event]) {
    return EVENT_OPERATOR_HINTS[event]
  }
  return fallbackOperatorHint(event, payload)
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return truncateString(value)
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value
  if (t === 'function' || t === 'symbol') return `[${t}]`
  if (value instanceof Error) return normalizeError(value)
  if (depth > 4) return '[truncated:depth]'
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const cap = 50
    const out = value
      .slice(0, cap)
      .map((v) => sanitizeValue(v, depth + 1, seen))
    if (value.length > cap) out.push(`[+${value.length - cap} more]`)
    return out
  }
  if (t === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = '[redacted]'
      } else {
        out[k] = sanitizeValue(v, depth + 1, seen)
      }
    }
    return out
  }
  return String(value)
}

/**
 * Normalize any thrown value into a plain payload-safe object.
 * @param {unknown} err
 */
export function normalizeError(err) {
  if (!err) return null
  if (err instanceof Error) {
    const out = {
      errorName: err.name || 'Error',
      errorMessage: err.message || String(err),
    }
    if (currentLevel === LEVELS.DEBUG || stackInProd) {
      out.errorStack = truncateString(err.stack || '', 4000)
    }
    if (err.name === 'AbortError') out.isAbort = true
    if (typeof err.code !== 'undefined') out.errorCode = err.code
    return out
  }
  if (typeof err === 'object') {
    return sanitizeValue(err)
  }
  return { errorMessage: String(err) }
}

function emit(level, event, payload) {
  if (!shouldEmit(level)) return
  const record = {
    level,
    event: typeof event === 'string' && event.length > 0 ? event : 'unknown',
    description: resolveDescription(event, payload),
    operatorHint: resolveOperatorHint(event, payload),
    ts: new Date().toISOString(),
  }
  if (payload && typeof payload === 'object') {
    const sanitized = sanitizeValue(payload)
    if (sanitized && typeof sanitized === 'object') {
      Object.assign(record, sanitized)
    } else {
      record.payload = sanitized
    }
  } else if (payload !== undefined) {
    record.payload = sanitizeValue(payload)
  }
  if (!record.description || typeof record.description !== 'string') {
    record.description = resolveDescription(record.event, record)
  }
  if (!record.operatorHint || typeof record.operatorHint !== 'string') {
    record.operatorHint = resolveOperatorHint(record.event, record)
  }
  ringBuffer.push(record)
  while (ringBuffer.length > ringSize) ringBuffer.shift()
  try {
    sink(record)
  } catch {
    // Never throw from logging.
  }
}

export const logger = {
  debug(event, payload) {
    emit(LEVELS.DEBUG, event, payload)
  },
  info(event, payload) {
    emit(LEVELS.INFO, event, payload)
  },
  /**
   * Emit at error level. The second argument may be an `Error` (or any
   * thrown value) which is normalized into the payload, or a plain
   * payload object. When both an error and a payload are provided, the
   * payload's fields are merged on top of the normalized error data.
   *
   * @param {string} event
   * @param {unknown} errorOrPayload
   * @param {object} [extra]
   */
  error(event, errorOrPayload, extra) {
    let payload = {}
    if (errorOrPayload instanceof Error) {
      payload = normalizeError(errorOrPayload) || {}
    } else if (errorOrPayload && typeof errorOrPayload === 'object') {
      payload = errorOrPayload
    } else if (errorOrPayload !== undefined) {
      payload = { detail: errorOrPayload }
    }
    if (extra && typeof extra === 'object') {
      payload = { ...payload, ...extra }
    }
    emit(LEVELS.ERROR, event, payload)
  },
}

export default logger
