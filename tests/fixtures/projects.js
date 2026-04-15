/**
 * Canonical test fixtures for project data structures.
 * Used across unit and integration tests to provide consistent,
 * representative data for assertions.
 */

export function makeItem(overrides = {}) {
  return {
    id: overrides.id || 'item-1',
    kind: 'item',
    text: overrides.text || 'Test item',
    collapsed: false,
    childrenType: overrides.childrenType || 'ordered',
    shortNotes: overrides.shortNotes || [],
    longNotes: overrides.longNotes || [],
    children: overrides.children || [],
    parentId: overrides.parentId || null,
  }
}

export function makeDivider(overrides = {}) {
  return {
    id: overrides.id || 'div-1',
    kind: 'divider',
    text: '',
    collapsed: false,
    childrenType: 'ordered',
    shortNotes: [],
    longNotes: [],
    children: [],
    parentId: null,
  }
}

export function makeProject(overrides = {}) {
  return {
    id: overrides.id || 'proj-1',
    name: overrides.name || 'Test Project',
    createdAt: overrides.createdAt || '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2024-01-01T00:00:00.000Z',
    rootListType: overrides.rootListType || 'ordered',
    lists: overrides.lists || [],
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
      ...(overrides.settings || {}),
    },
  }
}

export function makeExportData(projects, overrides = {}) {
  return {
    formatVersion: overrides.formatVersion || '1.0',
    exportedAt: overrides.exportedAt || new Date().toISOString(),
    application: overrides.application || 'Scaffold',
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      rootListType: p.rootListType || 'ordered',
      settings: p.settings || {},
      items: p.lists || p.items || [],
    })),
  }
}

/** A project with nested items, dividers, and notes for comprehensive tests. */
export function makeComplexProject() {
  const child1 = makeItem({
    id: 'child-1',
    text: 'Child A',
    parentId: 'root-1',
    childrenType: 'unordered',
    shortNotes: [{ id: 'sn-1', text: 'page 42' }],
  })
  const child2 = makeItem({
    id: 'child-2',
    text: 'Child B',
    parentId: 'root-1',
    longNotes: [
      {
        id: 'ln-1',
        text: '<p>Some <strong>bold</strong> note</p>',
        collapsed: false,
      },
    ],
  })
  const grandchild = makeItem({
    id: 'grandchild-1',
    text: 'Grandchild',
    parentId: 'child-1',
  })
  child1.children = [grandchild]

  const rootItem1 = makeItem({
    id: 'root-1',
    text: 'First root',
    children: [child1, child2],
  })
  const divider = makeDivider({ id: 'div-1' })
  const rootItem2 = makeItem({
    id: 'root-2',
    text: 'Second root',
  })

  return makeProject({
    id: 'complex-proj',
    name: 'Complex Project',
    lists: [rootItem1, divider, rootItem2],
  })
}

/** Legacy project shape before migration (missing kind, uses type instead of childrenType). */
export function makeLegacyProject() {
  return {
    id: 'legacy-proj',
    name: 'Legacy Project',
    createdAt: '2023-06-01T00:00:00.000Z',
    updatedAt: '2023-06-01T00:00:00.000Z',
    lists: [
      {
        id: 'leg-item-1',
        text: 'Old item',
        collapsed: false,
        type: 'unordered',
        shortNotes: [],
        longNotes: [],
        children: [
          {
            id: 'leg-item-2',
            text: 'Old child',
            collapsed: false,
            shortNotes: [],
            longNotes: [],
            children: [],
          },
        ],
      },
    ],
  }
}
