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
 *         "showIndentGuides": true
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
 *   }
 * }
 */

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
      tibetanFontFamily: project.settings?.tibetanFontFamily || 'Microsoft Himalaya',
      tibetanFontSize: project.settings?.tibetanFontSize || 20,
      tibetanFontColor: project.settings?.tibetanFontColor || '#000000',
      nonTibetanFontFamily: project.settings?.nonTibetanFontFamily || 'Aptos, sans-serif',
      nonTibetanFontSize: project.settings?.nonTibetanFontSize || 16,
      nonTibetanFontColor: project.settings?.nonTibetanFontColor || '#000000',
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
      processedItem.longNotes = item.longNotes.map(note => ({
        id: note.id,
        text: note.text,
        collapsed: note.collapsed || false
      }))
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
    normalized.longNotes = Array.isArray(item.longNotes) ? item.longNotes : []
    normalized.children = Array.isArray(item.children)
      ? normalizeImportedItems(item.children, item.id)
      : []
    return normalized
  })
}

export function downloadJSON(data, filename = 'outline') {
  const jsonString = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename.replace(/[^a-z0-9]/gi, '_')}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function getFilenameTimestamp(date = new Date()) {
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

export function importFromJSON(jsonData) {
  const validation = validateImportData(jsonData)
  
  if (!validation.valid) {
    throw new Error(`Import validation failed: ${validation.errors.join(', ')}`)
  }

  const warnings = [...validation.warnings]
  const projectVersions = {}

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
    projects: jsonData.projects.map(project => ({
      ...project,
      // Ensure all required fields have defaults
      rootListType: project.rootListType || 'ordered',
      settings: {
        fontSize: 14,
        indentSize: 32,
        defaultListType: 'ordered',
        showIndentGuides: true,
        tibetanFontFamily: 'Microsoft Himalaya',
        tibetanFontSize: 20,
        tibetanFontColor: '#000000',
        nonTibetanFontFamily: 'Aptos, sans-serif',
        nonTibetanFontSize: 16,
        nonTibetanFontColor: '#000000',
        ...project.settings
      },
      lists: normalizeImportedItems(project.items || [])
    })),
    projectVersions,
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

// Utility function to export single project
export function exportSingleProjectAsJSON(project, options = {}) {
  if (!project) return null

  const exportData = exportAsJSON([project], project.id, options)
  const filename = `${project.name}_outline_${getFilenameTimestamp()}`

  downloadJSON(exportData, filename)
}

// Utility function to export all projects
export function exportAllProjectsAsJSON(projects, options = {}) {
  if (!projects || projects.length === 0) return null

  const exportData = exportAsJSON(projects, null, options)
  const filename = `outline_maker_backup_${getFilenameTimestamp()}`

  downloadJSON(exportData, filename)
}