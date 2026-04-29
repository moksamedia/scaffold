import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOutlineStore } from 'src/stores/outline-store.js'
import {
  importFromJSON,
  validateImportData,
} from 'src/utils/export/json.js'
import realExport from './fixtures/real-export.json'

function countItems(items) {
  let count = 0
  for (const item of items) {
    count++
    if (item.children?.length) {
      count += countItems(item.children)
    }
  }
  return count
}

function maxDepth(items, depth = 1) {
  let max = depth
  for (const item of items) {
    if (item.children?.length) {
      max = Math.max(max, maxDepth(item.children, depth + 1))
    }
  }
  return max
}

function collectNotes(items, acc = { short: 0, long: 0 }) {
  for (const item of items) {
    acc.short += item.shortNotes?.length || 0
    acc.long += item.longNotes?.length || 0
    if (item.children?.length) collectNotes(item.children, acc)
  }
  return acc
}

function collectAllItems(items, acc = []) {
  for (const item of items) {
    acc.push(item)
    if (item.children?.length) collectAllItems(item.children, acc)
  }
  return acc
}

describe('real export: validation', () => {
  it('passes validation without errors', () => {
    const result = validateImportData(realExport)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('has correct envelope metadata', () => {
    expect(realExport.formatVersion).toBe('1.0')
    expect(realExport.application).toBe('Scaffold')
    expect(realExport.projects).toHaveLength(2)
  })
})

describe('real export: importFromJSON', () => {
  let imported

  beforeEach(async () => {
    imported = await importFromJSON(realExport)
  })

  it('imports both projects', () => {
    expect(imported.projects).toHaveLength(2)
    expect(imported.projects[0].name).toBe('Pramanavartika')
    expect(imported.projects[1].name).toBe('དོན་དུན་བཅུ་')
  })

  it('preserves project ids', () => {
    expect(imported.projects[0].id).toBe('menv5euh1peq4sykcri')
    expect(imported.projects[1].id).toBe('mnpfkzy846025ulcsw9')
  })

  it('preserves timestamps', () => {
    const p1 = imported.projects[0]
    expect(p1.createdAt).toBe('2025-08-23T06:13:25.481Z')
    expect(p1.updatedAt).toBe('2025-08-28T05:29:00.874Z')
  })

  it('preserves per-project settings including typography', () => {
    const s1 = imported.projects[0].settings
    expect(s1.indentSize).toBe(39)
    expect(s1.showIndentGuides).toBe(false)
    expect(s1.tibetanFontFamily).toBe('Microsoft Himalaya')
    expect(s1.nonTibetanFontFamily).toBe('Aptos, sans-serif')

    const s2 = imported.projects[1].settings
    expect(s2.indentSize).toBe(33)
    expect(s2.tibetanFontSize).toBe(24)
  })

  it('preserves Tibetan Unicode text in item names', () => {
    const p1 = imported.projects[0]
    expect(p1.lists[0].text).toBe('དང་པོ་༼སྤྱིའི་དོན་༽ལ་གསུམ།')
    expect(p1.lists[0].children[0].text).toContain('སློབ་དཔོན་ཕྱོགས་གླང')
  })

  it('preserves short notes', () => {
    const p1Root = imported.projects[0].lists[0]
    expect(p1Root.shortNotes).toHaveLength(1)
    expect(p1Root.shortNotes[0].text).toBe('p1')
    expect(p1Root.shortNotes[0].id).toBe('menve9l80lxx2n2lh299')
  })

  it('preserves long notes with rich HTML content', () => {
    const firstChild = imported.projects[0].lists[0].children[0]
    expect(firstChild.longNotes).toHaveLength(2)

    const note = firstChild.longNotes[0]
    expect(note.collapsed).toBe(true)
    expect(note.text).toContain('<blockquote')
    expect(note.text).toContain('ཚད་མར་གྱུར་པ་འགྲོ་ལ་ཕན་བཞེད་པ')
    expect(note.text).toContain('<b>Buddhas excellent causes')
  })

  it('preserves long notes with inline styled spans', () => {
    const p2 = imported.projects[1]
    const sbyorBa = p2.lists[0].children[1].children[0]
    expect(sbyorBa.longNotes).toHaveLength(1)
    expect(sbyorBa.longNotes[0].text).toContain('font-family: Microsoft Himalaya')
    expect(sbyorBa.longNotes[0].text).toContain('font-size: 30px')
  })

  it('preserves deep nesting structure (project 1)', () => {
    const p1 = imported.projects[0]
    const depth = maxDepth(p1.lists)
    expect(depth).toBeGreaterThanOrEqual(7)
  })

  it('preserves mixed childrenType values', () => {
    const allItems = collectAllItems(imported.projects[0].lists)
    const ordered = allItems.filter((i) => i.childrenType === 'ordered')
    const unordered = allItems.filter((i) => i.childrenType === 'unordered')
    expect(ordered.length).toBeGreaterThan(0)
    expect(unordered.length).toBeGreaterThan(0)
  })

  it('normalizes items into lists array', () => {
    for (const project of imported.projects) {
      expect(Array.isArray(project.lists)).toBe(true)
      expect(project.lists.length).toBeGreaterThan(0)
    }
  })

  it('assigns parentId to all children', () => {
    function checkParentIds(items, expectedParentId = null) {
      for (const item of items) {
        expect(item.parentId).toBe(expectedParentId)
        if (item.children?.length) {
          checkParentIds(item.children, item.id)
        }
      }
    }
    for (const project of imported.projects) {
      checkParentIds(project.lists, null)
    }
  })

  it('all items have kind field', () => {
    for (const project of imported.projects) {
      const allItems = collectAllItems(project.lists)
      for (const item of allItems) {
        expect(item.kind).toBe('item')
      }
    }
  })

  it('preserves total item counts', () => {
    const p1Count = countItems(imported.projects[0].lists)
    const p2Count = countItems(imported.projects[1].lists)
    expect(p1Count).toBe(countItems(realExport.projects[0].items))
    expect(p2Count).toBe(countItems(realExport.projects[1].items))
  })

  it('preserves note counts', () => {
    const p1Notes = collectNotes(imported.projects[0].lists)
    expect(p1Notes.short).toBeGreaterThanOrEqual(8)
    expect(p1Notes.long).toBeGreaterThanOrEqual(7)

    const p2Notes = collectNotes(imported.projects[1].lists)
    expect(p2Notes.short).toBeGreaterThanOrEqual(5)
    expect(p2Notes.long).toBeGreaterThanOrEqual(10)
  })
})

describe('real export: store import flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('imports both projects into the store via importFromJSONFile pathway', async () => {
    const store = useOutlineStore()
    await store.initPromise

    const result = await importFromJSON(realExport)
    for (const project of result.projects) {
      if (!project.createdAt) project.createdAt = new Date().toISOString()
      if (!project.updatedAt) project.updatedAt = new Date().toISOString()
      store.projects.push(project)
    }

    expect(store.projects.find((p) => p.name === 'Pramanavartika')).toBeTruthy()
    expect(store.projects.find((p) => p.name === 'དོན་དུན་བཅུ་')).toBeTruthy()
  })

  it('imported project is selectable and loads settings', async () => {
    const store = useOutlineStore()
    await store.initPromise

    const result = await importFromJSON(realExport)
    const pramanavartika = result.projects[0]
    store.projects.push(pramanavartika)
    store.selectProject(pramanavartika.id)

    expect(store.currentProjectId).toBe(pramanavartika.id)
    expect(store.indentSize).toBe(39)
    expect(store.showIndentGuides).toBe(false)
    expect(store.showLongNotesInOutline).toBe(true)
  })

  it('imported project items are navigable', async () => {
    const store = useOutlineStore()
    await store.initPromise

    const result = await importFromJSON(realExport)
    const pramanavartika = result.projects[0]
    store.projects.push(pramanavartika)
    store.selectProject(pramanavartika.id)

    const firstItem = store.currentProject.lists[0]
    expect(firstItem.text).toContain('དང་པོ')
    expect(firstItem.children).toHaveLength(3)

    const next = store.findNextSibling(firstItem.id)
    expect(next).toBeTruthy()
    expect(next.id).toBe(store.currentProject.lists[1].id)
  })

  it('imported items support undo after mutation', async () => {
    const store = useOutlineStore()
    await store.initPromise

    const result = await importFromJSON(realExport)
    const p2 = result.projects[1]
    store.projects.push(p2)
    store.selectProject(p2.id)

    const originalText = store.currentProject.lists[0].text
    store.updateListItem(store.currentProject.lists[0].id, { text: 'Changed' })
    expect(store.currentProject.lists[0].text).toBe('Changed')

    store.undo()
    expect(store.currentProject.lists[0].text).toBe(originalText)
  })
})
