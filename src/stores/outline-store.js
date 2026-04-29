import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { exportAsMarkdown } from 'src/utils/export/markdown.js'
import { exportAsDocx } from 'src/utils/export/docx.js'
import { 
  exportAsJSON,
  exportSingleProjectAsJSON, 
  exportAllProjectsAsJSON,
  importFromJSON,
  getFilenameTimestamp,
} from 'src/utils/export/json.js'
import {
  buildScaffoldzBundle,
  downloadScaffoldzBundle,
  importScaffoldzBundle,
  isZipMagic,
} from 'src/utils/export/scaffoldz.js'
import {
  getTabInstanceId,
  writeProjectLock,
  removeProjectLock,
  isProjectLockedByOtherTab,
  PROJECT_LOCK_HEARTBEAT_MS,
} from 'src/utils/project-tab-lock.js'
import {
  getStorageAdapter,
  setActiveContextId,
} from 'src/utils/storage/index.js'
import { getMediaAdapter, selectMediaAdapter } from 'src/utils/media/index.js'
import { runMediaMigration } from 'src/utils/media/migration.js'
import {
  collectLiveMediaHashesExcludingProject,
  runMediaGc,
} from 'src/utils/media/gc.js'
import {
  collectProjectRefHashes,
  extractRefHashesFromHtml,
} from 'src/utils/media/references.js'
import {
  createContext,
  deleteContext,
  loadContextRegistry,
  renameContext,
  resolveActiveContextId,
  setStoredActiveContextId,
} from 'src/utils/context/session.js'
import { runContextMigration } from 'src/utils/context/migration.js'
import { logger } from 'src/utils/logging/logger.js'
import {
  DEFAULT_LONG_NOTE_BG_OPACITY,
  DEFAULT_LONG_NOTE_COLOR_ROOT,
  MAX_RECENT_CUSTOM_COLORS,
  clampOpacity,
  normalizeHexColor,
  pushRecentCustomColor,
} from 'src/utils/color/long-note-palette.js'

/** Placeholder text for newly created list items (cleared when user starts editing). */
export const DEFAULT_NEW_LIST_ITEM_TEXT = 'New Item'

