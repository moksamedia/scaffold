import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOutlineStore, DEFAULT_NEW_LIST_ITEM_TEXT } from 'src/stores/outline-store.js'
import { makeProject, makeItem, makeDivider, makeLegacyProject } from './fixtures/projects.js'
import { getStorageAdapter } from 'src/utils/storage/index.js'

const META_PREFIX = 'scaffold-meta-'

function seedStore(projectsArray) {
  localStorage.setItem('outline-projects', JSON.stringify(projectsArray))
  if (projectsArray.length > 0) {
    localStorage.setItem(`${META_PREFIX}current-project`, projectsArray[0].id)
  }
}

async function getStore() {
  const store = useOutlineStore()
  await store.initPromise
  return store
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('Outline Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ─── Project CRUD ────────────────────────────────────────────────
  describe('project lifecycle', () => {
    it('creates an example project when storage is empty', async () => {
      const store = await getStore()
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
      expect(store.currentProjectId).toBeTruthy()
    })

    it('createProject adds a new project with defaults', async () => {
      const store = await getStore()
      const before = store.projects.length
      const project = await store.createProject('New')
      expect(store.projects.length).toBe(before + 1)
      expect(project.name).toBe('New')
      expect(project.rootListType).toBe('ordered')
      expect(project.settings.indentSize).toBe(32)
    })

    it('createProject uses program-wide defaults from storage', async () => {
      const adapter = getStorageAdapter()
      await adapter.setMeta(
        'program-settings',
        JSON.stringify({ defaultListType: 'unordered', defaultIndentSize: 48 }),
      )
      const store = await getStore()
      const project = await store.createProject('Custom')
      expect(project.rootListType).toBe('unordered')
      expect(project.settings.indentSize).toBe(48)
    })

    it('deleteProject removes the project and updates current', async () => {
      const p1 = makeProject({ id: 'p1', name: 'One' })
      const p2 = makeProject({ id: 'p2', name: 'Two' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')
      const store = await getStore()
      store.deleteProject('p1')

      expect(store.projects.find((p) => p.id === 'p1')).toBeUndefined()
      expect(store.currentProjectId).toBe('p2')
    })

    it('renameProject updates name and updatedAt', async () => {
      const p = makeProject({ id: 'p1', name: 'Old' })
      seedStore([p])
      const store = await getStore()
      store.renameProject('p1', 'New Name')

      expect(store.projects[0].name).toBe('New Name')
    })

    it('selectProject switches current project and syncs settings', async () => {
      const p1 = makeProject({ id: 'p1', settings: { nonTibetanFontSize: 18, indentSize: 40 } })
      const p2 = makeProject({ id: 'p2', settings: { nonTibetanFontSize: 22, indentSize: 50 } })
      seedStore([p1, p2])
      const store = await getStore()

      store.selectProject('p2')
      expect(store.currentProjectId).toBe('p2')
      expect(store.indentSize).toBe(50)
    })

    it('selectProject returns false when project is locked by other tab', async () => {
      const p1 = makeProject({ id: 'p1' })
      const p2 = makeProject({ id: 'p2' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')

      localStorage.setItem(
        'scaffold-project-lock-p2',
        JSON.stringify({ holderTabId: 'other-tab', heartbeatAt: Date.now() }),
      )
      const store = await getStore()
      const result = store.selectProject('p2')
      expect(result).toBe(false)
      expect(store.projectLockBlockedProjectId).toBe('p2')
    })
  })

  // ─── Outline operations ────────────────────────────────────────
  describe('outline operations', () => {
    let store

    beforeEach(async () => {
      const item1 = makeItem({ id: 'a', text: 'A' })
      const item2 = makeItem({ id: 'b', text: 'B' })
      const item3 = makeItem({ id: 'c', text: 'C' })
      seedStore([makeProject({ id: 'p1', lists: [item1, item2, item3] })])
      store = await getStore()
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

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1' })] })])
      store = await getStore()
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

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'original' })] })])
      store = await getStore()
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
      expect(store.canUndo).toBe(true)
      for (let i = 0; i < 50; i++) {
        store.undo()
      }
      expect(store.canUndo).toBe(false)
    })

    it('undo for wrong project is a no-op', async () => {
      store.updateListItem('i1', { text: 'x' })
      const p2 = await store.createProject('Other')
      store.selectProject(p2.id)
      expect(store.canUndo).toBe(false)
    })
  })

  // ─── Bulk operations ──────────────────────────────────────────
  describe('bulk operations', () => {
    let store

    beforeEach(async () => {
      const child = makeItem({ id: 'child', text: 'Child', parentId: 'root' })
      child.longNotes = [{ id: 'ln', text: 'note', collapsed: false }]
      const root = makeItem({ id: 'root', text: 'Root', children: [child] })
      root.collapsed = false
      seedStore([makeProject({ id: 'p1', lists: [root] })])
      store = await getStore()
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
    it('splits pasted text into sibling items', async () => {
      seedStore([
        makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'first' })] }),
      ])
      const store = await getStore()
      store.applyMultiLinePasteAsSiblings('i1', 'updated first', ['second', 'third'])

      expect(store.currentProject.lists[0].text).toBe('updated first')
      expect(store.currentProject.lists).toHaveLength(3)
      expect(store.currentProject.lists[1].text).toBe('second')
      expect(store.currentProject.lists[2].text).toBe('third')
    })
  })

  // ─── Persistence roundtrip ──────────────────────────────────
  describe('persistence roundtrip', () => {
    it('persistToStorage + loadFromStorage preserves project data', async () => {
      const item = makeItem({ id: 'r1', text: 'Root' })
      seedStore([makeProject({ id: 'p1', name: 'Saved', lists: [item] })])
      const store1 = await getStore()
      expect(store1.currentProject.name).toBe('Saved')

      setActivePinia(createPinia())
      const store2 = await getStore()
      expect(store2.currentProject.name).toBe('Saved')
      expect(store2.currentProject.lists[0].text).toBe('Root')
    })

    it('persists and restores UI preferences', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store1 = await getStore()
      store1.setFontScale(150)
      store1.setIndentSize(48)

      setActivePinia(createPinia())
      const store2 = await getStore()
      expect(store2.fontScale).toBe(150)
      expect(store2.indentSize).toBe(48)
    })

    it('sets storageSaveError when persistence fails', async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'i1', text: 'A' })] })])
      const store = await getStore()
      const adapter = getStorageAdapter()
      const originalSaveProjects = adapter.saveProjects

      adapter.saveProjects = vi.fn().mockRejectedValue(new DOMException('Quota reached', 'QuotaExceededError'))
      store.updateListItem('i1', { text: 'B' })
      await flushAsyncWork()

      expect(store.storageSaveError).toContain('Storage is full')
      adapter.saveProjects = originalSaveProjects
    })

    it('sets storageUsageWarning when storage usage is high', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store = await getStore()
      const adapter = getStorageAdapter()
      const originalGetStorageStats = adapter.getStorageStats

      adapter.getStorageStats = vi.fn().mockResolvedValue({
        used: 4.6 * 1024 * 1024,
        quota: 5 * 1024 * 1024,
      })
      store.setFontScale(120)
      await flushAsyncWork()

      expect(store.storageUsageWarning).toContain('Storage usage is high')
      adapter.getStorageStats = originalGetStorageStats
    })
  })

  // ─── Legacy migration-in-load ────────────────────────────────
  describe('legacy migration-in-load', () => {
    it('migrates missing rootListType to ordered', async () => {
      const legacyProject = makeLegacyProject()
      delete legacyProject.rootListType
      seedStore([legacyProject])
      const store = await getStore()
      expect(store.currentProject.rootListType).toBe('ordered')
    })

    it('migrates legacy type to childrenType', async () => {
      seedStore([makeLegacyProject()])
      const store = await getStore()
      const item = store.currentProject.lists[0]
      expect(item.childrenType).toBe('ordered')
      expect(item.type).toBeUndefined()
    })

    it('adds missing kind field as item', async () => {
      seedStore([makeLegacyProject()])
      const store = await getStore()
      expect(store.currentProject.lists[0].kind).toBe('item')
      expect(store.currentProject.lists[0].children[0].kind).toBe('item')
    })

    it('adds missing settings from defaults', async () => {
      const proj = makeLegacyProject()
      delete proj.settings
      seedStore([proj])
      const store = await getStore()
      expect(store.currentProject.settings).toBeTruthy()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
    })

    it('backfills missing dual-script fields in existing settings', async () => {
      const proj = makeLegacyProject()
      proj.settings = { fontSize: 18, indentSize: 32, defaultListType: 'ordered', showIndentGuides: true }
      seedStore([proj])
      const store = await getStore()
      expect(store.currentProject.settings.tibetanFontFamily).toBeTruthy()
      expect(store.currentProject.settings.nonTibetanFontFamily).toBeTruthy()
    })

    it('creates example project when storage is empty', async () => {
      const store = await getStore()
      expect(store.projects.length).toBeGreaterThanOrEqual(1)
    })

    it('falls back to first project when saved current id not found', async () => {
      const p = makeProject({ id: 'exists' })
      seedStore([p])
      localStorage.setItem(`${META_PREFIX}current-project`, 'deleted-id')
      const store = await getStore()
      expect(store.currentProjectId).toBe('exists')
    })

    it('sets currentProjectId to null if saved project and all fallbacks are locked', async () => {
      const p1 = makeProject({ id: 'p1' })
      const p2 = makeProject({ id: 'p2' })
      seedStore([p1, p2])
      localStorage.setItem(`${META_PREFIX}current-project`, 'p1')
      localStorage.setItem(
        'scaffold-project-lock-p1',
        JSON.stringify({ holderTabId: 'other-tab-1', heartbeatAt: Date.now() }),
      )
      localStorage.setItem(
        'scaffold-project-lock-p2',
        JSON.stringify({ holderTabId: 'other-tab-2', heartbeatAt: Date.now() }),
      )

      const store = await getStore()
      expect(store.currentProjectId).toBeNull()
    })
  })

  // ─── Navigation helpers ──────────────────────────────────────
  describe('navigation helpers', () => {
    let store

    beforeEach(async () => {
      const items = [
        makeItem({ id: 'a', text: 'A' }),
        makeDivider({ id: 'div-1' }),
        makeItem({ id: 'b', text: 'B' }),
        makeItem({ id: 'c', text: 'C' }),
      ]
      seedStore([makeProject({ id: 'p1', lists: items })])
      store = await getStore()
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

    beforeEach(async () => {
      seedStore([makeProject({ id: 'p1' })])
      store = await getStore()
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

  describe('import and versioning branches', () => {
    it('importFromJSONFile rejects when no file is selected', async () => {
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({ target: { files: [] } })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      await expect(store.importFromJSONFile()).rejects.toThrow('No file selected')
    })

    it('importFromJSONFile imports project and resolves collisions', async () => {
      const existing = makeProject({ id: 'dup', name: 'Existing' })
      seedStore([existing])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)
      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Imported',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)
      expect(store.projects).toHaveLength(2)
      expect(store.projects[1].name).toContain('(Imported)')
      expect(store.projects[1].id).not.toBe('dup')
    })

    it('importFromJSONFile restores embedded version history for new project ids', async () => {
      const existing = makeProject({ id: 'dup', name: 'Existing' })
      seedStore([existing])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)

      const innerExport = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Snapshot',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rootListType: 'ordered',
            settings: {},
            items: [],
          },
        ],
      }

      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'dup',
            name: 'Imported',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
        projectVersions: {
          dup: [
            {
              id: 'v-good',
              projectId: 'dup',
              name: 'Manual save',
              timestamp: 1700000000000,
              trigger: 'manual',
              stats: { items: 0, notes: 0 },
              data: innerExport,
            },
            // Malformed entry — should be skipped with a warning, not abort import.
            {
              id: 'v-bad',
              projectId: 'dup',
              timestamp: 1700000001000,
            },
          ],
        },
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)
      expect(result.importedVersions).toBe(1)
      expect(result.warnings.some((w) => w.includes('Skipped version'))).toBe(true)

      // Imported project gets a fresh id; persisted version meta must use that id.
      const importedProject = store.projects.find((p) => p.name.includes('(Imported)'))
      expect(importedProject).toBeTruthy()
      expect(importedProject.id).not.toBe('dup')

      const adapter = getStorageAdapter()
      const newEntries = await adapter.getMetaEntries(`scaffold-version-${importedProject.id}-`)
      expect(newEntries).toHaveLength(1)

      const stored = JSON.parse(newEntries[0].value)
      expect(stored.id).toBe('v-good')
      expect(stored.projectId).toBe(importedProject.id)
      expect(stored.data.projects[0].id).toBe(importedProject.id)

      // Original prefix must remain empty — versions were not duplicated.
      const originalEntries = await adapter.getMetaEntries('scaffold-version-dup-')
      expect(originalEntries).toHaveLength(0)
    })

    it('importFromJSONFile keeps original ids when no project collision exists', async () => {
      seedStore([makeProject({ id: 'unrelated' })])
      const store = await getStore()
      const originalCreate = document.createElement.bind(document)

      const innerExport = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'fresh',
            name: 'Snapshot',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            rootListType: 'ordered',
            settings: {},
            items: [],
          },
        ],
      }

      const payload = {
        formatVersion: '1.0',
        exportedAt: new Date().toISOString(),
        application: 'Scaffold',
        projects: [
          {
            id: 'fresh',
            name: 'Fresh Import',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [],
          },
        ],
        projectVersions: {
          fresh: [
            {
              id: 'v-1',
              projectId: 'fresh',
              name: null,
              timestamp: 1700000000000,
              trigger: 'manual',
              stats: { items: 0, notes: 0 },
              data: innerExport,
            },
          ],
        },
      }

      vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        if (tagName === 'input') {
          return {
            type: '',
            accept: '',
            onchange: null,
            click() {
              this.onchange?.({
                target: {
                  files: [{ text: async () => JSON.stringify(payload) }],
                },
              })
            },
          }
        }
        return originalCreate(tagName, options)
      })

      const result = await store.importFromJSONFile()
      expect(result.imported).toBe(1)
      expect(result.importedVersions).toBe(1)

      const importedProject = store.projects.find((p) => p.id === 'fresh')
      expect(importedProject).toBeTruthy()

      const adapter = getStorageAdapter()
      const entries = await adapter.getMetaEntries('scaffold-version-fresh-')
      expect(entries).toHaveLength(1)
    })


    it('saveVersion skips duplicates compared to latest version', async () => {
      seedStore([makeProject({ id: 'p1', lists: [makeItem({ id: 'a', text: 'A' })] })])
      const store = await getStore()

      const firstId = await store.saveVersion('Initial')
      expect(firstId).toBeTruthy()
      const secondId = await store.saveVersion('Duplicate attempt')
      expect(secondId).toBeNull()
    })

    it('saveVersion duplicate check ignores malformed existing version entries', async () => {
      seedStore([makeProject({ id: 'p1' })])
      const store = await getStore()
      await getStorageAdapter().setMeta('scaffold-version-p1-bad', 'NOT_JSON')

      const versionId = await store.saveVersion('After malformed latest')
      expect(versionId).toBeTruthy()
    })

    it('restoreVersion returns null for invalid payloads', async () => {
      const store = await getStore()
      expect(store.restoreVersion(null)).toBeNull()
      expect(store.restoreVersion({})).toBeNull()
      expect(store.restoreVersion({ data: { invalid: true } })).toBeNull()
    })

    it('auto-start versioning creates a version when configured', async () => {
      const adapter = getStorageAdapter()
      await adapter.setMeta(
        'program-settings',
        JSON.stringify({ autoVersioning: ['start'] }),
      )
      seedStore([makeProject({ id: 'p1' })])
      const store = await getStore()

      const entries = await adapter.getMetaEntries('scaffold-version-p1-')
      expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('auto-close and interval versioning paths execute without error', async () => {
      vi.useFakeTimers()
      const adapter = getStorageAdapter()
      await adapter.setMeta(
        'program-settings',
        JSON.stringify({ autoVersioning: ['close', 'interval'], versioningInterval: 0.001 }),
      )
      seedStore([makeProject({ id: 'p1' })])
      await getStore()

      window.dispatchEvent(new Event('beforeunload'))
      await vi.advanceTimersByTimeAsync(1000)

      const entries = await adapter.getMetaEntries('scaffold-version-p1-')
      expect(entries.length).toBeGreaterThanOrEqual(1)
      vi.useRealTimers()
    })
  })
})
