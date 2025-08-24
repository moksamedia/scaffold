import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useOutlineStore = defineStore('outline', () => {
  const projects = ref([])
  const currentProjectId = ref(null)
  const fontSize = ref(14)
  const indentSize = ref(32)
  const defaultListType = ref('ordered')
  const showIndentGuides = ref(true)
  const undoStack = ref([])
  const redoStack = ref([])
  const maxHistorySize = 50
  const currentlyEditingId = ref(null)
  
  const currentProject = computed(() => {
    return projects.value.find(p => p.id === currentProjectId.value)
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
      timestamp: Date.now()
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
      timestamp: Date.now()
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
      timestamp: Date.now()
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
    const project = {
      id: generateId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lists: [],
      rootListType: defaultListType.value,
      settings: {
        fontSize: fontSize.value,
        indentSize: indentSize.value,
        defaultListType: defaultListType.value,
        showIndentGuides: showIndentGuides.value
      }
    }
    projects.value.push(project)
    saveToLocalStorage()
    return project
  }
  
  function deleteProject(projectId) {
    const index = projects.value.findIndex(p => p.id === projectId)
    if (index !== -1) {
      projects.value.splice(index, 1)
      if (currentProjectId.value === projectId) {
        currentProjectId.value = projects.value[0]?.id || null
      }
      saveToLocalStorage()
    }
  }
  
  function renameProject(projectId, newName) {
    const project = projects.value.find(p => p.id === projectId)
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
    const project = projects.value.find(p => p.id === projectId)
    if (project && project.settings) {
      fontSize.value = project.settings.fontSize
      indentSize.value = project.settings.indentSize
      defaultListType.value = project.settings.defaultListType
      showIndentGuides.value = project.settings.showIndentGuides
    }
    
    saveToLocalStorage()
  }
  
  function createListItem(text = '', parentId = null) {
    return {
      id: generateId(),
      text,
      collapsed: false,
      shortNotes: [],
      longNotes: [],
      children: [],
      childrenType: defaultListType.value,
      parentId
    }
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
  
  function findItemById(items, id) {
    for (const item of items) {
      if (item.id === id) return item
      const found = findItemById(item.children, id)
      if (found) return found
    }
    return null
  }
  
  function updateListItem(itemId, updates) {
    if (!currentProject.value) return
    
    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
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
      const index = items.findIndex(item => item.id === itemId)
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
      item.shortNotes.push({
        id: generateId(),
        text,
        createdAt: new Date().toISOString()
      })
      currentProject.value.updatedAt = new Date().toISOString()
      saveToLocalStorage()
    }
  }
  
  function addLongNote(itemId, text) {
    if (!currentProject.value) return
    
    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      item.longNotes.push({
        id: generateId(),
        text,
        collapsed: true,
        createdAt: new Date().toISOString()
      })
      currentProject.value.updatedAt = new Date().toISOString()
      saveToLocalStorage()
    }
  }
  
  function deleteNote(itemId, noteId, noteType) {
    if (!currentProject.value) return
    
    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
      const notes = noteType === 'short' ? item.shortNotes : item.longNotes
      const index = notes.findIndex(n => n.id === noteId)
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
      const notes = noteType === 'short' ? item.shortNotes : item.longNotes
      const note = notes.find(n => n.id === noteId)
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
      const note = item.longNotes.find(n => n.id === noteId)
      if (note) {
        note.collapsed = !note.collapsed
        saveToLocalStorage()
      }
    }
  }
  
  function moveItem(itemId, direction) {
    if (!currentProject.value) return
    
    function moveInList(items) {
      const index = items.findIndex(item => item.id === itemId)
      if (index !== -1) {
        if (direction === 'up' && index > 0) {
          [items[index], items[index - 1]] = [items[index - 1], items[index]]
          return true
        } else if (direction === 'down' && index < items.length - 1) {
          [items[index], items[index + 1]] = [items[index + 1], items[index]]
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
          const item = items.splice(i, 1)[0]
          item.parentId = parentId
          const parentIndex = parentItems.findIndex(p => p.children === items)
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
    currentProject.value.rootListType = currentProject.value.rootListType === 'ordered' ? 'unordered' : 'ordered'
    currentProject.value.updatedAt = new Date().toISOString()
    saveToLocalStorage()
  }
  
  function toggleChildrenListType(itemId) {
    if (!currentProject.value) return
    
    const item = findItemById(currentProject.value.lists, itemId)
    if (item) {
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
      const currentIndex = items.findIndex(item => item.id === itemId)
      if (currentIndex !== -1) {
        // Found the item, return next sibling (or first if at end)
        const nextIndex = (currentIndex + 1) % items.length
        return items[nextIndex]
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
            return items[i + 1]
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
      const isVisible = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= viewportHeight &&
        rect.right <= viewportWidth
      )
      
      // Only scroll if not visible
      if (!isVisible) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        })
      }
    }, 0)
  }
  
  function setFontSize(size) {
    fontSize.value = size
    if (currentProject.value) {
      if (!currentProject.value.settings) {
        currentProject.value.settings = {}
      }
      currentProject.value.settings.fontSize = size
      currentProject.value.updatedAt = new Date().toISOString()
    }
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
  
  function saveToLocalStorage() {
    localStorage.setItem('outline-projects', JSON.stringify(projects.value))
    localStorage.setItem('outline-current-project', currentProjectId.value || '')
    localStorage.setItem('outline-font-size', fontSize.value.toString())
    localStorage.setItem('outline-indent-size', indentSize.value.toString())
    localStorage.setItem('outline-default-list-type', defaultListType.value)
    localStorage.setItem('outline-show-indent-guides', showIndentGuides.value.toString())
  }
  
  function loadFromLocalStorage() {
    const savedProjects = localStorage.getItem('outline-projects')
    const savedCurrentId = localStorage.getItem('outline-current-project')
    const savedFontSize = localStorage.getItem('outline-font-size')
    const savedIndentSize = localStorage.getItem('outline-indent-size')
    const savedDefaultListType = localStorage.getItem('outline-default-list-type')
    const savedShowIndentGuides = localStorage.getItem('outline-show-indent-guides')
    
    if (savedFontSize) {
      fontSize.value = parseInt(savedFontSize, 10)
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
    
    if (savedProjects) {
      try {
        projects.value = JSON.parse(savedProjects)
        // Migrate old data structure
        projects.value.forEach(project => {
          if (!project.rootListType) {
            project.rootListType = 'ordered'
          }
          
          // Migrate projects to include settings if they don't have them
          if (!project.settings) {
            project.settings = {
              fontSize: fontSize.value,
              indentSize: indentSize.value,
              defaultListType: defaultListType.value,
              showIndentGuides: showIndentGuides.value
            }
          }
          
          function migrateItems(items) {
            items.forEach(item => {
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
    }
    
    if (projects.value.length === 0) {
      const defaultProject = createProject('My First Project')
      currentProjectId.value = defaultProject.id
    }
  }
  
  loadFromLocalStorage()
  
  return {
    projects,
    currentProjectId,
    currentProject,
    fontSize,
    indentSize,
    defaultListType,
    showIndentGuides,
    canUndo,
    canRedo,
    createProject,
    deleteProject,
    renameProject,
    selectProject,
    addRootListItem,
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
    setFontSize,
    setIndentSize,
    setDefaultListType,
    setShowIndentGuides,
    undo,
    redo,
    clearHistory
  }
})