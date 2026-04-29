// JSON Export/Import for Scaffold
// Preserves complete project structure and metadata

/**
 * JSON Schema Design:
 * {
 *   "formatVersion": "1.0",
 *   "exportedAt": "2024-08-24T10:30:00.000Z",
 *   "application": "Scaffold",
 *   "projects": [
 *     {
 *       "id": "project123",
 *       "name": "My Project",
 *       "createdAt": "2024-08-24T10:00:00.000Z",
 *       "updatedAt": "2024-08-24T10:30:00.000Z",
 *       "rootListType": "ordered",
 *       "settings": {
 *         "fontSize": 14,
 *         "indentSize": 32,
 *         "defaultListType": "ordered",
 *         "showIndentGuides": true,
 *         "showLongNotesInOutline": true
 *       },
 *       "items": [...]
 *     }
 *   ],
 *   // Optional: only present when the user opted into "include version history".
 *   // Keyed by the exported project's id (the same id present in `projects[].id`).
 *   "projectVersions": {
 *     "project123": [
 *       {
 *         "id": "v_abc",
 *         "projectId": "project123",
 *         "name": "Manual save",
 *         "timestamp": 1724500200000,
 *         "trigger": "manual",
 *         "stats": { "items": 12, "notes": 3 },
 *         "data": { ...embedded scaffold export envelope for the snapshot... }
 *       }
 *     ]
 *   },
 *   // Optional: present only when the export contains long-note media
 *   // (uploaded images / audio). Long-note HTML stores
 *   // `scaffold-media://<hash>` references; the actual bytes live here.
 *   // Keyed by SHA-256 hex of the raw bytes, so duplicate media used
 *   // across projects, notes, or versions is stored exactly once.
 *   "media": {
 *     "<sha256-hex>": { "mime": "image/png", "size": 12345, "base64": "..." }
 *   }
 * }
 */

import { collectProjectRefHashes } from '../media/references.js'
import { blobToBase64, base64ToBlob } from '../media/ingest.js'
import { getMediaAdapter } from '../media/index.js'
import { isValidSha256Hex } from '../media/hash.js'
import {
  DEFAULT_LONG_NOTE_BG_OPACITY,
  DEFAULT_LONG_NOTE_COLOR_ROOT,
  MAX_RECENT_CUSTOM_COLORS,
  clampOpacity,
  normalizeHexColor,
} from '../color/long-note-palette.js'

/**
 * @typedef {Object} ExportOptions
 * @property {Object<string, object[]>} [versionsByProjectId] Map of project id to its array
 *   of version snapshot objects. Only included projects (matching `selectedProjectId` or all)
 *   are serialized; entries for other ids are silently dropped.
 */

export function exportAsJSON(projects, selectedProjectId = null, options = {}) {
  const exportData = {
    formatVersion: "1.0",
    exportedAt: new Date().toISOString(),
    application: "Scaffold",
    projects: []
  }

  // Filter projects - export selected project only or all projects
  const projectsToExport = selectedProjectId 
    ? projects.filter(p => p.id === selectedProjectId)
    : projects

  // Process each project
  exportData.projects = projectsToExport.map(project => ({
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    rootListType: project.rootListType || 'ordered',
    settings: {
      fontSize: project.settings?.fontSize || 14,
      indentSize: project.settings?.indentSize || 32,
      defaultListType: project.settings?.defaultListType || 'ordered',
      showIndentGuides: project.settings?.showIndentGuides !== false,
      showLongNotesInOutline: project.settings?.showLongNotesInOutline !== false,
      tibetanFontFamily: project.settings?.tibetanFontFamily || 'Microsoft Himalaya',
      tibetanFontSize: project.settings?.tibetanFontSize || 20,
      tibetanFontColor: project.settings?.tibetanFontColor || '#000000',
      nonTibetanFontFamily: project.settings?.nonTibetanFontFamily || 'Aptos, sans-serif',
      nonTibetanFontSize: project.settings?.nonTibetanFontSize || 16,
      nonTibetanFontColor: project.settings?.nonTibetanFontColor || '#000000',
      longNoteColorRoot:
        normalizeHexColor(project.settings?.longNoteColorRoot) ||
        DEFAULT_LONG_NOTE_COLOR_ROOT,
      longNoteRecentCustomColors: Array.isArray(
        project.settings?.longNoteRecentCustomColors,
      )
        ? project.settings.longNoteRecentCustomColors
            .map(normalizeHexColor)
            .filter(Boolean)
            .slice(0, MAX_RECENT_CUSTOM_COLORS)
        : [],
      longNoteBgOpacity: clampOpacity(project.settings?.longNoteBgOpacity),
    },
    items: processItems(project.lists || [])
  }))

  const versionsByProjectId = options?.versionsByProjectId
  if (versionsByProjectId && typeof versionsByProjectId === 'object') {
    const includedIds = new Set(exportData.projects.map((p) => p.id))
    const filtered = {}
    for (const [projectId, versions] of Object.entries(versionsByProjectId)) {
      if (!includedIds.has(projectId)) continue
      if (!Array.isArray(versions) || versions.length === 0) continue
      filtered[projectId] = versions.map((v) => sanitizeVersionForExport(v, projectId))
    }
    if (Object.keys(filtered).length > 0) {
      exportData.projectVersions = filtered
    }
  }

  return exportData
}

