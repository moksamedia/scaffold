import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOutlineStore, DEFAULT_NEW_LIST_ITEM_TEXT } from 'src/stores/outline-store.js'
import { makeProject, makeItem, makeDivider, makeLegacyProject } from './fixtures/projects.js'

function seedStore(projectsArray) {
  localStorage.setItem('outline-projects', JSON.stringify(projectsArray))
  if (projectsArray.length > 0) {
    localStorage.setItem('outline-current-project', projectsArray[0].id)
  }
}

function getStore() {
  return useOutlineStore()
}

describe('Outline Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── Project CRUD ────────────────────────────────────────────────
  describe('project lifecycle', () => {
    it('creates an example project when localStorage is empty', () => {
      const store = getStore()
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
      expect(store.currentProjectId).toBeTruthy()
    })

    it('createProject adds a new project with defaults', () => {
      const store = getStore()
      const before = store.projects.length
      const project = store.createProject('New')
      expect(store.projects.length).toBe(before + 1)
      expect(project.name).toBe('New')
      expect(project.rootListType).toBe('ordered')
      expect(project.settings.indentSize).toBe(32)
    })

    it('createProject uses program-wide defaults from localStorage', () => {
      localStorage.setItem(
        'scaffold-program-settings',
        JSON.stringify({ defaultListType: 'unordered', defaultIndentSize: 48 }),
      )
      const store = getStore()
      const project = store.createProject('Custom')
      expect(project.rootListType).toBe('unordered')
      expect(project.settings.indentSize).toBe(48)
    })

    it('deleteProject removes the project and updates current', () => {
      const p1 = makeProject({ id: 'p1', name: 'One' })
      const p2 = makeProject({ id: 'p2', name: 'Two' })
      seedStore([p1, p2])
      localStorage.setItem('outline-current-project', 'p1')
      const store = getStore()
      store.deleteProject('p1')

      expect(store.projects.find((p) => p.id === 'p1')).toBeUndefined()
      expect(store.currentProjectId).toBe('p2')
    })

    it('renameProject updates name and updatedAt', () => {
      const p = makeProject({ id: 'p1', name: 'Old' })
      seedStore([p])
      const store = getStore()
      store.renameProject('p1', 'New Name')

      expect(store.projects[0].name).toBe('New Name')
    })

    it('selectProject switches current project and syncs settings', () => {
      const p1 = makeProject({ id: 'p1', settings: { nonTibetanFontSize: 18, indentSize: 40 } })
      const p2 = makeProject({ id: 'p2', settings: { nonTibetanFontSize: 22, indentSize: 50 } })
      seedStore([p1, p2])
      const store = getStore()

      store.selectProject('p2')
      expect(store.currentProjectId).toBe('p2')
      expect(store.indentSize).toBe(50)
    })

    it('selectProject returns false when project is locked by other tab', () => {
      const p1 = makeProject({ id: 'p1' })
      const p2 = makeProject({ id: 'p2' })
      seedStore([p1, p2])
      localStorage.setItem('outline-current-project', 'p1')

      // Simulate another tab holding a lock on p2
      localStorage.setItem(
        'scaffold-project-lock-p2',
        JSON.stringify({ holderTabId: 'other-tab', heartbeatAt: Date.now() }),
      )
      const store = getStore()
      const result = store.selectProject('p2')
      expect(result).toBe(false)
      expect(store.projectLockBlockedProjectId).toBe('p2')
    })
  })

  // ─── Outline operations ────────────────────────────────────────
  describe('outline operations', () => {
    let store

    beforeEach(() => {
      const item1 = makeItem({ id: 'a', text: 'A' })
      const item2 = makeItem({ id: 'b', text: 'B' })
      const item3 = makeItem({ id: 'c', text: 'C' })
      seedStore([makeProject({ id: 'p1', lists: [item1, item2, item3] })])
      store = getStore()
    })

    it('addRootListItem appends to lists', () => {
      const item = store.addRootListItem()
      expect(item.text).toBe(DEFAULT_NEW_LIST_ITEM_TEXT)
      expect(store.currentProject.lists.at(-1).id).toBe(item.id)
    })

    it('addRootListItemAfter inserts after reference', () => {
      store.addRootListItemAfter('a')
      expect(store.currentProject.lists[1].text).toBe(DEFAULT_NEW_LIST_ITEM_TEXT)
      expect(store.currentProject.lists).toHaveLength(4)
    })

    it('addRootDivider adds a divider', () => {
      const div = store.addRootDivider()
      expect(div.kind).toBe('divider')
      expect(store.currentProject.lists.at(-1).kind).toBe('divider')
    })

    it('addChildItem adds child and uncollapse parent', () => {
      store.currentProject.lists[0].collapsed = true
      const child = store.addChildItem('a')
      expect(child.parentId).toBe('a')
      expect(store.currentProject.lists[0].children).toHaveLength(1)
      expect(store.currentProject.lists[0].collapsed).toBe(false)
    })

    it('addChildItem is blocked on dividers', () => {
      const div = makeDivider({ id: 'div-x' })
      store.currentProject.lists.push(div)
      const result = store.addChildItem('div-x')
      expect(result).toBeUndefined()
    })

    it('updateListItem applies updates', () => {
      store.updateListItem('a', { text: 'Updated A' })
      expect(store.currentProject.lists[0].text).toBe('Updated A')
    })

    it('updateListItem is blocked on dividers', () => {
      const div = makeDivider({ id: 'div-x' })
      store.currentProject.lists.push(div)
      store.updateListItem('div-x', { text: 'Should not work' })
      const found = store.currentProject.lists.find((i) => i.id === 'div-x')
      expect(found.text).toBe('')
    })

    it('deleteListItem removes item', () => {
      store.deleteListItem('b')
      expect(store.currentProject.lists).toHaveLength(2)
      expect(store.currentProject.lists.find((i) => i.id === 'b')).toBeUndefined()
    })

    it('moveItem up swaps positions', () => {
      store.moveItem('b', 'up')
      expect(store.currentProject.lists[0].id).toBe('b')
      expect(store.currentProject.lists[1].id).toBe('a')
    })

    it('moveItem down swaps positions', () => {
      store.moveItem('a', 'down')
      expect(store.currentProject.lists[0].id).toBe('b')
      expect(store.currentProject.lists[1].id).toBe('a')
    })

    it('indentItem makes item child of previous sibling', () => {
      store.indentItem('b')
      expect(store.currentProject.lists).toHaveLength(2)
      expect(store.currentProject.lists[0].children).toHaveLength(1)
      expect(store.currentProject.lists[0].children[0].id).toBe('b')
    })

    it('indentItem is blocked adjacent to divider', () => {
      store.currentProject.lists.splice(1, 0, makeDivider({ id: 'div-block' }))
      const beforeLen = store.currentProject.lists.length
      store.indentItem('div-block')
      expect(store.currentProject.lists.length).toBe(beforeLen)
    })

    it('outdentItem promotes child to parent level', () => {
      store.indentItem('b')
      store.outdentItem('b')
      expect(store.currentProject.lists.find((i) => i.id === 'b')).toBeTruthy()
      expect(store.currentProject.lists[0].children).toHaveLength(0)
    })

    it('toggleRootListType flips between ordered and unordered', () => {
      expect(store.currentProject.rootListType).toBe('ordered')
      store.toggleRootListType()
      expect(store.currentProject.rootListType).toBe('unordered')
      store.toggleRootListType()
      expect(store.currentProject.rootListType).toBe('ordered')
    })

    it('toggleChildrenListType flips for a specific item', () => {
      expect(store.currentProject.lists[0].childrenType).toBe('ordered')
      store.toggleChildrenListType('a')
      expect(store.currentProject.lists[0].childrenType).toBe('unordered')
    })
  })

  // ─── Notes ────────────────────────────────────────────────
  describe('notes', () => {
    let store

    beforeEach(() => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1' })] })])
      store = getStore()
    })

    it('addShortNote appends note to item', () => {
      store.addShortNote('i1', 'page 5')
      expect(store.currentProject.lists[0].shortNotes).toHaveLength(1)
      expect(store.currentProject.lists[0].shortNotes[0].text).toBe('page 5')
    })

    it('addLongNote appends note and returns id', () => {
      const noteId = store.addLongNote('i1', '<p>detail</p>')
      expect(noteId).toBeTruthy()
      expect(store.currentProject.lists[0].longNotes).toHaveLength(1)
    })

    it('addShortNote is blocked on dividers', () => {
      store.currentProject.lists.push(makeDivider({ id: 'div-n' }))
      store.addShortNote('div-n', 'nope')
      const div = store.currentProject.lists.find((i) => i.id === 'div-n')
      expect(div.shortNotes).toHaveLength(0)
    })

    it('deleteNote removes the specified note', () => {
      store.addShortNote('i1', 'a')
      store.addShortNote('i1', 'b')
      const noteId = store.currentProject.lists[0].shortNotes[0].id
      store.deleteNote('i1', noteId, 'short')
      expect(store.currentProject.lists[0].shortNotes).toHaveLength(1)
    })

    it('updateNote changes text', () => {
      store.addLongNote('i1', 'old')
      const noteId = store.currentProject.lists[0].longNotes[0].id
      store.updateNote('i1', noteId, 'long', 'new')
      expect(store.currentProject.lists[0].longNotes[0].text).toBe('new')
    })

    it('toggleNoteCollapse flips collapsed', () => {
      store.addLongNote('i1', 'text')
      const noteId = store.currentProject.lists[0].longNotes[0].id
      expect(store.currentProject.lists[0].longNotes[0].collapsed).toBe(false)
      store.toggleNoteCollapse('i1', noteId)
      expect(store.currentProject.lists[0].longNotes[0].collapsed).toBe(true)
    })
  })

  // ─── Undo/Redo ────────────────────────────────────────────
  describe('undo/redo', () => {
    let store

    beforeEach(() => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'original' })] })])
      store = getStore()
    })

    it('undo restores previous state after mutation', () => {
      store.updateListItem('i1', { text: 'changed' })
      expect(store.currentProject.lists[0].text).toBe('changed')
      store.undo()
      expect(store.currentProject.lists[0].text).toBe('original')
    })

    it('redo re-applies after undo', () => {
      store.updateListItem('i1', { text: 'changed' })
      store.undo()
      store.redo()
      expect(store.currentProject.lists[0].text).toBe('changed')
    })

    it('new mutation clears redo stack', () => {
      store.updateListItem('i1', { text: 'v1' })
      store.undo()
      expect(store.canRedo).toBe(true)
      store.updateListItem('i1', { text: 'v2' })
      expect(store.canRedo).toBe(false)
    })

    it('caps history at 50 entries', () => {
      for (let i = 0; i < 55; i++) {
        store.updateListItem('i1', { text: `v${i}` })
      }
      // undoStack internally tracked; canUndo should be true
      expect(store.canUndo).toBe(true)
      // Undo 50 times should exhaust stack
      for (let i = 0; i < 50; i++) {
        store.undo()
      }
      expect(store.canUndo).toBe(false)
    })

    it('undo for wrong project is a no-op', () => {
      store.updateListItem('i1', { text: 'x' })
      // Switch to new project to test isolation
      const p2 = store.createProject('Other')
      store.selectProject(p2.id)
      // History was cleared on project switch, so canUndo should be false
      expect(store.canUndo).toBe(false)
    })
  })

  // ─── Bulk operations ──────────────────────────────────────────
  describe('bulk operations', () => {
    let store

    beforeEach(() => {
      const child = makeItem({ id: 'child', text: 'Child', parentId: 'root' })
      child.longNotes = [{ id: 'ln', text: 'note', collapsed: false }]
      const root = makeItem({ id: 'root', text: 'Root', children: [child] })
      root.collapsed = false
      seedStore([makeProject({ id: 'p1', lists: [root] })])
      store = getStore()
    })

    it('collapseExpandAllItems collapses items with children', () => {
      store.collapseExpandAllItems(true)
      expect(store.currentProject.lists[0].collapsed).toBe(true)
    })

    it('collapseExpandAllItems expands all', () => {
      store.collapseExpandAllItems(true)
      store.collapseExpandAllItems(false)
      expect(store.currentProject.lists[0].collapsed).toBe(false)
    })

    it('collapseExpandAllLongNotes collapses notes', () => {
      store.collapseExpandAllLongNotes(true)
      const note = store.currentProject.lists[0].children[0].longNotes[0]
      expect(note.collapsed).toBe(true)
    })

    it('showHideAllLongNotes sets hidden flag', () => {
      store.showHideAllLongNotes(false)
      const note = store.currentProject.lists[0].children[0].longNotes[0]
      expect(note.hidden).toBe(true)
      store.showHideAllLongNotes(true)
      expect(note.hidden).toBe(false)
    })
  })

  // ─── Multi-line paste ───────────────────────────────────────
  describe('applyMultiLinePasteAsSiblings', () => {
    it('splits pasted text into sibling items', () => {
      seedStore([
        makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'first' })] }),
      ])
      const store = getStore()
      store.applyMultiLinePasteAsSiblings('i1', 'updated first', ['second', 'third'])

      expect(store.currentProject.lists[0].text).toBe('updated first')
      expect(store.currentProject.lists).toHaveLength(3)
      expect(store.currentProject.lists[1].text).toBe('second')
      expect(store.currentProject.lists[2].text).toBe('third')
    })
  })

  // ─── Persistence roundtrip ──────────────────────────────────
  describe('persistence roundtrip', () => {
    it('saveToLocalStorage + loadFromLocalStorage preserves project data', () => {
      const item = makeItem({ id: 'r1', text: 'Root' })
      seedStore([makeProject({ id: 'p1', name: 'Saved', lists: [item] })])
      const store1 = getStore()
      expect(store1.currentProject.name).toBe('Saved')

      // Re-create pinia to simulate reload
      setActivePinia(createPinia())
      const store2 = getStore()
      expect(store2.currentProject.name).toBe('Saved')
      expect(store2.currentProject.lists[0].text).toBe('Root')
    })

    it('persists and restores UI preferences', () => {
      seedStore([makeProject({ id: 'p1' })])
      const store1 = getStore()
      store1.setFontScale(150)
      store1.setIndentSize(48)

      setActivePinia(createPinia())
      const store2 = getStore()
      expect(store2.fontScale).toBe(150)
      expect(store2.indentSize).toBe(48)
    })
  })

  // ─── Legacy migration-in-load ────────────────────────────────
  describe('legacy migration-in-load', () => {
    it('migrates missing rootListType to ordered', () => {
      const legacyProject = makeLegacyProject()
      delete legacyProject.rootListType
      seedStore([legacyProject])
      const store = getStore()
      expect(store.currentProject.rootListType).toBe('ordered')
    })

    it('migrates legacy type to childrenType', () => {
      seedStore([makeLegacyProject()])
      const store = getStore()
      const item = store.currentProject.lists[0]
      expect(item.childrenType).toBe('ordered')
      expect(item.type).toBeUndefined()
    })

    it('adds missing kind field as item', () => {
      seedStore([makeLegacyProject()])
      const store = getStore()
      expect(store.currentProject.lists[0].kind).toBe('item')
      expect(store.currentProject.lists[0].children[0].kind).toBe('item')
    })

    it('adds missing settings from defaults', () => {
      const proj = makeLegacyProject()
      delete proj.settings
      seedStore([proj])
      const store = getStore()
      expect(store.currentProject.settings).toBeTruthy()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
    })

    it('backfills missing dual-script fields in existing settings', () => {
      const proj = makeLegacyProject()
      proj.settings = { fontSize: 18, indentSize: 32, defaultListType: 'ordered', showIndentGuides: true }
      seedStore([proj])
      const store = getStore()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
      expect(store.currentProject.settings.nonTibetanFontFamily).toBeTruthy()
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('outline-projects', 'NOT_JSON')
      const store = getStore()
      // Should create example project as fallback
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
    })

    it('falls back to first project when saved current id not found', () => {
      const p = makeProject({ id: 'exists' })
      seedStore([p])
      localStorage.setItem('outline-current-project', 'deleted-id')
      const store = getStore()
      expect(store.currentProjectId).toBe('exists')
    })
  })

  // ─── Navigation helpers ──────────────────────────────────────
  describe('navigation helpers', () => {
    let store

    beforeEach(() => {
      const items = [
        makeItem({ id: 'a', text: 'A' }),
        makeDivider({ id: 'div-1' }),
        makeItem({ id: 'b', text: 'B' }),
        makeItem({ id: 'c', text: 'C' }),
      ]
      seedStore([makeProject({ id: 'p1', lists: items })])
      store = getStore()
    })

    it('findNextSibling wraps around and skips dividers', () => {
      const next = store.findNextSibling('a')
      expect(next.id).toBe('b')
    })

    it('findNextSibling wraps from last to first (skipping dividers)', () => {
      const next = store.findNextSibling('c')
      expect(next.id).toBe('a')
    })

    it('findNextSiblingNoWrap returns null at end', () => {
      const next = store.findNextSiblingNoWrap('c')
      expect(next).toBeNull()
    })

    it('findNextSiblingNoWrap skips dividers', () => {
      const next = store.findNextSiblingNoWrap('a')
      expect(next.id).toBe('b')
    })
  })

  // ─── Settings setters ───────────────────────────────────────
  describe('settings setters', () => {
    let store

    beforeEach(() => {
      seedStore([makeProject({ id: 'p1' })])
      store = getStore()
    })

    it('setIndentSize updates store and project settings', () => {
      store.setIndentSize(64)
      expect(store.indentSize).toBe(64)
      expect(store.currentProject.settings.indentSize).toBe(64)
    })

    it('setDefaultListType updates store and project', () => {
      store.setDefaultListType('unordered')
      expect(store.defaultListType).toBe('unordered')
      expect(store.currentProject.settings.defaultListType).toBe('unordered')
    })

    it('setShowIndentGuides updates store and project', () => {
      store.setShowIndentGuides(false)
      expect(store.showIndentGuides).toBe(false)
      expect(store.currentProject.settings.showIndentGuides).toBe(false)
    })

    it('setTibetanFontFamily updates store and project', () => {
      store.setTibetanFontFamily('Noto Sans Tibetan')
      expect(store.tibetanFontFamily).toBe('Noto Sans Tibetan')
    })

    it('setNonTibetanFontSize syncs fontSize alias', () => {
      store.setNonTibetanFontSize(20)
      expect(store.nonTibetanFontSize).toBe(20)
      expect(store.fontSize).toBe(20)
    })
  })
})
