import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import { exportAsMarkdown } from 'src/utils/export/markdown.js'
import { exportAsDocx } from 'src/utils/export/docx.js'
import { 
  exportAsJSON,
  exportSingleProjectAsJSON, 
  exportAllProjectsAsJSON,
  importFromJSON 
} from 'src/utils/export/json.js'

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
      saveToLocalStorage()
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
      saveToLocalStorage()
    } else {
      redoStack.value.push(nextState)
    }
  }

  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
  }

  function createProject(name) {
    // Load program-wide settings for defaults
    const programSettings = JSON.parse(localStorage.getItem('scaffold-program-settings') || '{}')
    
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
        tibetanFontFamily: programSettings.defaultTibetanFontFamily || tibetanFontFamily.value,
        tibetanFontSize: programSettings.defaultTibetanFontSize || tibetanFontSize.value,
        tibetanFontColor: programSettings.defaultTibetanFontColor || tibetanFontColor.value,
        nonTibetanFontFamily:
          programSettings.defaultNonTibetanFontFamily || nonTibetanFontFamily.value,
        nonTibetanFontSize: programSettings.defaultNonTibetanFontSize || nonTibetanFontSize.value,
        nonTibetanFontColor:
          programSettings.defaultNonTibetanFontColor || nonTibetanFontColor.value,
      },
    }
    projects.value.push(project)
    saveToLocalStorage()
    return project
  }

  function deleteProject(projectId) {
    const index = projects.value.findIndex((p) => p.id === projectId)
    if (index !== -1) {
      projects.value.splice(index, 1)
      if (currentProjectId.value === projectId) {
        currentProjectId.value = projects.value[0]?.id || null
      }
      saveToLocalStorage()
    }
  }

  function renameProject(projectId, newName) {
    const project = projects.value.find((p) => p.id === projectId)
    if (project) {
      project.name = newName
      project.updatedAt = new Date().toISOString()
      saveToLocalStorage()
    }
  }

  function selectProject(projectId) {
    currentProjectId.value = projectId
    clearHistory()

    // Restore project-specific settings
    const project = projects.value.find((p) => p.id === projectId)
    if (project && project.settings) {
      fontSize.value = project.settings.nonTibetanFontSize || project.settings.fontSize || 16
      indentSize.value = project.settings.indentSize
      defaultListType.value = project.settings.defaultListType
      showIndentGuides.value = project.settings.showIndentGuides
      tibetanFontFamily.value = project.settings.tibetanFontFamily || 'Microsoft Himalaya'
      tibetanFontSize.value = project.settings.tibetanFontSize || 20
      tibetanFontColor.value = project.settings.tibetanFontColor || '#000000'
      nonTibetanFontFamily.value = project.settings.nonTibetanFontFamily || 'Aptos, sans-serif'
      nonTibetanFontSize.value = project.settings.nonTibetanFontSize || 16
      nonTibetanFontColor.value = project.settings.nonTibetanFontColor || '#000000'
    }

    saveToLocalStorage()
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
    const newItem = createListItem('New Item')
    currentProject.value.lists.push(newItem)
    currentProject.value.updatedAt = new Date().toISOString()
    saveToLocalStorage()
    return newItem
  }

  function addRootListItemAfter(referenceId = null) {
    if (!currentProject.value) return

    saveState('Add root item')
    const newItem = createListItem('New Item')

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
    saveToLocalStorage()
    return newItem
  }

  function addRootDivider() {
    if (!currentProject.value) return

    saveState('Add root divider')
    const divider = createDividerItem()
    currentProject.value.lists.push(divider)
    currentProject.value.updatedAt = new Date().toISOString()
    saveToLocalStorage()
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
      saveToLocalStorage()
    }
  }

  function addChildItem(parentId) {
    if (!currentProject.value) return

    const parent = findItemById(currentProject.value.lists, parentId)
    if (parent) {
      if (isDividerItem(parent)) return
      saveState('Add child item')
      const newItem = createListItem('New Item', parentId)
      parent.children.push(newItem)
      parent.collapsed = false
      currentProject.value.updatedAt = new Date().toISOString()
      saveToLocalStorage()
      return newItem
    }
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
      saveToLocalStorage()
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
      saveToLocalStorage()
    }
  }

  function addLongNote(itemId, text) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      const noteId = generateId()
      item.longNotes.push({
        id: noteId,
        text,
        collapsed: false,
        createdAt: new Date().toISOString(),
      })
      currentProject.value.updatedAt = new Date().toISOString()
      saveToLocalStorage()
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
        saveToLocalStorage()
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
        saveToLocalStorage()
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
        saveToLocalStorage()
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
      saveToLocalStorage()
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
      saveToLocalStorage()
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
      saveToLocalStorage()
    }
  }

  function toggleRootListType() {
    if (!currentProject.value) return

    saveState('Toggle root list type')
    currentProject.value.rootListType =
      currentProject.value.rootListType === 'ordered' ? 'unordered' : 'ordered'
    currentProject.value.updatedAt = new Date().toISOString()
    saveToLocalStorage()
  }

  function toggleChildrenListType(itemId) {
    if (!currentProject.value) return

    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      if (isDividerItem(item)) return
      saveState('Toggle children list type')
      item.childrenType = item.childrenType === 'ordered' ? 'unordered' : 'ordered'
      currentProject.value.updatedAt = new Date().toISOString()
      saveToLocalStorage()
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
    saveToLocalStorage()
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
    saveToLocalStorage()
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
    saveToLocalStorage()
  }

  function exportProjectAsJSON() {
    if (!currentProject.value) return
    exportSingleProjectAsJSON(currentProject.value)
  }

  function exportAllAsJSON() {
    exportAllProjectsAsJSON(projects.value)
  }

  async function importFromJSONFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async (event) => {
        const file = event.target.files[0]
        if (!file) {
          reject(new Error('No file selected'))
          return
        }

        try {
          const text = await file.text()
          const jsonData = JSON.parse(text)
          const importResult = importFromJSON(jsonData)
          
          // Merge imported projects with existing ones
          importResult.projects.forEach(importedProject => {
            // Generate new ID if project already exists
            const existingProject = projects.value.find(p => p.id === importedProject.id)
            if (existingProject) {
              importedProject.id = generateId()
              importedProject.name = `${importedProject.name} (Imported)`
            }
            
            // Ensure createdAt and updatedAt are set
            if (!importedProject.createdAt) {
              importedProject.createdAt = new Date().toISOString()
            }
            if (!importedProject.updatedAt) {
              importedProject.updatedAt = new Date().toISOString()
            }
            
            projects.value.push(importedProject)
          })
          
          saveToLocalStorage()
          resolve({
            success: true,
            imported: importResult.projects.length,
            warnings: importResult.warnings
          })
        } catch (error) {
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
    saveToLocalStorage()
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
    saveToLocalStorage()
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
    saveToLocalStorage()
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
    saveToLocalStorage()
  }

  function setTibetanFontFamily(value) {
    tibetanFontFamily.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontFamily = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    saveToLocalStorage()
  }

  function setTibetanFontSize(value) {
    tibetanFontSize.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontSize = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    saveToLocalStorage()
  }

  function setTibetanFontColor(value) {
    tibetanFontColor.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.tibetanFontColor = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    saveToLocalStorage()
  }

  function setNonTibetanFontFamily(value) {
    nonTibetanFontFamily.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.nonTibetanFontFamily = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    saveToLocalStorage()
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
    saveToLocalStorage()
  }

  function setNonTibetanFontColor(value) {
    nonTibetanFontColor.value = value
    if (currentProject.value) {
      if (!currentProject.value.settings) currentProject.value.settings = {}
      currentProject.value.settings.nonTibetanFontColor = value
      currentProject.value.updatedAt = new Date().toISOString()
    }
    saveToLocalStorage()
  }

  function saveToLocalStorage() {
    localStorage.setItem('outline-projects', JSON.stringify(projects.value))
    localStorage.setItem('outline-current-project', currentProjectId.value || '')
    localStorage.setItem('outline-font-size', fontSize.value.toString())
    localStorage.setItem('outline-font-scale', fontScale.value.toString())
    localStorage.setItem('outline-indent-size', indentSize.value.toString())
    localStorage.setItem('outline-default-list-type', defaultListType.value)
    localStorage.setItem('outline-show-indent-guides', showIndentGuides.value.toString())
    localStorage.setItem('outline-tibetan-font-family', tibetanFontFamily.value)
    localStorage.setItem('outline-tibetan-font-size', tibetanFontSize.value.toString())
    localStorage.setItem('outline-tibetan-font-color', tibetanFontColor.value)
    localStorage.setItem('outline-non-tibetan-font-family', nonTibetanFontFamily.value)
    localStorage.setItem('outline-non-tibetan-font-size', nonTibetanFontSize.value.toString())
    localStorage.setItem('outline-non-tibetan-font-color', nonTibetanFontColor.value)
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
        tibetanFontFamily: tibetanFontFamily.value,
        tibetanFontSize: tibetanFontSize.value,
        tibetanFontColor: tibetanFontColor.value,
        nonTibetanFontFamily: nonTibetanFontFamily.value,
        nonTibetanFontSize: nonTibetanFontSize.value,
        nonTibetanFontColor: nonTibetanFontColor.value,
      },
    }
    projects.value.push(project)
    saveToLocalStorage()
    return project
  }

  function loadFromLocalStorage() {
    const savedProjects = localStorage.getItem('outline-projects')
    const savedCurrentId = localStorage.getItem('outline-current-project')
    const savedFontSize = localStorage.getItem('outline-font-size')
    const savedFontScale = localStorage.getItem('outline-font-scale')
    const savedIndentSize = localStorage.getItem('outline-indent-size')
    const savedDefaultListType = localStorage.getItem('outline-default-list-type')
    const savedShowIndentGuides = localStorage.getItem('outline-show-indent-guides')
    const savedTibetanFontFamily = localStorage.getItem('outline-tibetan-font-family')
    const savedTibetanFontSize = localStorage.getItem('outline-tibetan-font-size')
    const savedTibetanFontColor = localStorage.getItem('outline-tibetan-font-color')
    const savedNonTibetanFontFamily = localStorage.getItem('outline-non-tibetan-font-family')
    const savedNonTibetanFontSize = localStorage.getItem('outline-non-tibetan-font-size')
    const savedNonTibetanFontColor = localStorage.getItem('outline-non-tibetan-font-color')

    if (savedFontSize) {
      fontSize.value = parseInt(savedFontSize, 10)
    }
    if (savedFontScale) {
      fontScale.value = parseInt(savedFontScale, 10)
    }

    if (savedIndentSize) {
      indentSize.value = parseInt(savedIndentSize, 10)
    }

    if (savedDefaultListType) {
      defaultListType.value = savedDefaultListType
    }

    if (savedShowIndentGuides !== null) {
      showIndentGuides.value = savedShowIndentGuides === 'true'
    }

    if (savedTibetanFontFamily) {
      tibetanFontFamily.value = savedTibetanFontFamily
    }
    if (savedTibetanFontSize) {
      tibetanFontSize.value = parseInt(savedTibetanFontSize, 10)
    }
    if (savedTibetanFontColor) {
      tibetanFontColor.value = savedTibetanFontColor
    }
    if (savedNonTibetanFontFamily) {
      nonTibetanFontFamily.value = savedNonTibetanFontFamily
    }
    if (savedNonTibetanFontSize) {
      nonTibetanFontSize.value = parseInt(savedNonTibetanFontSize, 10)
      fontSize.value = nonTibetanFontSize.value
    }
    if (savedNonTibetanFontColor) {
      nonTibetanFontColor.value = savedNonTibetanFontColor
    }

    if (savedProjects) {
      try {
        projects.value = JSON.parse(savedProjects)
        // Migrate old data structure
        projects.value.forEach((project) => {
          if (!project.rootListType) {
            project.rootListType = 'ordered'
          }

          // Migrate projects to include settings if they don't have them
          if (!project.settings) {
            project.settings = {
              fontSize: fontSize.value,
              indentSize: indentSize.value,
              defaultListType: defaultListType.value,
              showIndentGuides: showIndentGuides.value,
              tibetanFontFamily: tibetanFontFamily.value,
              tibetanFontSize: tibetanFontSize.value,
              tibetanFontColor: tibetanFontColor.value,
              nonTibetanFontFamily: nonTibetanFontFamily.value,
              nonTibetanFontSize: nonTibetanFontSize.value,
              nonTibetanFontColor: nonTibetanFontColor.value,
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
        })
      } catch (e) {
        console.error('Failed to load projects from localStorage:', e)
      }
    }

    if (savedCurrentId) {
      currentProjectId.value = savedCurrentId
      const selectedProject = projects.value.find((project) => project.id === savedCurrentId)
      if (selectedProject?.settings?.nonTibetanFontSize) {
        fontSize.value = selectedProject.settings.nonTibetanFontSize
      }
    }

    if (projects.value.length === 0) {
      const exampleProject = createExampleProject()
      currentProjectId.value = exampleProject.id
    }
  }

  function saveVersion(name = null, trigger = 'manual') {
    if (!currentProject.value) return
    
    // Generate current project data for comparison
    const currentData = exportAsJSON([currentProject.value], currentProject.value.id)
    
    // Check if this version is identical to the latest saved version
    const latestVersion = getLatestVersion(currentProject.value.id)
    if (latestVersion && latestVersion.data) {
      // Compare the JSON strings (excluding metadata like timestamps)
      const currentProjectJson = JSON.stringify(currentData.projects[0])
      const latestProjectJson = JSON.stringify(latestVersion.data.projects[0])
      
      if (currentProjectJson === latestProjectJson) {
        // Project is identical to latest version - don't save duplicate
        return null
      }
    }
    
    const versionId = generateId()
    const timestamp = Date.now()
    
    // Calculate stats for the version
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
    localStorage.setItem(key, JSON.stringify(versionData))
    
    return versionId
  }

  function getLatestVersion(projectId) {
    const versionKeys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(`scaffold-version-${projectId}-`)) {
        versionKeys.push(key)
      }
    }
    
    const versions = versionKeys
      .map((key) => {
        const data = localStorage.getItem(key)
        if (data) {
          try {
            return JSON.parse(data)
          } catch {
            return null
          }
        }
        return null
      })
      .filter((v) => v !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
    
    return versions.length > 0 ? versions[0] : null
  }

  function restoreVersion(version) {
    if (!version || !version.data) return null
    
    try {
      // Import the version data
      const imported = importFromJSON(version.data)
      if (imported.projects && imported.projects.length > 0) {
        const restoredProject = imported.projects[0]
        
        // Create new ID and update name
        restoredProject.id = generateId()
        restoredProject.name = `${restoredProject.name} (Restored ${new Date(version.timestamp).toLocaleDateString()})`
        restoredProject.createdAt = new Date().toISOString()
        restoredProject.updatedAt = new Date().toISOString()
        
        // Add to projects
        projects.value.push(restoredProject)
        currentProjectId.value = restoredProject.id
        saveToLocalStorage()
        
        return restoredProject.id
      }
    } catch (error) {
      console.error('Failed to restore version:', error)
    }
    
    return null
  }

  function setupAutoVersioning() {
    // Load settings
    const settings = localStorage.getItem('scaffold-program-settings')
    if (!settings) return
    
    const programSettings = JSON.parse(settings)
    
    // On program close
    if (programSettings.autoVersioning?.includes('close')) {
      window.addEventListener('beforeunload', () => {
        if (currentProject.value) {
          saveVersion(null, 'auto-close')
        }
      })
    }
    
    // At intervals
    if (programSettings.autoVersioning?.includes('interval')) {
      const intervalMinutes = programSettings.versioningInterval || 10
      setInterval(() => {
        if (currentProject.value) {
          saveVersion(null, 'auto-interval')
        }
      }, intervalMinutes * 60 * 1000)
    }
  }

  loadFromLocalStorage()
  
  // Setup auto-versioning on load
  setTimeout(setupAutoVersioning, 100)
  
  // Save version on start if enabled
  const settings = localStorage.getItem('scaffold-program-settings')
  if (settings) {
    const programSettings = JSON.parse(settings)
    if (programSettings.autoVersioning?.includes('start') && currentProject.value) {
      saveVersion(null, 'auto-start')
    }
  }

  return {
    projects,
    currentProjectId,
    currentProject,
    fontSize,
    fontScale,
    indentSize,
    defaultListType,
    showIndentGuides,
    tibetanFontFamily,
    tibetanFontSize,
    tibetanFontColor,
    nonTibetanFontFamily,
    nonTibetanFontSize,
    nonTibetanFontColor,
    canUndo,
    canRedo,
    createProject,
    deleteProject,
    renameProject,
    selectProject,
    addRootListItem,
    addRootListItemAfter,
    addRootDivider,
    updateListItem,
    addChildItem,
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
    setEditingItem,
    navigateToNextSibling,
    navigateToNextItem,
    currentlyEditingId,
    longNoteEditorActive,
    setLongNoteEditorActive,
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
    setTibetanFontFamily,
    setTibetanFontSize,
    setTibetanFontColor,
    setNonTibetanFontFamily,
    setNonTibetanFontSize,
    setNonTibetanFontColor,
    undo,
    redo,
    clearHistory,
    saveVersion,
    restoreVersion,
  }
})