/**
 * Pre-import: read legacy per-note `collapsedBgOpacity` from raw
 * export items so the value can be hoisted into
 * `project.settings.longNoteBgOpacity` before `normalizeImportedItems`
 * strips those fields.
 */
function collectLegacyLongNoteBgOpacityFromItems(items) {
  let found = null
  function walk(arr) {
    for (const item of arr || []) {
      for (const note of item.longNotes || []) {
        if (
          note.collapsedBgOpacity != null &&
          normalizeHexColor(note.collapsedBgColor)
        ) {
          if (found === null) found = clampOpacity(note.collapsedBgOpacity)
        }
      }
      if (item.children?.length) walk(item.children)
    }
  }
  walk(items)
  return found
}

function sanitizeVersionForExport(version, projectId) {
  // Defensive copy so writes elsewhere don't mutate stored versions.
  return {
    id: version?.id || null,
    projectId: version?.projectId || projectId,
    name: version?.name ?? null,
    timestamp: typeof version?.timestamp === 'number' ? version.timestamp : null,
    trigger: version?.trigger || null,
    stats: version?.stats
      ? {
          items: Number.isFinite(version.stats.items) ? version.stats.items : 0,
          notes: Number.isFinite(version.stats.notes) ? version.stats.notes : 0,
        }
      : { items: 0, notes: 0 },
    data: version?.data ?? null,
  }
}

function processItems(items) {
  return items.map(item => {
    const kind = item.kind || 'item'
    const processedItem = {
      id: item.id,
      kind,
      text: kind === 'divider' ? '' : (item.text || ''),
      collapsed: kind === 'divider' ? false : (item.collapsed || false),
      childrenType: item.childrenType || 'ordered'
    }

    if (kind === 'divider') {
      return processedItem
    }

    // Add short notes if they exist
    if (item.shortNotes && item.shortNotes.length > 0) {
      processedItem.shortNotes = item.shortNotes.map(note => ({
        id: note.id,
        text: note.text
      }))
    }

    // Add long notes if they exist
    if (item.longNotes && item.longNotes.length > 0) {
      processedItem.longNotes = item.longNotes.map(note => {
        const exported = {
          id: note.id,
          text: note.text,
          collapsed: note.collapsed || false,
        }
        const bg = normalizeHexColor(note.collapsedBgColor)
        if (bg) exported.collapsedBgColor = bg
        return exported
      })
    }

    // Recursively process children
    if (item.children && item.children.length > 0) {
      processedItem.children = processItems(item.children)
    }

    return processedItem
  })
}

function normalizeImportedItems(items = [], parentId = null) {
  return items.map((item) => {
    const kind = item.kind || 'item'
    const normalized = {
      id: item.id,
      kind,
      parentId,
      text: kind === 'divider' ? '' : (item.text || ''),
      collapsed: kind === 'divider' ? false : !!item.collapsed,
      childrenType: item.childrenType || 'ordered',
      shortNotes: [],
      longNotes: [],
      children: [],
    }

    if (kind === 'divider') {
      return normalized
    }

    normalized.shortNotes = Array.isArray(item.shortNotes) ? item.shortNotes : []
    normalized.longNotes = Array.isArray(item.longNotes)
      ? item.longNotes.map((note) => {
          const importedNote = { ...note }
          delete importedNote.collapsedBgOpacity
          const bg = normalizeHexColor(importedNote.collapsedBgColor)
          if (bg) {
            importedNote.collapsedBgColor = bg
          } else {
            delete importedNote.collapsedBgColor
          }
          return importedNote
        })
      : []
    normalized.children = Array.isArray(item.children)
      ? normalizeImportedItems(item.children, item.id)
      : []
    return normalized
  })
}