export const useOutlineStore = defineStore('outline', () => {
  const ITEM_KIND = {
    ITEM: 'item',
    DIVIDER: 'divider',
  }

  const projects = ref([])
  const currentProjectId = ref(null)
  const fontSize = ref(14)
  const fontScale = ref(100)
  const indentSize = ref(32)
  const defaultListType = ref('ordered')
  const showIndentGuides = ref(true)
  const showLongNotesInOutline = ref(true)
  const tibetanFontFamily = ref('Microsoft Himalaya')
  const tibetanFontSize = ref(20)
  const tibetanFontColor = ref('#000000')
  const nonTibetanFontFamily = ref('Aptos, sans-serif')
  const nonTibetanFontSize = ref(16)
  const nonTibetanFontColor = ref('#000000')
  const undoStack = ref([])
  const redoStack = ref([])
  const maxHistorySize = 50
  const currentlyEditingId = ref(null)
  const longNoteEditorActive = ref(false)
  const storeReady = ref(false)
  const storageSaveError = ref(null)
  const storageUsageWarning = ref(null)
  const storageUsageRatio = ref(0)
  /** Set when selectProject is blocked because another tab holds the lock (for UI dialog). */
  const projectLockBlockedProjectId = ref(null)
  let projectLockHeartbeatTimer = null
  const STORAGE_USAGE_WARNING_THRESHOLD = 0.85
  const FALLBACK_LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024

  /** Aggregate media-store usage (count of blobs + total bytes) for Settings. */
  const mediaUsage = ref({ count: 0, bytes: 0 })
  const mediaBackend = ref('idb')
  // Last-known error from a remote-tier list call (S3 LIST). Set by any
  // function that calls `listRemoteHashes` / `getStats` / `listHashes`
  // when the active backend has a remote tier; cleared on the next
  // success. Exposed so the Settings dialog can render a banner the
  // moment any S3 LIST fails, regardless of which project is current
  // or whether the inventory view has been opened.
  const mediaRemoteListError = ref(null)
  function setMediaRemoteListError(error) {
    if (!error) {
      mediaRemoteListError.value = null
      return
    }
    mediaRemoteListError.value = String(error?.message || error)
  }
  let mediaGcTimer = null
  /** Idle GC frequency. Tests can stub setInterval to verify wiring. */
  const MEDIA_GC_INTERVAL_MS = 10 * 60 * 1000

  /**
   * Context state. Contexts are user-like profiles that fully isolate
   * the app's persisted state (projects, version snapshots, program-
   * wide settings, media-backend configuration). The active context
   * id resolves the storage namespace used by the storage adapter.
   */
  const contexts = ref([])
  const activeContextId = ref(null)
  /** True while a context switch is in flight (UI shows a spinner). */
  const switchingContext = ref(false)
  /**
   * Cleanup callbacks installed by `setupAutoVersioning`. We track
   * them so a context switch can tear down the previous context's
   * `beforeunload` handler / interval timer before installing the
   * new context's auto-versioning configuration.
   */
  let _autoVersioningCleanup = []

  const currentProject = computed(() => {
    return projects.value.find((p) => p.id === currentProjectId.value)
  })

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  function saveState(description = '') {
    if (!currentProject.value) return

    const state = {
      projectId: currentProjectId.value,
      lists: JSON.parse(JSON.stringify(currentProject.value.lists)),
      rootListType: currentProject.value.rootListType,
      description,
      timestamp: Date.now(),
    }

    undoStack.value.push(state)
    if (undoStack.value.length > maxHistorySize) {
      undoStack.value.shift()
    }
    redoStack.value = []
  }

  function undo() {
    if (!canUndo.value || !currentProject.value) return

    const currentState = {
      projectId: currentProjectId.value,
      lists: JSON.parse(JSON.stringify(currentProject.value.lists)),
      rootListType: currentProject.value.rootListType,
      timestamp: Date.now(),
    }

    const previousState = undoStack.value.pop()
    if (previousState.projectId === currentProjectId.value) {
      redoStack.value.push(currentState)
      currentProject.value.lists = previousState.lists
      currentProject.value.rootListType = previousState.rootListType
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    } else {
      undoStack.value.push(previousState)
    }
  }

  function redo() {
    if (!canRedo.value || !currentProject.value) return

    const currentState = {
      projectId: currentProjectId.value,
      lists: JSON.parse(JSON.stringify(currentProject.value.lists)),
      rootListType: currentProject.value.rootListType,
      timestamp: Date.now(),
    }

    const nextState = redoStack.value.pop()
    if (nextState.projectId === currentProjectId.value) {
      undoStack.value.push(currentState)
      currentProject.value.lists = nextState.lists
      currentProject.value.rootListType = nextState.rootListType
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    } else {
      redoStack.value.push(nextState)
    }
  }

  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
  }

  function stopProjectLockHeartbeat() {
    if (projectLockHeartbeatTimer !== null) {
      clearInterval(projectLockHeartbeatTimer)
      projectLockHeartbeatTimer = null
    }
  }

  /** Start / renew heartbeat for the current project (this tab holds the lock). */
  function syncProjectLockSession() {
    stopProjectLockHeartbeat()
    const id = currentProjectId.value
    if (!id) return
    writeProjectLock(id)
    projectLockHeartbeatTimer = setInterval(() => {
      if (currentProjectId.value) {
        writeProjectLock(currentProjectId.value)
      }
    }, PROJECT_LOCK_HEARTBEAT_MS)
  }

  function releaseCurrentProjectLockForUnload() {
    const id = currentProjectId.value
    if (id) {
      removeProjectLock(id)
    }
    stopProjectLockHeartbeat()
  }

  function applyProjectSettingsFromProject(project) {
    if (!project?.settings) return
    fontSize.value = project.settings.nonTibetanFontSize || project.settings.fontSize || 16
    indentSize.value = project.settings.indentSize
    defaultListType.value = project.settings.defaultListType
    showIndentGuides.value = project.settings.showIndentGuides
    showLongNotesInOutline.value = project.settings.showLongNotesInOutline !== false
    tibetanFontFamily.value = project.settings.tibetanFontFamily || 'Microsoft Himalaya'
    tibetanFontSize.value = project.settings.tibetanFontSize || 20
    tibetanFontColor.value = project.settings.tibetanFontColor || '#000000'
    nonTibetanFontFamily.value = project.settings.nonTibetanFontFamily || 'Aptos, sans-serif'
    nonTibetanFontSize.value = project.settings.nonTibetanFontSize || 16
    nonTibetanFontColor.value = project.settings.nonTibetanFontColor || '#000000'
  }

  async function createProject(name) {
    const raw = await getStorageAdapter().getMeta('program-settings')
    const programSettings = raw ? JSON.parse(raw) : {}
    
    const project = {
      id: generateId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lists: [],
      rootListType: programSettings.defaultListType || defaultListType.value,
      settings: {
        fontSize: programSettings.defaultNonTibetanFontSize || nonTibetanFontSize.value,
        indentSize: programSettings.defaultIndentSize || indentSize.value,
        defaultListType: programSettings.defaultListType || defaultListType.value,
        showIndentGuides: showIndentGuides.value,
        showLongNotesInOutline: showLongNotesInOutline.value,
        tibetanFontFamily: programSettings.defaultTibetanFontFamily || tibetanFontFamily.value,
        tibetanFontSize: programSettings.defaultTibetanFontSize || tibetanFontSize.value,
        tibetanFontColor: programSettings.defaultTibetanFontColor || tibetanFontColor.value,
        nonTibetanFontFamily:
          programSettings.defaultNonTibetanFontFamily || nonTibetanFontFamily.value,
        nonTibetanFontSize: programSettings.defaultNonTibetanFontSize || nonTibetanFontSize.value,
        nonTibetanFontColor:
          programSettings.defaultNonTibetanFontColor || nonTibetanFontColor.value,
        longNoteColorRoot:
          normalizeHexColor(programSettings.defaultLongNoteColorRoot) ||
          DEFAULT_LONG_NOTE_COLOR_ROOT,
        longNoteRecentCustomColors: [],
        longNoteBgOpacity: DEFAULT_LONG_NOTE_BG_OPACITY,
      },
    }
    projects.value.push(project)
    persistToStorage()
    return project
  }

  /**
   * Compute the set of media hashes referenced by `projectId` that
   * would become orphaned if the project were removed right now —
   * i.e. hashes referenced by the project but NOT in the residual
   * live set, where "residual" means:
   *   - every other project in EVERY context (cross-context safety:
   *     a hash referenced by another context must never be evicted
   *     from a shared S3 bucket), AND
   *   - every persisted version snapshot in every context, including
   *     the deleted project's own snapshots (those are retained
   *     separately and the user might restore from them).
   *
   * Used by the project-deletion prompt for shared-bucket S3 setups
   * to surface "this project uniquely references N media files"
   * before issuing remote DELETEs.
   *
   * @param {string} projectId
   * @returns {Promise<Set<string>>}
   */
  async function findOrphanedMediaForProjectRemoval(projectId) {
    const target = projects.value.find((p) => p.id === projectId)
    if (!target) return new Set()

    const projectHashes = collectProjectRefHashes([target])
    if (projectHashes.size === 0) return new Set()

    let residualLive
    try {
      residualLive = await collectLiveMediaHashesExcludingProject(projectId)
    } catch (error) {
      logger.error('media.orphanScan.fallback', error, {
        projectId,
        contextId: activeContextId.value,
        reason: 'cross-context-walk-failed',
      })
      residualLive = new Set(
        collectProjectRefHashes(
          projects.value.filter((p) => p.id !== projectId),
        ),
      )
    }

    const orphans = new Set()
    for (const hash of projectHashes) {
      if (!residualLive.has(hash)) orphans.add(hash)
    }
    return orphans
  }

  /**
   * Force-evict the supplied hashes from the active media backend's
   * remote tier. No-op for backends that don't expose
   * `forceDeleteFromRemote` (purely local IDB / OPFS / user-folder).
   * Errors per hash are logged but don't abort the sweep.
   *
   * @param {Iterable<string>} hashes
   */
  async function purgeRemoteMediaHashes(hashes) {
    const adapter = getMediaAdapter()
    if (!adapter || typeof adapter.forceDeleteFromRemote !== 'function') return
    for (const hash of hashes) {
      try {
        await adapter.forceDeleteFromRemote(hash)
      } catch (error) {
        logger.error('media.purgeRemote.failed', error, {
          hashPrefix: String(hash).slice(0, 12),
          backend: mediaBackend.value,
        })
      }
    }
  }

  /**
   * True when the active backend exposes a remote tier we could push
   * to — i.e. the read-through cached adapter wrapping S3. Anything
   * else (IDB / OPFS / user-folder) lacks `backfillRemoteFromCache`
   * and the related helpers below all return empty / no-op results.
   */
  function mediaBackendSupportsRemoteSync() {
    const adapter = getMediaAdapter()
    const supports = Boolean(
      adapter &&
        typeof adapter.listRemoteHashes === 'function' &&
        typeof adapter.listCachedHashes === 'function' &&
        typeof adapter.backfillRemoteFromCache === 'function',
    )
    logger.debug('media.backend.supportsRemoteSync', {
      mediaBackend: mediaBackend.value,
      supports,
    })
    return supports
  }

  /**
   * Hashes referenced by `projectId` that are present in the local
   * cache but NOT yet on the remote tier — i.e. media that exists
   * here but other devices on the same bucket can't see yet. Returns
   * an empty Set on local-only backends.
   *
   * @param {string} projectId
   * @returns {Promise<Set<string>>}
   */
  async function getUnsyncedMediaForProject(projectId) {
    if (!mediaBackendSupportsRemoteSync()) {
      logger.debug('media.sync.unsyncedForProject.skipped', {
        projectId,
        reason: 'backend does not support remote sync',
        backend: mediaBackend.value,
      })
      return new Set()
    }
    const target = projects.value.find((p) => p.id === projectId)
    if (!target) return new Set()
    const refs = collectProjectRefHashes([target])
    if (refs.size === 0) return new Set()

    const adapter = getMediaAdapter()
    let remoteHashes
    let cacheHashes
      try {
        ;[remoteHashes, cacheHashes] = await Promise.all([
          adapter.listRemoteHashes(),
          adapter.listCachedHashes(),
        ])
        setMediaRemoteListError(null)
      } catch (error) {
        logger.error('media.sync.listHashes.failed', error, {
          backend: mediaBackend.value,
          projectId,
        })
        setMediaRemoteListError(error)
        return new Set()
      }
    const remoteSet = new Set(remoteHashes)
    const cacheSet = new Set(cacheHashes)

    const out = new Set()
    let refsInCache = 0
    let refsAlreadyOnRemote = 0
    let refsMissingFromCache = 0
    for (const hash of refs) {
      // We can only fix unsynced refs that we still hold locally.
      // Refs that aren't in cache either are already lost (will
      // render as "media unavailable" everywhere) or are in remote
      // already (so not a sync problem).
      if (!cacheSet.has(hash)) {
        refsMissingFromCache += 1
        continue
      }
      refsInCache += 1
      if (remoteSet.has(hash)) {
        refsAlreadyOnRemote += 1
        continue
      }
      out.add(hash)
    }
    logger.info('media.sync.unsyncedForProject', {
      projectId,
      backend: mediaBackend.value,
      refsTotal: refs.size,
      refsInCache,
      refsAlreadyOnRemote,
      refsMissingFromCache,
      unsyncedCount: out.size,
      cacheTotal: cacheSet.size,
      remoteTotal: remoteSet.size,
    })
    return out
  }

  /**
   * Hashes anywhere in the local cache that aren't on the remote.
   * Used by the program-wide "Push to S3" control. Returns an empty
   * Set on local-only backends.
   *
   * @returns {Promise<Set<string>>}
   */
  async function getAllUnsyncedMedia() {
    if (!mediaBackendSupportsRemoteSync()) return new Set()
    const adapter = getMediaAdapter()
    try {
      const [cacheHashes, remoteHashes] = await Promise.all([
        adapter.listCachedHashes(),
        adapter.listRemoteHashes(),
      ])
      setMediaRemoteListError(null)
      const remoteSet = new Set(remoteHashes)
      const out = new Set()
      for (const hash of cacheHashes) {
        if (!remoteSet.has(hash)) out.add(hash)
      }
      return out
    } catch (error) {
      logger.error('media.sync.unsynced.failed', error, {
        backend: mediaBackend.value,
        scope: 'all',
      })
      setMediaRemoteListError(error)
      return new Set()
    }
  }

  /**
   * @typedef {Object} ProjectMediaInventoryEntry
   * @property {string} hash
   * @property {'image' | 'audio' | 'unknown'} kind - inferred from
   *   the surrounding `<img>` / `<audio>` element in the long-note
   *   HTML; falls back to 'unknown' when only a bare reference is
   *   present.
   * @property {string | null} mime
   * @property {number} size - bytes (0 when only available on remote
   *   and we can't stat it cheaply, or when not stored anywhere).
   * @property {boolean} inCache
   * @property {boolean | null | 'unknown'} inRemote - tri-state:
   *   - `null` when the active backend has no remote tier (purely
   *     local IDB / OPFS / folder)
   *   - `true` / `false` when the remote tier responded and we know
   *     for sure whether the hash is on it
   *   - `'unknown'` when the active backend HAS a remote tier but
   *     `listRemoteHashes()` failed (e.g. CORS misconfiguration,
   *     offline, expired credentials). The Settings dialog uses this
   *     to render an "S3 unreachable" banner instead of the
   *     misleading "Stored locally" badge.
   */

  /**
   * Walk every long-note in `projectId`, classify each unique
   * `scaffold-media://<hash>` reference as image / audio / unknown,
   * and look up its size, mime, and tier presence. Used by the
   * Settings dialog's "Media files" inventory view. Reads the local
   * cache directly to avoid triggering S3 GETs on remote-only
   * blobs.
   *
   * @param {string} projectId
   * @returns {Promise<ProjectMediaInventoryEntry[]>}
   */
  async function getProjectMediaInventory(projectId) {
    const project = projects.value.find((p) => p.id === projectId)
    if (!project) return []
    if (typeof DOMParser === 'undefined') return []

    const kindByHash = new Map()
    const visit = (items) => {
      if (!Array.isArray(items)) return
      for (const item of items) {
        if (Array.isArray(item.longNotes)) {
          for (const note of item.longNotes) {
            if (typeof note?.text !== 'string') continue
            // Seed the map with every reference first so we don't
            // miss bare refs (no surrounding img/audio element).
            for (const hash of extractRefHashesFromHtml(note.text)) {
              if (!kindByHash.has(hash)) kindByHash.set(hash, 'unknown')
            }
            const doc = new DOMParser().parseFromString(note.text, 'text/html')
            const setKind = (selector, kind) => {
              for (const el of doc.querySelectorAll(selector)) {
                const src = el.getAttribute('src') || ''
                const hash = src.startsWith('scaffold-media://')
                  ? src.slice('scaffold-media://'.length)
                  : ''
                if (hash) kindByHash.set(hash, kind)
              }
            }
            setKind('img[src^="scaffold-media://"]', 'image')
            setKind('audio[src^="scaffold-media://"]', 'audio')
          }
        }
        if (Array.isArray(item.children) && item.children.length > 0) {
          visit(item.children)
        }
      }
    }
    visit(project.lists || [])

    if (kindByHash.size === 0) return []

    const adapter = getMediaAdapter()
    const isLayered = mediaBackendSupportsRemoteSync()

    let cacheHashes = null
    let remoteHashes = null
    let listError = null
    if (isLayered) {
      try {
        const [c, r] = await Promise.all([
          adapter.listCachedHashes(),
          adapter.listRemoteHashes(),
        ])
        cacheHashes = new Set(c)
        remoteHashes = new Set(r)
        setMediaRemoteListError(null)
      } catch (error) {
        logger.error('media.inventory.tierList.failed', error, {
          backend: mediaBackend.value,
          projectId,
        })
        listError = String(error?.message || error)
        setMediaRemoteListError(error)
      }
    }
    logger.debug('media.inventory.tiers', {
      projectId,
      refsCount: kindByHash.size,
      isLayered,
      cacheCount: cacheHashes?.size ?? null,
      remoteCount: remoteHashes?.size ?? null,
      listError,
    })

    const inventory = []
    for (const [hash, kind] of kindByHash) {
      let mime = null
      let size = 0
      let inCache = false
      try {
        // Prefer the cache-only read on layered adapters so this view
        // doesn't accidentally pull every remote blob into local
        // storage just to fill the table.
        const row =
          isLayered && typeof adapter.getCached === 'function'
            ? await adapter.getCached(hash)
            : await adapter.get(hash)
        if (row?.blob) {
          mime = row.mime || null
          size = row.size || row.blob.size || 0
          inCache = true
        }
      } catch (error) {
        logger.error('media.inventory.read.failed', error, {
          hashPrefix: String(hash).slice(0, 12),
          backend: mediaBackend.value,
        })
      }
      // Override `inCache` from the authoritative listing when we
      // have one — handles the (rare) case where get() failed
      // transiently but the blob is in fact present.
      if (cacheHashes !== null) inCache = cacheHashes.has(hash)
      let inRemote
      if (remoteHashes !== null) {
        inRemote = remoteHashes.has(hash)
      } else if (isLayered) {
        // Backend has a remote tier but the LIST call failed (CORS,
        // offline, expired creds). Surface this distinctly so the UI
        // can show "S3 unreachable" instead of the local-only label.
        inRemote = 'unknown'
      } else {
        inRemote = null
      }
      inventory.push({ hash, kind, mime, size, inCache, inRemote })
    }
    return inventory
  }

  /**
   * Push cache-only blobs to the remote. Pass an explicit list of
   * `hashes` to bound the operation (e.g. only this project), or
   * leave undefined to push every cache-only hash.
   *
   * @param {Iterable<string>} [hashes]
   * @param {{ onProgress?: Function }} [options]
   * @returns {Promise<{ supported: boolean, checked: number, uploaded: number, skipped: number, failed: number }>}
   */
  async function backfillMediaToRemote(hashes, options = {}) {
    if (!mediaBackendSupportsRemoteSync()) {
      return { supported: false, checked: 0, uploaded: 0, skipped: 0, failed: 0 }
    }
    const adapter = getMediaAdapter()
    const stats = await adapter.backfillRemoteFromCache({
      hashes: hashes ? Array.from(hashes) : undefined,
      onProgress: options.onProgress,
    })
    return { supported: true, ...stats }
  }

  /**
   * Delete a project locally. When `options.purgeRemoteMedia` is true,
   * any media hashes referenced uniquely by this project (i.e. not
   * held by another project or version snapshot) are force-evicted
   * from the remote BEFORE the project is removed locally — otherwise
   * the orphan computation would miss them.
   *
   * Async to accommodate the remote purge round-trips.
   *
   * @param {string} projectId
   * @param {{ purgeRemoteMedia?: boolean }} [options]
   */
  async function deleteProject(projectId, options = {}) {
    const index = projects.value.findIndex((p) => p.id === projectId)
    if (index === -1) return

    if (options.purgeRemoteMedia) {
      try {
        const orphans = await findOrphanedMediaForProjectRemoval(projectId)
        if (orphans.size > 0) {
          await purgeRemoteMediaHashes(orphans)
        }
      } catch (error) {
        logger.error('project.delete.remotePurge.failed', error, {
          projectId,
          backend: mediaBackend.value,
        })
      }
    }

    removeProjectLock(projectId)
    projects.value.splice(index, 1)
    if (currentProjectId.value === projectId) {
      currentProjectId.value = projects.value[0]?.id || null
    }
    syncProjectLockSession()
    persistToStorage()
    void triggerMediaGc('project-delete')
    logger.info('project.delete.success', {
      projectId,
      contextId: activeContextId.value,
      purgeRemoteMedia: Boolean(options.purgeRemoteMedia),
      remainingProjects: projects.value.length,
    })
  }

  function renameProject(projectId, newName) {
    const project = projects.value.find((p) => p.id === projectId)
    if (project) {
      project.name = newName
      project.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  /**
   * Switch active project. Returns false if another tab holds a fresh lock on this project.
   */
  function selectProject(projectId) {
    if (projectId === currentProjectId.value) {
      projectLockBlockedProjectId.value = null
      writeProjectLock(projectId)
      syncProjectLockSession()
      return true
    }

    if (isProjectLockedByOtherTab(projectId)) {
      projectLockBlockedProjectId.value = projectId
      return false
    }

    projectLockBlockedProjectId.value = null

    const prevId = currentProjectId.value
    if (prevId && prevId !== projectId) {
      removeProjectLock(prevId)
    }

    currentProjectId.value = projectId
    clearHistory()

    const project = projects.value.find((p) => p.id === projectId)
    applyProjectSettingsFromProject(project)

    persistToStorage()
    syncProjectLockSession()
    return true
  }

  function clearProjectLockBlocked() {
    projectLockBlockedProjectId.value = null
  }

  /** For sidebar: project row disabled when another tab holds a fresh lock (not this tab’s current). */
  function isProjectLockHeldByOtherTab(projectId) {
    return isProjectLockedByOtherTab(projectId)
  }

  function createListItem(text = '', parentId = null) {
    return {
      id: generateId(),
      kind: ITEM_KIND.ITEM,
      text,
      collapsed: false,
      shortNotes: [],
      longNotes: [],
      children: [],
      childrenType: defaultListType.value,
      parentId,
    }
  }

  function createDividerItem() {
    return {
      id: generateId(),
      kind: ITEM_KIND.DIVIDER,
      text: '',
      collapsed: false,
      shortNotes: [],
      longNotes: [],
      children: [],
      childrenType: defaultListType.value,
      parentId: null,
    }
  }

  function isDividerItem(item) {
    return item?.kind === ITEM_KIND.DIVIDER
  }

  function addRootListItem() {
    if (!currentProject.value) return

    saveState('Add root item')
    const newItem = createListItem(DEFAULT_NEW_LIST_ITEM_TEXT)
    currentProject.value.lists.push(newItem)
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
    return newItem
  }

  function addRootListItemAfter(referenceId = null) {
    if (!currentProject.value) return

    saveState('Add root item')
    const newItem = createListItem(DEFAULT_NEW_LIST_ITEM_TEXT)

    if (!referenceId) {
      currentProject.value.lists.push(newItem)
    } else {
      const index = currentProject.value.lists.findIndex((item) => item.id === referenceId)
      if (index === -1) {
        currentProject.value.lists.push(newItem)
      } else {
        currentProject.value.lists.splice(index + 1, 0, newItem)
      }
    }

    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
    return newItem
  }

  function addRootDivider() {
    if (!currentProject.value) return

    saveState('Add root divider')
    const divider = createDividerItem()
    currentProject.value.lists.push(divider)
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
    return divider
  }

  function findItemById(items, id) {
    if (!items) return null
    
    for (const item of items) {
      if (item.id === id) return item
      if (item.children) {
        const found = findItemById(item.children, id)
        if (found) return found
      }
    }
    return null
  }

  function updateListItem(itemId, updates) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      saveState('Update item')
      Object.assign(item, updates)
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function addChildItem(parentId) {
    if (!currentProject.value) return

    const parent = findItemById(currentProject.value.lists, parentId)
    if (parent) {
      if (isDividerItem(parent)) return
      saveState('Add child item')
      const newItem = createListItem(DEFAULT_NEW_LIST_ITEM_TEXT, parentId)
      parent.children.push(newItem)
      parent.collapsed = false
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
      return newItem
    }
  }

  /** Where to insert a sibling immediately after `itemId` (same parent array + index). */
  function findSiblingInsertContext(itemId) {
    if (!currentProject.value) return null

    function walk(items, parentId = null) {
      const idx = items.findIndex((x) => x.id === itemId)
      if (idx !== -1) {
        return { parentArray: items, index: idx, parentId }
      }
      for (const item of items) {
        if (item.children?.length) {
          const found = walk(item.children, item.id)
          if (found) return found
        }
      }
      return null
    }

    return walk(currentProject.value.lists, null)
  }

  /**
   * One undo step: set current item text, then append new sibling items after it (one per line).
   * Used when pasting multi-line text into a list item.
   */
  function applyMultiLinePasteAsSiblings(currentItemId, newTextForCurrent, additionalLineTexts) {
    if (!currentProject.value) return

    const currentItem = findItemById(currentProject.value.lists, currentItemId)
    if (!currentItem || isDividerItem(currentItem)) return

    saveState('Paste as multiple items')
    currentItem.text = newTextForCurrent

    let refId = currentItemId
    for (const line of additionalLineTexts) {
      const ctx = findSiblingInsertContext(refId)
      if (!ctx) break
      const newItem = createListItem(line, ctx.parentId)
      ctx.parentArray.splice(ctx.index + 1, 0, newItem)
      refId = newItem.id
    }

    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  function deleteListItem(itemId) {
    if (!currentProject.value) return

    function removeFromList(items) {
      const index = items.findIndex((item) => item.id === itemId)
      if (index !== -1) {
        items.splice(index, 1)
        return true
      }
      for (const item of items) {
        if (removeFromList(item.children)) return true
      }
      return false
    }

    saveState('Delete item')
    if (removeFromList(currentProject.value.lists)) {
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function addShortNote(itemId, text) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      item.shortNotes.push({
        id: generateId(),
        text,
        createdAt: new Date().toISOString(),
      })
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function addLongNote(itemId, text, options = {}) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      const noteId = generateId()
      const note = {
        id: noteId,
        text,
        collapsed: false,
        createdAt: new Date().toISOString(),
      }
      const normalizedColor = normalizeHexColor(options?.collapsedBgColor)
      if (normalizedColor) {
        note.collapsedBgColor = normalizedColor
      }
      item.longNotes.push(note)
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
      return noteId
    }
  }

  function deleteNote(itemId, noteId, noteType) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      const notes = noteType === 'short' ? item.shortNotes : item.longNotes
      const index = notes.findIndex((n) => n.id === noteId)
      if (index !== -1) {
        notes.splice(index, 1)
        currentProject.value.updatedAt = new Date().toISOString()
        persistToStorage()
        if (noteType === 'long') {
          void triggerMediaGc('long-note-delete')
        }
      }
    }
  }

  function updateNote(itemId, noteId, noteType, text) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      const notes = noteType === 'short' ? item.shortNotes : item.longNotes
      const note = notes.find((n) => n.id === noteId)
      if (note) {
        note.text = text
        currentProject.value.updatedAt = new Date().toISOString()
        persistToStorage()
      }
    }
  }

  function toggleNoteCollapse(itemId, noteId) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      const note = item.longNotes.find((n) => n.id === noteId)
      if (note) {
        note.collapsed = !note.collapsed
        persistToStorage()
      }
    }
  }

  function moveItem(itemId, direction) {
    if (!currentProject.value) return

    function moveInList(items) {
      const index = items.findIndex((item) => item.id === itemId)
      if (index !== -1) {
        if (direction === 'up' && index > 0) {
          ;[items[index], items[index - 1]] = [items[index - 1], items[index]]
          return true
        } else if (direction === 'down' && index < items.length - 1) {
          ;[items[index], items[index + 1]] = [items[index + 1], items[index]]
          return true
        }
      }
      for (const item of items) {
        if (moveInList(item.children)) return true
      }
      return false
    }

    saveState(`Move item ${direction}`)
    if (moveInList(currentProject.value.lists)) {
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function indentItem(itemId) {
    if (!currentProject.value) return

    function findAndIndent(items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === itemId && i > 0) {
          if (isDividerItem(items[i]) || isDividerItem(items[i - 1])) return false
          const item = items.splice(i, 1)[0]
          item.parentId = items[i - 1].id
          items[i - 1].children.push(item)
          return true
        }
        if (findAndIndent(items[i].children)) return true
      }
      return false
    }

    saveState('Indent item')
    if (findAndIndent(currentProject.value.lists)) {
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function outdentItem(itemId) {
    if (!currentProject.value) return

    function findAndOutdent(items, parentItems = null, parentId = null) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === itemId && parentItems) {
          if (isDividerItem(items[i])) return false
          const item = items.splice(i, 1)[0]
          item.parentId = parentId
          const parentIndex = parentItems.findIndex((p) => p.children === items)
          parentItems.splice(parentIndex + 1, 0, item)
          return true
        }
        if (findAndOutdent(items[i].children, items, items[i].parentId)) return true
      }
      return false
    }

    saveState('Outdent item')
    if (findAndOutdent(currentProject.value.lists, null, null)) {
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function toggleRootListType() {
    if (!currentProject.value) return

    saveState('Toggle root list type')
    currentProject.value.rootListType =
      currentProject.value.rootListType === 'ordered' ? 'unordered' : 'ordered'
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  function toggleChildrenListType(itemId) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      saveState('Toggle children list type')
      item.childrenType = item.childrenType === 'ordered' ? 'unordered' : 'ordered'
      currentProject.value.updatedAt = new Date().toISOString()
      persistToStorage()
    }
  }

  function findNextSibling(itemId) {
    if (!currentProject.value) return null

    function findSiblings(items) {
      // Check if itemId is in this level
      const currentIndex = items.findIndex((item) => item.id === itemId)
      if (currentIndex !== -1) {
        // Found the item, return next non-divider sibling (with wraparound).
        for (let offset = 1; offset <= items.length; offset++) {
          const nextIndex = (currentIndex + offset) % items.length
          if (!isDividerItem(items[nextIndex])) {
            return items[nextIndex]
          }
        }
        return null
      }

      // Search in children
      for (const item of items) {
        if (item.children) {
          const result = findSiblings(item.children)
          if (result) return result
        }
      }
      return null
    }

    return findSiblings(currentProject.value.lists)
  }

  /** Next sibling at the same depth, no wraparound; skips root dividers. */
  function findNextSiblingNoWrap(itemId) {
    if (!currentProject.value) return null

    function findInList(items) {
      const currentIndex = items.findIndex((item) => item.id === itemId)
      if (currentIndex !== -1) {
        for (let i = currentIndex + 1; i < items.length; i++) {
          if (!isDividerItem(items[i])) {
            return items[i]
          }
        }
        return null
      }

      for (const item of items) {
        if (item.children?.length) {
          const found = findInList(item.children)
          if (found) return found
        }
      }
      return null
    }

    return findInList(currentProject.value.lists)
  }

  /** Leave current item and start editing the next sibling, or clear editing if none. */
  function exitEditAndFocusNextSibling(itemId) {
    const next = findNextSiblingNoWrap(itemId)
    if (next) {
      currentlyEditingId.value = next.id
      scrollToItemIfNeeded(next.id)
    } else {
      currentlyEditingId.value = null
    }
    return next
  }

  function setEditingItem(itemId) {
    currentlyEditingId.value = itemId
  }

  function setLongNoteEditorActive(active) {
    longNoteEditorActive.value = active
  }

  function navigateToNextSibling(itemId) {
    const nextSibling = findNextSibling(itemId)
    if (nextSibling) {
      currentlyEditingId.value = nextSibling.id
      scrollToItemIfNeeded(nextSibling.id)
    }
    return nextSibling
  }

  function findNextItemInOutline(itemId) {
    if (!currentProject.value) return null

    function findItemAndNext(items, parentItems = null, parentId = null) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]

        if (item.id === itemId) {
          // Found the item, now find the next item in the outline

          // 1. Check if there's a next sibling
          if (i + 1 < items.length) {
            for (let next = i + 1; next < items.length; next++) {
              if (!isDividerItem(items[next])) {
                return items[next]
              }
            }
          }

          // 2. No next sibling, go up to parent and find its next sibling
          if (parentItems && parentId) {
            return findNextItemInOutline(parentId)
          }

          // 3. If we're at root level and no next sibling, return null
          return null
        }

        // Recursively search in children
        if (item.children) {
          const result = findItemAndNext(item.children, items, item.id)
          if (result) return result
        }
      }
      return null
    }

    return findItemAndNext(currentProject.value.lists)
  }

  function navigateToNextItem(itemId) {
    const nextItem = findNextItemInOutline(itemId)
    if (nextItem) {
      currentlyEditingId.value = nextItem.id
      scrollToItemIfNeeded(nextItem.id)
    }
    return nextItem
  }

  function scrollToItemIfNeeded(itemId) {
    // Use nextTick to ensure DOM has updated
    setTimeout(() => {
      const element = document.querySelector(`[data-item-id="${itemId}"]`)
      if (!element) return

      const rect = element.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth

      // Check if element is visible in viewport
      const isVisible =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= viewportHeight &&
        rect.right <= viewportWidth

      // Only scroll if not visible
      if (!isVisible) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        })
      }
    }, 0)
  }

  function exportProjectAsMarkdown() {
    exportAsMarkdown(currentProject.value)
  }

  async function exportProjectAsDocx() {
    await exportAsDocx(currentProject.value)
  }

  function collapseExpandAllItems(collapse = true) {
    if (!currentProject.value) return

    function updateItemCollapse(items) {
      items.forEach(item => {
        if (item.children && item.children.length > 0) {
          item.collapsed = collapse
          updateItemCollapse(item.children)
        }
      })
    }

    saveState(collapse ? 'Collapse all items' : 'Expand all items')
    updateItemCollapse(currentProject.value.lists)
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  function collapseExpandAllLongNotes(collapse = true) {
    if (!currentProject.value) return

    function updateNotesCollapse(items) {
      items.forEach(item => {
        if (item.longNotes && item.longNotes.length > 0) {
          item.longNotes.forEach(note => {
            note.collapsed = collapse
          })
        }
        if (item.children && item.children.length > 0) {
          updateNotesCollapse(item.children)
        }
      })
    }

    saveState(collapse ? 'Collapse all long notes' : 'Expand all long notes')
    updateNotesCollapse(currentProject.value.lists)
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  const allLongNotesVisible = ref(true)

  function showHideAllLongNotes(show = true) {
    if (!currentProject.value) return

    function updateNotesVisibility(items) {
      items.forEach(item => {
        if (item.longNotes && item.longNotes.length > 0) {
          item.longNotes.forEach(note => {
            note.hidden = !show
          })
        }
        if (item.children && item.children.length > 0) {
          updateNotesVisibility(item.children)
        }
      })
    }

    allLongNotesVisible.value = show
    saveState(show ? 'Show all long notes' : 'Hide all long notes')
    updateNotesVisibility(currentProject.value.lists)
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  async function loadVersionsForProject(projectId) {
    if (!projectId) return []
    const adapter = getStorageAdapter()
    const entries = await adapter.getMetaEntries(`scaffold-version-${projectId}-`)
    return entries
      .map((entry) => {
        try {
          return JSON.parse(entry.value)
        } catch {
          return null
        }
      })
      .filter((v) => v !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  async function gatherVersionsByProjectId(projectIds) {
    const map = {}
    for (const projectId of projectIds) {
      const versions = await loadVersionsForProject(projectId)
      if (versions.length > 0) {
        map[projectId] = versions
      }
    }
    return map
  }

  async function exportProjectAsJSON(options = {}) {
    if (!currentProject.value) return
    const startedAt = Date.now()
    const format = options.format === 'scaffoldz' ? 'scaffoldz' : 'json'
    logger.info('export.start', {
      scope: 'single',
      format,
      projectId: currentProject.value.id,
      includeVersionHistory: Boolean(options.includeVersionHistory),
      contextId: activeContextId.value,
    })
    try {
      const exportOptions = {}
      if (options.includeVersionHistory) {
        exportOptions.versionsByProjectId = await gatherVersionsByProjectId([
          currentProject.value.id,
        ])
      }
      if (format === 'scaffoldz') {
        const bytes = await buildScaffoldzBundle(
          [currentProject.value],
          currentProject.value.id,
          exportOptions,
        )
        const filename = `${currentProject.value.name}_outline_${getFilenameTimestamp()}`
        await downloadScaffoldzBundle(bytes, filename)
      } else {
        await exportSingleProjectAsJSON(currentProject.value, exportOptions)
      }
      logger.info('export.success', {
        scope: 'single',
        format,
        projectId: currentProject.value.id,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      logger.error('export.failed', error, {
        scope: 'single',
        format,
        projectId: currentProject.value?.id,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  async function exportAllAsJSON(options = {}) {
    const startedAt = Date.now()
    const format = options.format === 'scaffoldz' ? 'scaffoldz' : 'json'
    logger.info('export.start', {
      scope: 'all',
      format,
      projectCount: projects.value.length,
      includeVersionHistory: Boolean(options.includeVersionHistory),
      contextId: activeContextId.value,
    })
    try {
      const exportOptions = {}
      if (options.includeVersionHistory) {
        exportOptions.versionsByProjectId = await gatherVersionsByProjectId(
          projects.value.map((p) => p.id),
        )
      }
      if (format === 'scaffoldz') {
        const bytes = await buildScaffoldzBundle(projects.value, null, exportOptions)
        const filename = `outline_maker_backup_${getFilenameTimestamp()}`
        await downloadScaffoldzBundle(bytes, filename)
      } else {
        await exportAllProjectsAsJSON(projects.value, exportOptions)
      }
      logger.info('export.success', {
        scope: 'all',
        format,
        projectCount: projects.value.length,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      logger.error('export.failed', error, {
        scope: 'all',
        format,
        projectCount: projects.value.length,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  async function persistImportedVersions(versionsByOriginalProjectId, projectIdMap) {
    const adapter = getStorageAdapter()
    const summary = { imported: 0, skipped: 0, warnings: [] }

    for (const [originalProjectId, versions] of Object.entries(versionsByOriginalProjectId)) {
      const targetProjectId = projectIdMap[originalProjectId]
      if (!targetProjectId) {
        summary.warnings.push(
          `Dropped ${versions.length} version(s) for unknown project ${originalProjectId}`,
        )
        summary.skipped += versions.length
        continue
      }

      for (const version of versions) {
        const remapped = remapVersionForTargetProject(version, targetProjectId)
        if (!remapped) {
          summary.skipped += 1
          summary.warnings.push(
            `Skipped a malformed version entry for project ${targetProjectId}`,
          )
          continue
        }
        const key = `scaffold-version-${targetProjectId}-${remapped.id}`
        try {
          await adapter.setMeta(key, JSON.stringify(remapped))
          summary.imported += 1
        } catch (err) {
          summary.skipped += 1
          summary.warnings.push(
            `Failed to save version ${remapped.id} for project ${targetProjectId}: ${err?.message || err}`,
          )
        }
      }
    }

    return summary
  }

  function remapVersionForTargetProject(version, targetProjectId) {
    if (!version || typeof version !== 'object' || !version.id) return null
    if (!version.data || !Array.isArray(version.data.projects)) return null

    const remappedData = {
      ...version.data,
      projects: version.data.projects.map((proj) => ({
        ...proj,
        id: targetProjectId,
      })),
    }

    return {
      id: version.id,
      projectId: targetProjectId,
      name: version.name ?? null,
      timestamp: version.timestamp,
      trigger: version.trigger || null,
      stats: version.stats || { items: 0, notes: 0 },
      data: remappedData,
    }
  }

  async function importFromJSONFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.scaffoldz,.zip'
      input.onchange = async (event) => {
        const file = event.target.files[0]
        if (!file) {
          reject(new Error('No file selected'))
          return
        }

        const importStartedAt = Date.now()
        logger.info('import.start', {
          fileName: file.name,
          fileSizeBytes: file.size,
          contextId: activeContextId.value,
        })
        try {
          // Auto-detect bundle vs plain JSON: prefer extension when
          // it's unambiguous, otherwise sniff the magic bytes. We
          // probe arrayBuffer first because real File objects support
          // it; tests using plain stubs may expose only `text()`, so
          // we fall back gracefully.
          const lowerName = (file.name || '').toLowerCase()
          const bundleByExt =
            lowerName.endsWith('.scaffoldz') || lowerName.endsWith('.zip')

          let importResult
          let detectedFormat = 'json'
          let detectedBy = 'extension'
          if (bundleByExt && typeof file.arrayBuffer === 'function') {
            const bytes = new Uint8Array(await file.arrayBuffer())
            detectedFormat = 'scaffoldz'
            importResult = await importScaffoldzBundle(bytes)
          } else if (typeof file.arrayBuffer === 'function') {
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (isZipMagic(bytes)) {
              detectedFormat = 'scaffoldz'
              detectedBy = 'magic'
              importResult = await importScaffoldzBundle(bytes)
            } else {
              const text = new TextDecoder().decode(bytes)
              const jsonData = JSON.parse(text)
              importResult = await importFromJSON(jsonData)
            }
          } else {
            const text = await file.text()
            const jsonData = JSON.parse(text)
            importResult = await importFromJSON(jsonData)
          }
          logger.debug('import.format.detected', {
            format: detectedFormat,
            detectedBy,
            fileName: file.name,
          })
          const warnings = [...(importResult.warnings || [])]

          // Track original-id → final-id so version-history meta keys can be remapped.
          const projectIdMap = {}

          importResult.projects.forEach(importedProject => {
            const originalId = importedProject.id
            const existingProject = projects.value.find(p => p.id === originalId)
            if (existingProject) {
              importedProject.id = generateId()
              importedProject.name = `${importedProject.name} (Imported)`
            }
            projectIdMap[originalId] = importedProject.id

            if (!importedProject.createdAt) {
              importedProject.createdAt = new Date().toISOString()
            }
            if (!importedProject.updatedAt) {
              importedProject.updatedAt = new Date().toISOString()
            }

            projects.value.push(importedProject)
          })

          persistToStorage()

          let importedVersionCount = 0
          if (
            importResult.projectVersions &&
            Object.keys(importResult.projectVersions).length > 0
          ) {
            const summary = await persistImportedVersions(
              importResult.projectVersions,
              projectIdMap,
            )
            importedVersionCount = summary.imported
            warnings.push(...summary.warnings)
          }

          await refreshMediaUsage()

          logger.info('import.success', {
            format: detectedFormat,
            fileName: file.name,
            projectsImported: importResult.projects.length,
            versionsImported: importedVersionCount,
            mediaImported: importResult.importedMediaCount || 0,
            warningsCount: warnings.length,
            durationMs: Date.now() - importStartedAt,
            contextId: activeContextId.value,
          })

          resolve({
            success: true,
            imported: importResult.projects.length,
            importedVersions: importedVersionCount,
            importedMedia: importResult.importedMediaCount || 0,
            warnings,
          })
        } catch (error) {
          logger.error('import.failed', error, {
            fileName: file.name,
            fileSizeBytes: file.size,
            durationMs: Date.now() - importStartedAt,
            contextId: activeContextId.value,
          })
          reject(error)
        }
      }
      input.click()
    })
  }

  function setFontSize(size) {
    // Legacy alias: keep fontSize derived from non-Tibetan text size.
    setNonTibetanFontSize(size)
  }

  function setFontScale(scale) {
    fontScale.value = scale
    persistToStorage()
  }

  function setIndentSize(size) {
    indentSize.value = size
    if (currentProject.value) {
      if (!currentProject.value.settings) {
        currentProject.value.settings = {}
      }
      currentProject.value.settings.indentSize = size
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setDefaultListType(type) {
    defaultListType.value = type
    if (currentProject.value) {
      if (!currentProject.value.settings) {
        currentProject.value.settings = {}
      }
      currentProject.value.settings.defaultListType = type
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setShowIndentGuides(show) {
    showIndentGuides.value = show
    if (currentProject.value) {
      if (!currentProject.value.settings) {
        currentProject.value.settings = {}
      }
      currentProject.value.settings.showIndentGuides = show
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setShowLongNotesInOutline(show) {
    showLongNotesInOutline.value = show
    if (currentProject.value) {
      if (!currentProject.value.settings) {
        currentProject.value.settings = {}
      }
      currentProject.value.settings.showLongNotesInOutline = show
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setTibetanFontFamily(value) {
    tibetanFontFamily.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontFamily = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setTibetanFontSize(value) {
    tibetanFontSize.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontSize = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setTibetanFontColor(value) {
    tibetanFontColor.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontColor = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setNonTibetanFontFamily(value) {
    nonTibetanFontFamily.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.nonTibetanFontFamily = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setNonTibetanFontSize(value) {
    nonTibetanFontSize.value = value
    fontSize.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.nonTibetanFontSize = value
      currentProject.value.settings.fontSize = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  function setNonTibetanFontColor(value) {
    nonTibetanFontColor.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.nonTibetanFontColor = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    persistToStorage()
  }

  /**
   * Update the project-level "root" hex color used to derive the
   * 6-swatch complementary palette shown in the long-note editor.
   * Invalid input is ignored so reactive bindings on the dialog can
   * pass raw values from a color input without guarding callers.
   */
  function setLongNoteColorRoot(value) {
    const normalized = normalizeHexColor(value)
    if (!normalized) return
    if (!currentProject.value) return
    if (!currentProject.value.settings) currentProject.value.settings = {}
    if (currentProject.value.settings.longNoteColorRoot === normalized) return
    currentProject.value.settings.longNoteColorRoot = normalized
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  /**
   * Push a custom hex color into the project-level "recent customs"
   * list (most-recent first, deduped, capped). Invalid colors are
   * ignored. Used when the user picks a color via the dialog's custom
   * picker so subsequent notes can quickly reuse it.
   */
  function pushLongNoteRecentCustomColor(value) {
    const normalized = normalizeHexColor(value)
    if (!normalized) return
    if (!currentProject.value) return
    if (!currentProject.value.settings) currentProject.value.settings = {}
    const next = pushRecentCustomColor(
      currentProject.value.settings.longNoteRecentCustomColors,
      normalized,
    )
    currentProject.value.settings.longNoteRecentCustomColors = next
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  /**
   * Set (or clear) the per-note collapsed-background color.
   *
   * - Pass `null` / `undefined` to explicitly clear the color so the
   *   note falls back to the default neutral background.
   * - Pass a hex string to apply a tint that only renders when the
   *   note is collapsed; the value is normalized.
   * - Pass any other (invalid) string to leave the existing value
   *   untouched. This protects against accidental clears caused by
   *   in-flight UI inputs (e.g. an empty / mid-typing color picker
   *   value).
   */
  function setLongNoteBackground(itemId, noteId, color) {
    if (!currentProject.value) return
    const item = findItemById(currentProject.value.lists, itemId)
    if (!item || isDividerItem(item)) return
    const note = item.longNotes.find((n) => n.id === noteId)
    if (!note) return

    if (color == null) {
      if (!('collapsedBgColor' in note)) return
      delete note.collapsedBgColor
    } else {
      const normalized = normalizeHexColor(color)
      if (!normalized) return
      if (note.collapsedBgColor === normalized) return
      note.collapsedBgColor = normalized
    }
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  /**
   * Project-wide strength for long-note background tints: how strongly
   * each note's `collapsedBgColor` blends over the default surface
   * (`1` = full color, `0` = surface only). Applies to every long note
   * in the current project that has a background color.
   */
  function setLongNoteBgOpacity(value) {
    const next = clampOpacity(value)
    if (!currentProject.value) return
    if (!currentProject.value.settings) currentProject.value.settings = {}
    const raw = currentProject.value.settings.longNoteBgOpacity
    if (next === DEFAULT_LONG_NOTE_BG_OPACITY) {
      if (raw === undefined || raw === null) return
      delete currentProject.value.settings.longNoteBgOpacity
    } else {
      if (raw === next) return
      currentProject.value.settings.longNoteBgOpacity = next
    }
    currentProject.value.updatedAt = new Date().toISOString()
    persistToStorage()
  }

  /**
   * Remove legacy per-note `collapsedBgOpacity` from the tree. If the
   * project has no `settings.longNoteBgOpacity` yet, hoist the first
   * encountered per-note value (when paired with a color) so users who
   * set strength before it became project-wide don't lose it.
   */
  function migrateLongNoteBgOpacityProjectWide(project) {
    if (!project?.lists) return
    let hoisted = null
    function visit(items) {
      for (const item of items) {
        for (const note of item.longNotes || []) {
          if (
            note.collapsedBgOpacity != null &&
            normalizeHexColor(note.collapsedBgColor)
          ) {
            const o = clampOpacity(note.collapsedBgOpacity)
            if (hoisted === null) hoisted = o
          }
          delete note.collapsedBgOpacity
        }
        if (item.children?.length) visit(item.children)
      }
    }
    visit(project.lists)

    if (!project.settings) project.settings = {}
    if (
      project.settings.longNoteBgOpacity === undefined ||
      project.settings.longNoteBgOpacity === null
    ) {
      project.settings.longNoteBgOpacity = hoisted ?? DEFAULT_LONG_NOTE_BG_OPACITY
    } else {
      project.settings.longNoteBgOpacity = clampOpacity(project.settings.longNoteBgOpacity)
    }
  }

  function isQuotaExceededError(error) {
    if (!error) return false
    return (
      error?.name === 'QuotaExceededError' ||
      error?.code === 22 ||
      error?.code === 1014 ||
      /quota/i.test(error?.message || '')
    )
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex++
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
  }

  function getPersistErrorMessage(error) {
    if (isQuotaExceededError(error)) {
      return 'Storage is full. Remove large long-note media or switch to URL-based media, then try again.'
    }
    return 'Could not save changes to browser storage. Try reloading after exporting a JSON backup.'
  }

  async function updateStorageUsageWarning(adapter) {
    try {
      const stats = await adapter.getStorageStats()
      const used = stats?.used || 0
      const quota = stats?.quota || FALLBACK_LOCAL_STORAGE_QUOTA_BYTES

      if (!quota) {
        storageUsageRatio.value = 0
        storageUsageWarning.value = null
        return
      }

      const ratio = used / quota
      storageUsageRatio.value = ratio
      if (ratio >= STORAGE_USAGE_WARNING_THRESHOLD) {
        const percent = Math.round(ratio * 100)
        storageUsageWarning.value =
          `Storage usage is high (${percent}%: ${formatBytes(used)} of ${formatBytes(quota)}). ` +
          'Prefer media URLs over large uploads.'
      } else {
        storageUsageWarning.value = null
      }
    } catch {
      storageUsageRatio.value = 0
      storageUsageWarning.value = null
    }
  }

  async function refreshMediaUsage() {
    try {
      const stats = await getMediaAdapter().getStats()
      mediaUsage.value = {
        count: stats?.count || 0,
        bytes: stats?.bytes || 0,
      }
      // getStats() on layered S3 backends issues a remote LIST. A
      // successful return clears any previous unreachable signal.
      if (mediaBackendSupportsRemoteSync()) setMediaRemoteListError(null)
    } catch (error) {
      logger.error('media.usage.refresh.failed', error, {
        backend: mediaBackend.value,
      })
      if (mediaBackendSupportsRemoteSync()) setMediaRemoteListError(error)
    }
    return mediaUsage.value
  }

  async function triggerMediaGc(reason = 'scheduled') {
    const startedAt = Date.now()
    try {
      const stats = await runMediaGc()
      await refreshMediaUsage()
      logger.info('media.gc.success', {
        gcReason: reason,
        deleted: stats?.deleted || 0,
        kept: stats?.kept || 0,
        skippedByGrace: stats?.skippedByGrace || 0,
        durationMs: Date.now() - startedAt,
        backend: mediaBackend.value,
      })
    } catch (error) {
      logger.error('media.gc.failed', error, {
        gcReason: reason,
        durationMs: Date.now() - startedAt,
        backend: mediaBackend.value,
      })
    }
  }

  // Re-run capability-based media backend selection. Used by the
  // Settings UI after a user picks (or clears) a custom media folder
  // so the active adapter immediately reflects the new choice.
  async function reselectMediaBackend() {
    const previous = mediaBackend.value
    // Clear the stale unreachable signal: the about-to-be-installed
    // adapter hasn't been probed yet. refreshMediaUsage below will
    // set it again if the new backend's first LIST also fails.
    setMediaRemoteListError(null)
    try {
      const result = await selectMediaAdapter()
      mediaBackend.value = result?.backend || 'idb'
      await refreshMediaUsage()
      logger.info('media.backend.reselect.success', {
        previousBackend: previous,
        backend: mediaBackend.value,
      })
      return mediaBackend.value
    } catch (error) {
      logger.error('media.backend.reselect.failed', error, {
        previousBackend: previous,
      })
      return mediaBackend.value
    }
  }

  function startMediaGcTimer() {
    if (mediaGcTimer !== null) return
    if (typeof setInterval !== 'function') return
    mediaGcTimer = setInterval(() => {
      void triggerMediaGc('interval')
    }, MEDIA_GC_INTERVAL_MS)
  }

  function stopMediaGcTimer() {
    if (mediaGcTimer !== null) {
      clearInterval(mediaGcTimer)
      mediaGcTimer = null
    }
  }

  function persistToStorage() {
    const adapter = getStorageAdapter()
    const projectsSnapshot = JSON.parse(JSON.stringify(projects.value))
    const currentProjectSnapshot = currentProjectId.value || ''
    const fontScaleSnapshot = fontScale.value.toString()

    void (async () => {
      try {
        await adapter.saveProjects(projectsSnapshot)
        await adapter.setMeta('current-project', currentProjectSnapshot)
        await adapter.setMeta('font-scale', fontScaleSnapshot)
        storageSaveError.value = null
        await updateStorageUsageWarning(adapter)
      } catch (error) {
        storageSaveError.value = getPersistErrorMessage(error)
        logger.error('persist.save.failed', error, {
          contextId: activeContextId.value,
          projectCount: projectsSnapshot.length,
          currentProjectId: currentProjectSnapshot || null,
        })
      }
    })()
  }

  /**
   * Awaitable version of `persistToStorage` used by call sites that
   * must guarantee the on-disk state is current before reading it
   * back (e.g. cloning the active context's data into a new
   * context). Mirrors the writes performed by `persistToStorage` but
   * lets the caller observe completion + propagates errors instead
   * of stuffing them into `storageSaveError`.
   */
  async function flushPersistence() {
    const adapter = getStorageAdapter()
    const projectsSnapshot = JSON.parse(JSON.stringify(projects.value))
    const currentProjectSnapshot = currentProjectId.value || ''
    const fontScaleSnapshot = fontScale.value.toString()
    await adapter.saveProjects(projectsSnapshot)
    await adapter.setMeta('current-project', currentProjectSnapshot)
    await adapter.setMeta('font-scale', fontScaleSnapshot)
  }

  function createExampleProject() {
    const project = {
      id: generateId(),
      name: '📋 Welcome to Scaffold (Example Project)',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lists: [
        {
          id: generateId(),
          kind: ITEM_KIND.ITEM,
          text: 'Getting Started with Scaffold',
          collapsed: false,
          childrenType: 'ordered',
          shortNotes: [],
          longNotes: [{
            id: generateId(),
            text: '<p>Welcome to <strong>Scaffold</strong>! This example project demonstrates the key features of this powerful hierarchical outline and note-taking application.</p><p>Feel free to explore, edit, or delete this project once you\'re familiar with the interface.</p>',
            collapsed: false
          }],
          children: [
            {
              id: generateId(),
              kind: ITEM_KIND.ITEM,
              text: 'Create and organize hierarchical outlines',
              collapsed: false,
              childrenType: 'unordered',
              shortNotes: [{
                id: generateId(),
                text: 'unlimited depth'
              }],
              longNotes: [],
              children: [
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Use Tab key to navigate between items',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Press Enter to create new sibling items',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Toggle between numbered and bullet lists',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                }
              ]
            },
            {
              id: generateId(),
              kind: ITEM_KIND.ITEM,
              text: 'Add notes to provide context and details',
              collapsed: false,
              childrenType: 'unordered',
              shortNotes: [],
              longNotes: [],
              children: [
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Short notes for quick references',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [{
                    id: generateId(),
                    text: 'like page numbers or brief citations'
                  }],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Long notes for detailed explanations',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [{
                    id: generateId(),
                    text: '<p>Long notes support <strong>rich text formatting</strong> including:</p><ul><li>Bold and italic text</li><li>Lists and quotes</li><li>Links and images</li><li>Code blocks</li></ul><blockquote><p>This is a blockquote example that will export beautifully to Word and Markdown formats.</p></blockquote>',
                    collapsed: false
                  }],
                  children: []
                }
              ]
            }
          ]
        },
        {
          id: generateId(),
          kind: ITEM_KIND.ITEM,
          text: 'Key Features to Explore',
          collapsed: false,
          childrenType: 'ordered',
          shortNotes: [],
          longNotes: [],
          children: [
            {
              id: generateId(),
              kind: ITEM_KIND.ITEM,
              text: 'Export your work in multiple formats',
              collapsed: false,
              childrenType: 'unordered',
              shortNotes: [],
              longNotes: [],
              children: [
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Markdown export for documentation and web publishing',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Microsoft Word export with proper styles and formatting',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'JSON export for complete backup and data portability',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                }
              ]
            },
            {
              id: generateId(),
              kind: ITEM_KIND.ITEM,
              text: 'Keyboard shortcuts for efficient editing',
              collapsed: false,
              childrenType: 'unordered',
              shortNotes: [{
                id: generateId(),
                text: 'see help for full list'
              }],
              longNotes: [],
              children: [
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Ctrl/Cmd + Z/Y for undo/redo',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Ctrl/Cmd + B to toggle sidebar',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Tab/Shift+Tab for navigation',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                }
              ]
            },
            {
              id: generateId(),
              kind: ITEM_KIND.ITEM,
              text: 'Bulk operations and customization',
              collapsed: false,
              childrenType: 'unordered',
              shortNotes: [],
              longNotes: [],
              children: [
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Collapse/expand all items or notes at once',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                },
                {
                  id: generateId(),
                  kind: ITEM_KIND.ITEM,
                  text: 'Customize font size, indentation, and display options per project',
                  collapsed: false,
                  childrenType: 'ordered',
                  shortNotes: [],
                  longNotes: [],
                  children: []
                }
              ]
            }
          ]
        },
        {
          id: generateId(),
          kind: ITEM_KIND.ITEM,
          text: 'Next Steps',
          collapsed: false,
          childrenType: 'ordered',
          shortNotes: [],
          longNotes: [{
            id: generateId(),
            text: '<p>Ready to start your own project? Here\'s what you can do:</p><ol><li>Create a new project using the + button in the sidebar</li><li>Import existing data using the JSON import feature</li><li>Explore the settings to customize your experience</li><li>Export this example project to see how different formats work</li></ol><p>Happy outlining! 🎉</p>',
            collapsed: false
          }],
          children: []
        }
      ],
      rootListType: 'ordered',
      settings: {
        fontSize: fontSize.value,
        indentSize: indentSize.value,
        defaultListType: defaultListType.value,
        showIndentGuides: showIndentGuides.value,
        showLongNotesInOutline: showLongNotesInOutline.value,
        tibetanFontFamily: tibetanFontFamily.value,
        tibetanFontSize: tibetanFontSize.value,
        tibetanFontColor: tibetanFontColor.value,
        nonTibetanFontFamily: nonTibetanFontFamily.value,
        nonTibetanFontSize: nonTibetanFontSize.value,
        nonTibetanFontColor: nonTibetanFontColor.value,
        longNoteColorRoot: DEFAULT_LONG_NOTE_COLOR_ROOT,
        longNoteRecentCustomColors: [],
        longNoteBgOpacity: DEFAULT_LONG_NOTE_BG_OPACITY,
      },
    }
    projects.value.push(project)
    persistToStorage()
    return project
  }

  async function loadFromStorage() {
    const adapter = getStorageAdapter()
    const loadedProjects = await adapter.loadProjects()
    const savedCurrentId = await adapter.getMeta('current-project')
    const savedFontScale = await adapter.getMeta('font-scale')
    let adjustedCurrentDueToLock = false

    if (savedFontScale) {
      fontScale.value = parseInt(savedFontScale, 10)
    }

    if (loadedProjects.length > 0) {
      projects.value = loadedProjects

      projects.value.forEach((project) => {
        if (!project.rootListType) {
          project.rootListType = 'ordered'
        }

        if (!project.settings) {
          project.settings = {
            fontSize: fontSize.value,
            indentSize: indentSize.value,
            defaultListType: defaultListType.value,
            showIndentGuides: showIndentGuides.value,
            showLongNotesInOutline: showLongNotesInOutline.value,
            tibetanFontFamily: tibetanFontFamily.value,
            tibetanFontSize: tibetanFontSize.value,
            tibetanFontColor: tibetanFontColor.value,
            nonTibetanFontFamily: nonTibetanFontFamily.value,
            nonTibetanFontSize: nonTibetanFontSize.value,
            nonTibetanFontColor: nonTibetanFontColor.value,
            longNoteColorRoot: DEFAULT_LONG_NOTE_COLOR_ROOT,
            longNoteRecentCustomColors: [],
            longNoteBgOpacity: DEFAULT_LONG_NOTE_BG_OPACITY,
          }
        } else {
          project.settings.fontSize =
            project.settings.nonTibetanFontSize || project.settings.fontSize || fontSize.value
          project.settings.tibetanFontFamily =
            project.settings.tibetanFontFamily || tibetanFontFamily.value
          project.settings.tibetanFontSize = project.settings.tibetanFontSize || tibetanFontSize.value
          project.settings.tibetanFontColor =
            project.settings.tibetanFontColor || tibetanFontColor.value
          project.settings.nonTibetanFontFamily =
            project.settings.nonTibetanFontFamily || nonTibetanFontFamily.value
          project.settings.nonTibetanFontSize =
            project.settings.nonTibetanFontSize || nonTibetanFontSize.value
          project.settings.nonTibetanFontColor =
            project.settings.nonTibetanFontColor || nonTibetanFontColor.value
          project.settings.longNoteColorRoot =
            normalizeHexColor(project.settings.longNoteColorRoot) ||
            DEFAULT_LONG_NOTE_COLOR_ROOT
          project.settings.longNoteRecentCustomColors = Array.isArray(
            project.settings.longNoteRecentCustomColors,
          )
            ? project.settings.longNoteRecentCustomColors
                .map(normalizeHexColor)
                .filter(Boolean)
                .slice(0, MAX_RECENT_CUSTOM_COLORS)
            : []
        }

        function migrateItems(items) {
          items.forEach((item) => {
            if (!item.kind) {
              item.kind = ITEM_KIND.ITEM
            }
            if (item.type && !item.childrenType) {
              item.childrenType = 'ordered'
              delete item.type
            }
            if (!item.childrenType) {
              item.childrenType = 'ordered'
            }
            if (item.children) {
              migrateItems(item.children)
            }
          })
        }
        if (project.lists) {
          migrateItems(project.lists)
        }
        migrateLongNoteBgOpacityProjectWide(project)
      })
    }

    if (savedCurrentId && projects.value.length > 0) {
      const myTabId = getTabInstanceId()
      let targetId = savedCurrentId
      const exists = projects.value.some((p) => p.id === savedCurrentId)
      if (exists && isProjectLockedByOtherTab(savedCurrentId, myTabId)) {
        const fallback = projects.value.find((p) => !isProjectLockedByOtherTab(p.id, myTabId))
        targetId = fallback?.id ?? null
        adjustedCurrentDueToLock = targetId !== savedCurrentId
      } else if (!exists) {
        targetId = projects.value[0]?.id ?? null
        adjustedCurrentDueToLock = true
      }
      currentProjectId.value = targetId
      if (targetId) {
        const selectedProject = projects.value.find((project) => project.id === targetId)
        applyProjectSettingsFromProject(selectedProject)
        clearHistory()
      }
    }

    if (projects.value.length === 0) {
      const exampleProject = createExampleProject()
      currentProjectId.value = exampleProject.id
    }

    syncProjectLockSession()
    if (adjustedCurrentDueToLock) {
      persistToStorage()
    }

    storeReady.value = true
    logger.debug('store.loadFromStorage.success', {
      contextId: activeContextId.value,
      projectsLoaded: projects.value.length,
      currentProjectId: currentProjectId.value,
      adjustedCurrentDueToLock,
    })
  }

  function registerProjectLockUnloadHandlers() {
    const release = () => releaseCurrentProjectLockForUnload()
    window.addEventListener('beforeunload', release)
    window.addEventListener('pagehide', release)
  }

  /**
   * Reset the in-memory store state to the empty defaults. Used by
   * `switchContext` to ensure the new context starts from a clean
   * slate before its data is hydrated from storage. The defaults
   * mirror those declared at the top of the setup function.
   */
  function resetStoreStateForSwitch() {
    teardownAutoVersioning()
    stopProjectLockHeartbeat()
    releaseCurrentProjectLockForUnload()

    projects.value = []
    currentProjectId.value = null
    fontSize.value = 14
    fontScale.value = 100
    indentSize.value = 32
    defaultListType.value = 'ordered'
    showIndentGuides.value = true
    showLongNotesInOutline.value = true
    tibetanFontFamily.value = 'Microsoft Himalaya'
    tibetanFontSize.value = 20
    tibetanFontColor.value = '#000000'
    nonTibetanFontFamily.value = 'Aptos, sans-serif'
    nonTibetanFontSize.value = 16
    nonTibetanFontColor.value = '#000000'
    undoStack.value = []
    redoStack.value = []
    currentlyEditingId.value = null
    longNoteEditorActive.value = false
    storageSaveError.value = null
    storageUsageWarning.value = null
    storageUsageRatio.value = 0
    projectLockBlockedProjectId.value = null
    mediaUsage.value = { count: 0, bytes: 0 }
  }

  /**
   * Refresh the in-memory `contexts` registry from storage. Used by
   * the UI after create/rename/delete operations.
   */
  async function refreshContextRegistry() {
    try {
      contexts.value = await loadContextRegistry()
    } catch (error) {
      logger.error('context.registry.refresh.failed', error)
    }
    return contexts.value
  }

  /**
   * Switch the active context. Persists the choice, drops the
   * outline store's in-memory state, swaps the storage adapter's
   * scope, and rehydrates from the new context's data. Ignores the
   * call when the requested context is already active.
   *
   * @param {string} id - Target context id
   * @returns {Promise<boolean>} True when the switch happened.
   */
  async function switchContext(id) {
    if (!id) return false
    if (id === activeContextId.value) return false

    // Flip the in-flight flag synchronously (before any await) so UI
    // observers see the spinner the instant the switch starts.
    switchingContext.value = true
    storeReady.value = false
    const fromContextId = activeContextId.value
    const startedAt = Date.now()
    logger.info('context.switch.start', { fromContextId, toContextId: id })
    try {
      const registry = await loadContextRegistry()
      if (!registry.some((c) => c.id === id)) {
        logger.error('context.switch.invalidTarget', {
          toContextId: id,
          fromContextId,
        })
        return false
      }

      resetStoreStateForSwitch()

      setActiveContextId(id)
      activeContextId.value = id
      try {
        await setStoredActiveContextId(id)
      } catch (error) {
        logger.error('context.switch.persistActive.failed', error, {
          toContextId: id,
        })
      }

      contexts.value = registry

      await loadFromStorage()
      await hydrateActiveContext()
      logger.info('context.switch.success', {
        fromContextId,
        toContextId: id,
        projectsLoaded: projects.value.length,
        backend: mediaBackend.value,
        durationMs: Date.now() - startedAt,
      })
      return true
    } catch (error) {
      logger.error('context.switch.failed', error, {
        fromContextId,
        toContextId: id,
        durationMs: Date.now() - startedAt,
      })
      throw error
    } finally {
      switchingContext.value = false
    }
  }

  /**
   * Create a new context, optionally switching into it immediately.
   *
   * By default the new context starts blank: hydration will spin up
   * the example project just like a first-launch user.
   *
   * Pass `cloneFromCurrent: true` to copy every persisted meta entry
   * (projects, version snapshots, program settings, font scale,
   * S3-config marker, etc.) from the active context into the new
   * one. Media bytes are content-addressable and remain shared, so
   * cloning is cheap. The active context's in-memory state is
   * flushed to storage first to make sure unsaved edits aren't lost
   * along the way.
   *
   * @param {string} name
   * @param {{ activate?: boolean, cloneFromCurrent?: boolean }} [options]
   */
  async function createNewContext(name, options = {}) {
    let cloneFromId = null
    if (options.cloneFromCurrent && activeContextId.value) {
      cloneFromId = activeContextId.value
      try {
        await flushPersistence()
      } catch (error) {
        logger.error('context.create.flushBeforeClone.failed', error, {
          sourceContextId: cloneFromId,
        })
      }
    }
    const ctx = await createContext(name, { cloneFromId })
    contexts.value = await loadContextRegistry()
    logger.info('context.create.success', {
      newContextId: ctx.id,
      cloneFromId,
      activate: options.activate !== false,
    })
    if (options.activate !== false) {
      await switchContext(ctx.id)
    }
    return ctx
  }

  /**
   * Rename an existing context.
   *
   * @param {string} id
   * @param {string} name
   */
  async function renameContextById(id, name) {
    const updated = await renameContext(id, name)
    contexts.value = await loadContextRegistry()
    return updated
  }

  /**
   * Delete a context. Refuses when it would empty the registry. When
   * the deleted context is currently active, switches to the first
   * remaining context first so the UI never lands in a context-less
   * state.
   *
   * @param {string} id
   * @returns {Promise<{ deleted: boolean, reason?: string }>}
   */
  async function deleteContextById(id) {
    const registry = await loadContextRegistry()
    if (registry.length <= 1) {
      return { deleted: false, reason: 'last-context' }
    }
    if (id === activeContextId.value) {
      const fallback = registry.find((c) => c.id !== id)
      if (fallback) {
        await switchContext(fallback.id)
      }
    }
    const result = await deleteContext(id)
    contexts.value = await loadContextRegistry()
    return result
  }

  async function saveVersion(name = null, trigger = 'manual') {
    if (!currentProject.value) return
    
    const currentData = exportAsJSON([currentProject.value], currentProject.value.id)
    
    const latestVersion = await getLatestVersion(currentProject.value.id)
    if (latestVersion && latestVersion.data) {
      const currentProjectJson = JSON.stringify(currentData.projects[0])
      const latestProjectJson = JSON.stringify(latestVersion.data.projects[0])
      
      if (currentProjectJson === latestProjectJson) {
        return null
      }
    }
    
    const versionId = generateId()
    const timestamp = Date.now()
    
    let itemCount = 0
    let noteCount = 0
    
    function countItems(items) {
      items.forEach(item => {
        if (!isDividerItem(item)) {
          itemCount++
        }
        noteCount += (item.shortNotes?.length || 0) + (item.longNotes?.length || 0)
        if (item.children) {
          countItems(item.children)
        }
      })
    }
    
    countItems(currentProject.value.lists)
    
    const versionData = {
      id: versionId,
      projectId: currentProject.value.id,
      name: name,
      timestamp: timestamp,
      trigger: trigger,
      stats: {
        items: itemCount,
        notes: noteCount
      },
      data: currentData
    }
    
    const key = `scaffold-version-${currentProject.value.id}-${versionId}`
    await getStorageAdapter().setMeta(key, JSON.stringify(versionData))
    
    return versionId
  }

  async function getLatestVersion(projectId) {
    const adapter = getStorageAdapter()
    const entries = await adapter.getMetaEntries(`scaffold-version-${projectId}-`)
    
    const versions = entries
      .map((entry) => {
        try {
          return JSON.parse(entry.value)
        } catch {
          return null
        }
      })
      .filter((v) => v !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
    
    return versions.length > 0 ? versions[0] : null
  }

  async function restoreVersion(version) {
    if (!version || !version.data) return null

    try {
      // Import the version data
      const imported = await importFromJSON(version.data)
      if (imported.projects && imported.projects.length > 0) {
        const restoredProject = imported.projects[0]
        
        // Create new ID and update name
        restoredProject.id = generateId()
        restoredProject.name = `${restoredProject.name} (Restored ${new Date(version.timestamp).toLocaleDateString()})`
        restoredProject.createdAt = new Date().toISOString()
        restoredProject.updatedAt = new Date().toISOString()
        
        // Add to projects
        const prevId = currentProjectId.value
        if (prevId) {
          removeProjectLock(prevId)
        }
        projects.value.push(restoredProject)
        currentProjectId.value = restoredProject.id
        applyProjectSettingsFromProject(restoredProject)
        clearHistory()
        syncProjectLockSession()
        persistToStorage()

        return restoredProject.id
      }
    } catch (error) {
      logger.error('version.restore.failed', error, {
        projectId: version?.projectId || null,
        versionId: version?.id || null,
        contextId: activeContextId.value,
      })
    }
    
    return null
  }

  function teardownAutoVersioning() {
    for (const cleanup of _autoVersioningCleanup) {
      try {
        cleanup()
      } catch (error) {
        logger.error('autoversion.teardown.failed', error, {
          contextId: activeContextId.value,
        })
      }
    }
    _autoVersioningCleanup = []
  }

  async function setupAutoVersioning() {
    teardownAutoVersioning()

    const adapter = getStorageAdapter()
    const raw = await adapter.getMeta('program-settings')
    if (!raw) return

    let programSettings
    try {
      programSettings = JSON.parse(raw)
    } catch {
      return
    }

    if (programSettings.autoVersioning?.includes('close')) {
      const handler = () => {
        if (currentProject.value) {
          saveVersion(null, 'auto-close')
        }
      }
      window.addEventListener('beforeunload', handler)
      _autoVersioningCleanup.push(() =>
        window.removeEventListener('beforeunload', handler),
      )
    }

    if (programSettings.autoVersioning?.includes('interval')) {
      const intervalMinutes = programSettings.versioningInterval || 10
      const timerId = setInterval(() => {
        if (currentProject.value) {
          saveVersion(null, 'auto-interval')
        }
      }, intervalMinutes * 60 * 1000)
      _autoVersioningCleanup.push(() => clearInterval(timerId))
    }
  }

  /**
   * Bring the context layer to a known state and pin the active
   * context id on the storage adapter. Runs the legacy → context
   * migration the first time, resolves which context should be
   * active, and refreshes the in-memory `contexts` registry. Idempotent
   * across reloads (the migration's gating registry prevents re-runs).
   */
  async function initContexts() {
    const startedAt = Date.now()
    logger.info('app.init.contexts.start')
    let migrationResult = null
    try {
      migrationResult = await runContextMigration()
    } catch (error) {
      logger.error('app.init.migration.failed', error)
    }
    if (migrationResult?.migrated) {
      logger.info('app.init.migration.success', {
        contextId: migrationResult.contextId,
      })
    }

    let activeId = null
    try {
      activeId = await resolveActiveContextId()
    } catch (error) {
      logger.error('app.init.activeContext.resolve.failed', error)
    }

    if (activeId) {
      setActiveContextId(activeId)
      activeContextId.value = activeId
      try {
        await setStoredActiveContextId(activeId)
      } catch (error) {
        logger.error('app.init.activeContext.persist.failed', error, {
          contextId: activeId,
        })
      }
    } else {
      setActiveContextId(null)
      activeContextId.value = null
    }

    try {
      contexts.value = await loadContextRegistry()
    } catch (error) {
      logger.error('app.init.contexts.load.failed', error)
      contexts.value = []
    }

    logger.info('app.init.contexts.success', {
      activeContextId: activeContextId.value,
      contextCount: contexts.value.length,
      durationMs: Date.now() - startedAt,
    })
  }

  /**
   * Hydrate everything that depends on the active context: media
   * backend selection, the data: URI media migration, project hydration,
   * the GC timer, and auto-versioning. Pulled into a function because
   * `switchContext` runs the same sequence after the active id changes.
   */
  async function hydrateActiveContext() {
    const startedAt = Date.now()
    logger.info('context.hydrate.start', {
      contextId: activeContextId.value,
    })
    // Capability-based selection: prefer OPFS when the browser supports
    // it, falling back to IndexedDB. Writes flow to whichever backend
    // is selected; reads layer-fall-through so existing IDB content
    // remains visible and migrates lazily into OPFS on first read.
    // Tests that have already stubbed the adapter via setMediaAdapter
    // can skip this safely (the stub remains, IDB path is a no-op).
    try {
      const initial = await selectMediaAdapter()
      mediaBackend.value = initial?.backend || 'idb'
      logger.info('media.backend.select.success', {
        backend: mediaBackend.value,
        contextId: activeContextId.value,
      })
    } catch (error) {
      logger.error('media.backend.select.failed', error, {
        contextId: activeContextId.value,
      })
    }

    // Migrate any pre-existing inline `data:` URIs in long-note HTML and
    // version snapshots into the content-addressable media store. The
    // operation is idempotent because IDs are content hashes, so it is
    // safe to run on every app load.
    try {
      await runMediaMigration()
    } catch (error) {
      logger.error('media.dataUriMigration.failed', error, {
        contextId: activeContextId.value,
      })
    }

    await refreshMediaUsage()
    startMediaGcTimer()

    await setupAutoVersioning()

    const raw = await getStorageAdapter().getMeta('program-settings')
    if (raw) {
      try {
        const programSettings = JSON.parse(raw)
        if (
          programSettings.autoVersioning?.includes('start') &&
          currentProject.value
        ) {
          await saveVersion(null, 'auto-start')
        }
      } catch (error) {
        logger.error('app.init.programSettings.parse.failed', error, {
          contextId: activeContextId.value,
        })
      }
    }

    logger.info('context.hydrate.success', {
      contextId: activeContextId.value,
      backend: mediaBackend.value,
      mediaCount: mediaUsage.value.count,
      durationMs: Date.now() - startedAt,
    })
  }

  const initPromise = (async () => {
    const initStartedAt = Date.now()
    logger.info('app.init.start')
    try {
      await initContexts()
      await loadFromStorage()
      registerProjectLockUnloadHandlers()
      await hydrateActiveContext()
      logger.info('app.init.success', {
        durationMs: Date.now() - initStartedAt,
        activeContextId: activeContextId.value,
        projectsLoaded: projects.value.length,
        backend: mediaBackend.value,
      })
    } catch (error) {
      logger.error('app.init.failed', error, {
        durationMs: Date.now() - initStartedAt,
      })
      throw error
    }
  })()

  return {
    projects,
    currentProjectId,
    currentProject,
    fontSize,
    fontScale,
    indentSize,
    defaultListType,
    showIndentGuides,
    showLongNotesInOutline,
    tibetanFontFamily,
    tibetanFontSize,
    tibetanFontColor,
    nonTibetanFontFamily,
    nonTibetanFontSize,
    nonTibetanFontColor,
    canUndo,
    canRedo,
    storeReady,
    initPromise,
    createProject,
    deleteProject,
    findOrphanedMediaForProjectRemoval,
    purgeRemoteMediaHashes,
    mediaBackendSupportsRemoteSync,
    getUnsyncedMediaForProject,
    getAllUnsyncedMedia,
    backfillMediaToRemote,
    getProjectMediaInventory,
    renameProject,
    selectProject,
    projectLockBlockedProjectId,
    clearProjectLockBlocked,
    isProjectLockHeldByOtherTab,
    addRootListItem,
    addRootListItemAfter,
    addRootDivider,
    updateListItem,
    addChildItem,
    applyMultiLinePasteAsSiblings,
    deleteListItem,
    addShortNote,
    addLongNote,
    deleteNote,
    updateNote,
    toggleNoteCollapse,
    moveItem,
    indentItem,
    outdentItem,
    toggleRootListType,
    toggleChildrenListType,
    findNextSibling,
    findNextSiblingNoWrap,
    exitEditAndFocusNextSibling,
    scrollToItemIfNeeded,
    setEditingItem,
    navigateToNextSibling,
    navigateToNextItem,
    currentlyEditingId,
    longNoteEditorActive,
    setLongNoteEditorActive,
    storageSaveError,
    storageUsageWarning,
    storageUsageRatio,
    mediaUsage,
    mediaBackend,
    mediaRemoteListError,
    refreshMediaUsage,
    triggerMediaGc,
    reselectMediaBackend,
    stopMediaGcTimer,
    exportAsMarkdown: exportProjectAsMarkdown,
    exportAsDocx: exportProjectAsDocx,
    exportAsJSON: exportProjectAsJSON,
    exportAllAsJSON,
    importFromJSONFile,
    collapseExpandAllItems,
    collapseExpandAllLongNotes,
    allLongNotesVisible,
    showHideAllLongNotes,
    setFontSize,
    setFontScale,
    setIndentSize,
    setDefaultListType,
    setShowIndentGuides,
    setShowLongNotesInOutline,
    setTibetanFontFamily,
    setTibetanFontSize,
    setTibetanFontColor,
    setNonTibetanFontFamily,
    setNonTibetanFontSize,
    setNonTibetanFontColor,
    setLongNoteColorRoot,
    pushLongNoteRecentCustomColor,
    setLongNoteBackground,
    setLongNoteBgOpacity,
    undo,
    redo,
    clearHistory,
    saveVersion,
    restoreVersion,
    contexts,
    activeContextId,
    switchingContext,
    refreshContextRegistry,
    switchContext,
    createNewContext,
    renameContextById,
    deleteContextById,
  }
})
