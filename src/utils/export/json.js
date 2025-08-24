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
 *   ]
 * }
 */

export function exportAsJSON(projects, selectedProjectId = null) {
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
      showIndentGuides: project.settings?.showIndentGuides !== false
    },
    items: processItems(project.lists || [])
  }))

  return exportData
}

function processItems(items) {
  return items.map(item => {
    const processedItem = {
      id: item.id,
      text: item.text || '',
      collapsed: item.collapsed || false,
      childrenType: item.childrenType || 'ordered'
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
    }
  })

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
        ...project.settings
      },
      lists: project.items || []
    })),
    warnings: validation.warnings
  }
}

// Utility function to export single project
export function exportSingleProjectAsJSON(project) {
  if (!project) return null
  
  const exportData = exportAsJSON([project], project.id)
  const filename = `${project.name}_outline`
  
  downloadJSON(exportData, filename)
}

// Utility function to export all projects
export function exportAllProjectsAsJSON(projects) {
  if (!projects || projects.length === 0) return null
  
  const exportData = exportAsJSON(projects)
  const timestamp = new Date().toISOString().split('T')[0]
  const filename = `outline_maker_backup_${timestamp}`
  
  downloadJSON(exportData, filename)
}