// Download a JSON payload. Uses the File System Access API's
// `showSaveFilePicker` when available so users see a true Save dialog
// and choose where the file lands; falls back to the classic
// anchor-click download otherwise. Returns a promise so callers can
// chain UX (notifications, etc.).
export async function downloadJSON(data, filename = 'outline') {
  const jsonString = JSON.stringify(data, null, 2)
  const safeName = `${filename.replace(/[^a-z0-9]/gi, '_')}.json`
  const blob = new Blob([jsonString], { type: 'application/json' })

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: 'Scaffold JSON export',
            accept: { 'application/json': ['.json'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (error) {
      // User cancelled — bail silently. Any other error falls through
      // to the anchor-click fallback below.
      if (error?.name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function getFilenameTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day}_${hours}:${minutes}:${seconds}`
}

export function validateImportData(data) {
  const errors = []

  // Check required top-level fields
  if (!data.formatVersion) {
    errors.push('Missing formatVersion')
  }
  
  if (!data.application || data.application !== 'Scaffold') {
    errors.push('Invalid or missing application identifier')
  }

  if (!Array.isArray(data.projects)) {
    errors.push('Projects must be an array')
    return { valid: false, errors }
  }

  // Validate each project
  data.projects.forEach((project, index) => {
    const prefix = `Project ${index + 1}: `
    
    if (!project.id) errors.push(prefix + 'Missing project ID')
    if (!project.name) errors.push(prefix + 'Missing project name')
    if (!project.createdAt) errors.push(prefix + 'Missing createdAt timestamp')
    if (!project.updatedAt) errors.push(prefix + 'Missing updatedAt timestamp')
    
    if (project.items && !Array.isArray(project.items)) {
      errors.push(prefix + 'Items must be an array')
    }

    // Validate project settings
    if (project.settings) {
      const s = project.settings
      if (s.fontSize && (typeof s.fontSize !== 'number' || s.fontSize < 10 || s.fontSize > 50)) {
        errors.push(prefix + 'Invalid fontSize setting')
      }
      if (s.indentSize && (typeof s.indentSize !== 'number' || s.indentSize < 5 || s.indentSize > 100)) {
        errors.push(prefix + 'Invalid indentSize setting')
      }
      if (
        s.tibetanFontSize &&
        (typeof s.tibetanFontSize !== 'number' || s.tibetanFontSize < 8 || s.tibetanFontSize > 100)
      ) {
        errors.push(prefix + 'Invalid tibetanFontSize setting')
      }
      if (
        s.nonTibetanFontSize &&
        (typeof s.nonTibetanFontSize !== 'number' ||
          s.nonTibetanFontSize < 8 ||
          s.nonTibetanFontSize > 100)
      ) {
        errors.push(prefix + 'Invalid nonTibetanFontSize setting')
      }
      if (s.tibetanFontColor && typeof s.tibetanFontColor !== 'string') {
        errors.push(prefix + 'Invalid tibetanFontColor setting')
      }
      if (s.nonTibetanFontColor && typeof s.nonTibetanFontColor !== 'string') {
        errors.push(prefix + 'Invalid nonTibetanFontColor setting')
      }
    }
  })

  // Validate optional projectVersions structure - structural problems become errors,
  // per-entry malformations are deferred to importFromJSON (warnings + skip).
  if (data.projectVersions !== undefined && data.projectVersions !== null) {
    if (typeof data.projectVersions !== 'object' || Array.isArray(data.projectVersions)) {
      errors.push('projectVersions must be an object keyed by project id')
    } else {
      for (const [projectId, versions] of Object.entries(data.projectVersions)) {
        if (!Array.isArray(versions)) {
          errors.push(`projectVersions[${projectId}] must be an array`)
        }
      }
    }
  }

  // Validate optional media map structure (object keyed by sha256 hash)
  if (data.media !== undefined && data.media !== null) {
    if (typeof data.media !== 'object' || Array.isArray(data.media)) {
      errors.push('media must be an object keyed by sha256 hash')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: generateWarnings(data)
  }
}

function generateWarnings(data) {
  const warnings = []
  
  // Version compatibility warnings
  if (data.formatVersion !== '1.0') {
    warnings.push(`Format version ${data.formatVersion} may not be fully supported`)
  }

  // Check for very old exports
  if (data.exportedAt) {
    const exportDate = new Date(data.exportedAt)
    const monthsAgo = (Date.now() - exportDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    if (monthsAgo > 6) {
      warnings.push('This export is more than 6 months old and may have compatibility issues')
    }
  }

  return warnings
}

export async function importFromJSON(jsonData) {
  const validation = validateImportData(jsonData)

  if (!validation.valid) {
    throw new Error(`Import validation failed: ${validation.errors.join(', ')}`)
  }

  const warnings = [...validation.warnings]
  const projectVersions = {}

  // Hydrate referenced media bytes into the local media store *before* the
  // projects/versions are returned, so resolution at render time finds them.
  // No-op when the import contains no `media` field (legacy backups).
  const mediaSummary = await ingestMediaPayload(jsonData)
  warnings.push(...mediaSummary.warnings)

  if (jsonData.projectVersions && typeof jsonData.projectVersions === 'object') {
    for (const [projectId, versions] of Object.entries(jsonData.projectVersions)) {
      if (!Array.isArray(versions)) continue
      const cleaned = []
      versions.forEach((version, idx) => {
        const issue = describeVersionImportIssue(version)
        if (issue) {
          warnings.push(`Skipped version ${idx + 1} for project ${projectId}: ${issue}`)
          return
        }
        cleaned.push({
          id: version.id,
          projectId: version.projectId || projectId,
          name: version.name ?? null,
          timestamp: version.timestamp,
          trigger: version.trigger || null,
          stats: version.stats
            ? {
                items: Number.isFinite(version.stats.items) ? version.stats.items : 0,
                notes: Number.isFinite(version.stats.notes) ? version.stats.notes : 0,
              }
            : { items: 0, notes: 0 },
          data: version.data,
        })
      })
      if (cleaned.length > 0) {
        projectVersions[projectId] = cleaned
      }
    }
  }

  // Process and return importable project data
  return {
    projects: jsonData.projects.map((project) => {
      const legacyLongNoteBgOpacity = collectLegacyLongNoteBgOpacityFromItems(
        project.items || [],
      )
      const merged = {
        ...project,
        // Ensure all required fields have defaults
        rootListType: project.rootListType || 'ordered',
        settings: {
          fontSize: 14,
          indentSize: 32,
          defaultListType: 'ordered',
          showIndentGuides: true,
          showLongNotesInOutline: true,
          tibetanFontFamily: 'Microsoft Himalaya',
          tibetanFontSize: 20,
          tibetanFontColor: '#000000',
          nonTibetanFontFamily: 'Aptos, sans-serif',
          nonTibetanFontSize: 16,
          nonTibetanFontColor: '#000000',
          longNoteColorRoot: DEFAULT_LONG_NOTE_COLOR_ROOT,
          longNoteRecentCustomColors: [],
          ...project.settings,
        },
        lists: normalizeImportedItems(project.items || []),
      }

      const fromSettings = project.settings?.longNoteBgOpacity
      let opacity =
        fromSettings === undefined || fromSettings === null
          ? legacyLongNoteBgOpacity ?? DEFAULT_LONG_NOTE_BG_OPACITY
          : fromSettings
      merged.settings.longNoteBgOpacity = clampOpacity(opacity)

      merged.settings.longNoteColorRoot =
        normalizeHexColor(merged.settings.longNoteColorRoot) ||
        DEFAULT_LONG_NOTE_COLOR_ROOT
      merged.settings.longNoteRecentCustomColors = Array.isArray(
        merged.settings.longNoteRecentCustomColors,
      )
        ? merged.settings.longNoteRecentCustomColors
            .map(normalizeHexColor)
            .filter(Boolean)
            .slice(0, MAX_RECENT_CUSTOM_COLORS)
        : []
      return merged
    }),
    projectVersions,
    importedMediaCount: mediaSummary.imported,
    warnings,
  }
}

function describeVersionImportIssue(version) {
  if (!version || typeof version !== 'object') return 'not an object'
  if (!version.id) return 'missing version id'
  if (typeof version.timestamp !== 'number') return 'missing or invalid timestamp'
  if (!version.data || typeof version.data !== 'object') return 'missing data payload'
  if (!Array.isArray(version.data.projects) || version.data.projects.length === 0) {
    return 'data payload has no projects'
  }
  return null
}

/**
 * Walk an export envelope and gather every `scaffold-media://<hash>` referenced
 * either by the projects themselves or by any embedded version snapshot's
 * project payloads. Used to figure out which media bytes to attach.
 *
 * @param {object} exportData
 * @returns {Set<string>}
 */
export function collectExportRefHashes(exportData) {
  const set = new Set()
  for (const hash of collectProjectRefHashes(exportData?.projects || [])) {
    set.add(hash)
  }
  if (exportData?.projectVersions && typeof exportData.projectVersions === 'object') {
    for (const versions of Object.values(exportData.projectVersions)) {
      if (!Array.isArray(versions)) continue
      for (const version of versions) {
        const projects = version?.data?.projects || []
        for (const hash of collectProjectRefHashes(projects)) {
          set.add(hash)
        }
      }
    }
  }
  return set
}

/**
 * Attach a `media` map to an export envelope, populated from the local media
 * adapter. Idempotent and safe to call when no refs are present (no-op).
 *
 * @param {object} exportData
 * @param {() => import('../media/adapter.js').MediaStorageAdapter} [adapterAccessor]
 * @returns {Promise<object>} the same exportData mutated in place
 */
export async function attachMediaPayload(exportData, adapterAccessor = getMediaAdapter) {
  const refs = collectExportRefHashes(exportData)
  if (refs.size === 0) return exportData

  const adapter = adapterAccessor()
  const media = {}
  for (const hash of refs) {
    if (!isValidSha256Hex(hash)) continue
    const row = await adapter.get(hash)
    if (!row || !row.blob) continue
    media[hash] = {
      mime: row.mime || row.blob.type || 'application/octet-stream',
      size: typeof row.size === 'number' ? row.size : row.blob.size || 0,
      base64: await blobToBase64(row.blob),
    }
  }
  if (Object.keys(media).length > 0) {
    exportData.media = media
  }
  return exportData
}

/**
 * Hydrate the local media adapter with bytes carried inside an import
 * envelope's `media` map. Idempotent (content-addressable IDs make
 * duplicate puts no-ops).
 *
 * @param {object} jsonData
 * @param {() => import('../media/adapter.js').MediaStorageAdapter} [adapterAccessor]
 * @returns {Promise<{imported: number, skipped: number, warnings: string[]}>}
 */
export async function ingestMediaPayload(jsonData, adapterAccessor = getMediaAdapter) {
  const summary = { imported: 0, skipped: 0, warnings: [] }
  const map = jsonData?.media
  if (!map || typeof map !== 'object' || Array.isArray(map)) return summary

  const adapter = adapterAccessor()
  for (const [hash, entry] of Object.entries(map)) {
    if (!isValidSha256Hex(hash)) {
      summary.skipped += 1
      summary.warnings.push(`Skipped media entry with invalid hash: ${String(hash).slice(0, 16)}`)
      continue
    }
    if (!entry || typeof entry.base64 !== 'string') {
      summary.skipped += 1
      summary.warnings.push(`Skipped media entry ${hash.slice(0, 8)}: missing base64 payload`)
      continue
    }
    try {
      const blob = base64ToBlob(entry.base64, entry.mime || 'application/octet-stream')
      await adapter.put(hash, blob, entry.mime || blob.type)
      summary.imported += 1
    } catch (error) {
      summary.skipped += 1
      summary.warnings.push(
        `Failed to ingest media ${hash.slice(0, 8)}: ${error?.message || error}`,
      )
    }
  }
  return summary
}

// Utility function to export single project
export async function exportSingleProjectAsJSON(project, options = {}) {
  if (!project) return null

  const exportData = exportAsJSON([project], project.id, options)
  await attachMediaPayload(exportData)
  const filename = `${project.name}_outline_${getFilenameTimestamp()}`

  await downloadJSON(exportData, filename)
}

// Utility function to export all projects
export async function exportAllProjectsAsJSON(projects, options = {}) {
  if (!projects || projects.length === 0) return null

  const exportData = exportAsJSON(projects, null, options)
  await attachMediaPayload(exportData)
  const filename = `outline_maker_backup_${getFilenameTimestamp()}`

  await downloadJSON(exportData, filename)
}