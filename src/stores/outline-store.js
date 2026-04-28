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
import {
  getTabInstanceId,
  writeProjectLock,
  removeProjectLock,
  isProjectLockedByOtherTab,
  PROJECT_LOCK_HEARTBEAT_MS,
} from 'src/utils/project-tab-lock.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { runMediaMigration } from 'src/utils/media/migration.js'
import { runMediaGc } from 'src/utils/media/gc.js'

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
  let mediaGcTimer = null
  /** Idle GC frequency. Tests can stub setInterval to verify wiring. */
  const MEDIA_GC_INTERVAL_MS = 10 * 60 * 1000

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
    persistToStorage()
    return project
  }

  function deleteProject(projectId) {
    const index = projects.value.findIndex((p) => p.id === projectId)
    if (index !== -1) {
      removeProjectLock(projectId)
      projects.value.splice(index, 1)
      if (currentProjectId.value === projectId) {
        currentProjectId.value = projects.value[0]?.id || null
      }
      syncProjectLockSession()
      persistToStorage()
      void triggerMediaGc('project-delete')
    }
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
    const exportOptions = {}
    if (options.includeVersionHistory) {
      exportOptions.versionsByProjectId = await gatherVersionsByProjectId([
        currentProject.value.id,
      ])
    }
    await exportSingleProjectAsJSON(currentProject.value, exportOptions)
  }

  async function exportAllAsJSON(options = {}) {
    const exportOptions = {}
    if (options.includeVersionHistory) {
      exportOptions.versionsByProjectId = await gatherVersionsByProjectId(
        projects.value.map((p) => p.id),
      )
    }
    await exportAllProjectsAsJSON(projects.value, exportOptions)
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
          const importResult = await importFromJSON(jsonData)
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

          resolve({
            success: true,
            imported: importResult.projects.length,
            importedVersions: importedVersionCount,
            importedMedia: importResult.importedMediaCount || 0,
            warnings,
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
    } catch (error) {
      console.warn('Failed to read media usage stats:', error)
    }
    return mediaUsage.value
  }

  async function triggerMediaGc(reason = 'scheduled') {
    try {
      await runMediaGc()
      await refreshMediaUsage()
    } catch (error) {
      console.warn(`Media GC (${reason}) failed:`, error)
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
        console.error('Failed to persist project data:', error)
      }
    })()
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
  }

  function registerProjectLockUnloadHandlers() {
    const release = () => releaseCurrentProjectLockForUnload()
    window.addEventListener('beforeunload', release)
    window.addEventListener('pagehide', release)
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
      console.error('Failed to restore version:', error)
    }
    
    return null
  }

  async function setupAutoVersioning() {
    const adapter = getStorageAdapter()
    const raw = await adapter.getMeta('program-settings')
    if (!raw) return
    
    const programSettings = JSON.parse(raw)
    
    if (programSettings.autoVersioning?.includes('close')) {
      window.addEventListener('beforeunload', () => {
        if (currentProject.value) {
          saveVersion(null, 'auto-close')
        }
      })
    }
    
    if (programSettings.autoVersioning?.includes('interval')) {
      const intervalMinutes = programSettings.versioningInterval || 10
      setInterval(() => {
        if (currentProject.value) {
          saveVersion(null, 'auto-interval')
        }
      }, intervalMinutes * 60 * 1000)
    }
  }

  const initPromise = loadFromStorage().then(async () => {
    registerProjectLockUnloadHandlers()

    // Migrate any pre-existing inline `data:` URIs in long-note HTML and
    // version snapshots into the content-addressable media store. The
    // operation is idempotent because IDs are content hashes, so it is
    // safe to run on every app load.
    try {
      await runMediaMigration()
    } catch (error) {
      console.warn('Media migration failed:', error)
    }

    await refreshMediaUsage()
    startMediaGcTimer()

    await setupAutoVersioning()

    const raw = await getStorageAdapter().getMeta('program-settings')
    if (raw) {
      const programSettings = JSON.parse(raw)
      if (programSettings.autoVersioning?.includes('start') && currentProject.value) {
        await saveVersion(null, 'auto-start')
      }
    }
  })

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
    storeReady,
    initPromise,
    createProject,
    deleteProject,
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
    refreshMediaUsage,
    triggerMediaGc,
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
