import { describe, it, expect } from 'vitest'
import {
  exportAsJSON,
  importFromJSON,
  validateImportData,
  attachMediaPayload,
  ingestMediaPayload,
  collectExportRefHashes,
} from 'src/utils/export/json.js'
import {
  makeProject,
  makeItem,
  makeDivider,
  makeComplexProject,
  makeExportData,
} from './fixtures/projects.js'
import { ingestBlob } from 'src/utils/media/ingest.js'
import { getMediaAdapter } from 'src/utils/media/index.js'
import { buildMediaRef, MEDIA_REF_PROTOCOL } from 'src/utils/media/references.js'

// These tests treat JSON as a data contract, not just a utility output:
// if this breaks, backups/imports/migration safety are at risk.
describe('exportAsJSON', () => {
  it('produces valid envelope with formatVersion and application', () => {
    const project = makeProject({ lists: [makeItem()] })
    const result = exportAsJSON([project])

    expect(result.formatVersion).toBe('1.0')
    expect(result.application).toBe('Scaffold')
    expect(result.exportedAt).toBeTruthy()
    expect(result.projects).toHaveLength(1)
  })

  it('filters to selected project when id provided', () => {
    const p1 = makeProject({ id: 'a', name: 'A' })
    const p2 = makeProject({ id: 'b', name: 'B' })
    const result = exportAsJSON([p1, p2], 'b')

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].name).toBe('B')
  })

  it('exports all projects when no selectedProjectId', () => {
    const p1 = makeProject({ id: 'a' })
    const p2 = makeProject({ id: 'b' })
    const result = exportAsJSON([p1, p2])

    expect(result.projects).toHaveLength(2)
  })

  it('maps lists to items in export', () => {
    const item = makeItem({ id: 'x', text: 'Hello' })
    const project = makeProject({ lists: [item] })
    const result = exportAsJSON([project])

    expect(result.projects[0].items).toHaveLength(1)
    expect(result.projects[0].items[0].text).toBe('Hello')
    expect(result.projects[0].lists).toBeUndefined()
  })

  it('preserves divider kind and strips content', () => {
    const div = makeDivider({ id: 'div-x' })
    const project = makeProject({ lists: [div] })
    const result = exportAsJSON([project])
    const exported = result.projects[0].items[0]

    expect(exported.kind).toBe('divider')
    expect(exported.text).toBe('')
    expect(exported.shortNotes).toBeUndefined()
    expect(exported.longNotes).toBeUndefined()
    expect(exported.children).toBeUndefined()
  })

  it('exports notes correctly', () => {
    const item = makeItem({
      id: 'n1',
      shortNotes: [{ id: 's1', text: 'ref' }],
      longNotes: [{ id: 'l1', text: '<p>content</p>', collapsed: true }],
    })
    const result = exportAsJSON([makeProject({ lists: [item] })])
    const exported = result.projects[0].items[0]

    expect(exported.shortNotes).toHaveLength(1)
    expect(exported.shortNotes[0].text).toBe('ref')
    expect(exported.longNotes).toHaveLength(1)
    expect(exported.longNotes[0].collapsed).toBe(true)
  })

  it('recursively exports children', () => {
    const project = makeComplexProject()
    const result = exportAsJSON([project], project.id)
    const rootItems = result.projects[0].items

    expect(rootItems).toHaveLength(3)
    expect(rootItems[0].children).toHaveLength(2)
    expect(rootItems[0].children[0].children).toHaveLength(1)
  })

  it('provides default settings values', () => {
    const project = makeProject({ settings: {} })
    const result = exportAsJSON([project])
    const s = result.projects[0].settings

    expect(s.fontSize).toBe(14)
    expect(s.indentSize).toBe(32)
    expect(s.showIndentGuides).toBe(true)
  })
})

describe('validateImportData', () => {
  it('passes for valid data', () => {
    const data = makeExportData([makeProject()])
    const result = validateImportData(data)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails when formatVersion is missing', () => {
    const data = makeExportData([makeProject()])
    delete data.formatVersion
    const result = validateImportData(data)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing formatVersion')
  })

  it('fails when application is wrong', () => {
    const data = makeExportData([makeProject()])
    data.application = 'Other'
    const result = validateImportData(data)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('application'))).toBe(true)
  })

  it('fails when projects is not an array', () => {
    const data = makeExportData([makeProject()])
    data.projects = 'nope'
    const result = validateImportData(data)
    expect(result.valid).toBe(false)
  })

  it('validates required project fields', () => {
    const data = makeExportData([{ id: null, name: null }])
    data.projects = [{}]
    const result = validateImportData(data)
    expect(result.errors.some((e) => e.includes('Missing project ID'))).toBe(true)
    expect(result.errors.some((e) => e.includes('Missing project name'))).toBe(true)
  })

  it('validates fontSize bounds (10-50)', () => {
    const project = makeProject({ settings: { fontSize: 5 } })
    const data = makeExportData([project])
    const result = validateImportData(data)
    expect(result.errors.some((e) => e.includes('Invalid fontSize'))).toBe(true)
  })

  it('validates indentSize bounds (5-100)', () => {
    const project = makeProject({ settings: { indentSize: 200 } })
    const data = makeExportData([project])
    const result = validateImportData(data)
    expect(result.errors.some((e) => e.includes('Invalid indentSize'))).toBe(true)
  })

  it('validates tibetanFontSize bounds (8-100)', () => {
    const project = makeProject({ settings: { tibetanFontSize: 3 } })
    const data = makeExportData([project])
    const result = validateImportData(data)
    expect(result.errors.some((e) => e.includes('Invalid tibetanFontSize'))).toBe(true)
  })

  it('validates nonTibetanFontSize bounds (8-100)', () => {
    const project = makeProject({ settings: { nonTibetanFontSize: 200 } })
    const data = makeExportData([project])
    const result = validateImportData(data)
    expect(result.errors.some((e) => e.includes('Invalid nonTibetanFontSize'))).toBe(true)
  })

  it('warns for non-1.0 formatVersion', () => {
    const data = makeExportData([makeProject()], { formatVersion: '2.0' })
    const result = validateImportData(data)
    expect(result.warnings.some((w) => w.includes('2.0'))).toBe(true)
  })

  it('warns for old exports (> 6 months)', () => {
    const oldDate = new Date()
    oldDate.setMonth(oldDate.getMonth() - 7)
    const data = makeExportData([makeProject()], { exportedAt: oldDate.toISOString() })
    const result = validateImportData(data)
    expect(result.warnings.some((w) => w.includes('6 months'))).toBe(true)
  })
})

describe('importFromJSON', () => {
  it('throws on invalid data', async () => {
    await expect(importFromJSON({})).rejects.toThrow('Import validation failed')
  })

  it('returns normalized projects', async () => {
    const project = makeProject({
      lists: [
        makeItem({ id: 'i1', text: 'Hello', shortNotes: [{ id: 's1', text: 'note' }] }),
      ],
    })
    const data = makeExportData([project])
    const result = await importFromJSON(data)

    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].lists).toHaveLength(1)
    expect(result.projects[0].lists[0].text).toBe('Hello')
  })

  it('normalizes divider items (no children attached)', async () => {
    const div = makeDivider({ id: 'div-import' })
    const data = makeExportData([makeProject({ lists: [div] })])
    const result = await importFromJSON(data)
    const importedDiv = result.projects[0].lists[0]

    expect(importedDiv.kind).toBe('divider')
    expect(importedDiv.children).toEqual([])
    expect(importedDiv.shortNotes).toEqual([])
    expect(importedDiv.longNotes).toEqual([])
  })

  it('assigns parentId during normalization', async () => {
    // Parent linkage is required by store operations like outdent/move.
    const child = makeItem({ id: 'c1', text: 'child' })
    const parent = makeItem({ id: 'p1', text: 'parent', children: [child] })
    const data = makeExportData([makeProject({ lists: [parent] })])
    const result = await importFromJSON(data)

    expect(result.projects[0].lists[0].children[0].parentId).toBe('p1')
  })

  it('fills default settings when missing from import', async () => {
    const data = makeExportData([makeProject({ settings: {} })])
    const result = await importFromJSON(data)
    const s = result.projects[0].settings

    expect(s.fontSize).toBe(14)
    expect(s.indentSize).toBe(32)
    expect(s.tibetanFontFamily).toBe('Microsoft Himalaya')
    expect(s.nonTibetanFontSize).toBe(16)
  })

  it('preserves provided settings over defaults', async () => {
    const data = makeExportData([makeProject({ settings: { fontSize: 20, indentSize: 48 } })])
    const result = await importFromJSON(data)
    const s = result.projects[0].settings

    expect(s.fontSize).toBe(20)
    expect(s.indentSize).toBe(48)
  })
})

describe('export → import roundtrip', () => {
  it('preserves complex project structure', async () => {
    const original = makeComplexProject()
    const exported = exportAsJSON([original], original.id)
    const imported = await importFromJSON(exported)

    const p = imported.projects[0]
    expect(p.name).toBe(original.name)
    expect(p.rootListType).toBe(original.rootListType)
    expect(p.lists).toHaveLength(3)

    const root1 = p.lists[0]
    expect(root1.text).toBe('First root')
    expect(root1.children).toHaveLength(2)
    expect(root1.children[0].shortNotes).toHaveLength(1)
    expect(root1.children[1].longNotes).toHaveLength(1)
    expect(root1.children[0].children).toHaveLength(1)

    expect(p.lists[1].kind).toBe('divider')
    expect(p.lists[2].text).toBe('Second root')
  })

  it('preserves settings through roundtrip', async () => {
    const original = makeProject({
      settings: {
        fontSize: 18,
        indentSize: 40,
        tibetanFontSize: 24,
        nonTibetanFontColor: '#ff0000',
      },
    })
    const exported = exportAsJSON([original])
    const imported = await importFromJSON(exported)
    const s = imported.projects[0].settings

    expect(s.fontSize).toBe(18)
    expect(s.indentSize).toBe(40)
    expect(s.tibetanFontSize).toBe(24)
    expect(s.nonTibetanFontColor).toBe('#ff0000')
  })
})

// Optional version-history payload: opt-in field that lets a JSON export
// carry per-project saved version snapshots and round-trip them back on import.
describe('exportAsJSON with version history', () => {
  function makeVersion(projectId, overrides = {}) {
    const innerProject = makeProject({ id: projectId, name: 'Snapshot' })
    return {
      id: overrides.id || 'v1',
      projectId,
      name: overrides.name ?? null,
      timestamp: overrides.timestamp ?? 1700000000000,
      trigger: overrides.trigger || 'manual',
      stats: overrides.stats || { items: 1, notes: 0 },
      data: overrides.data || makeExportData([innerProject]),
    }
  }

  it('omits projectVersions when no versions provided', () => {
    const project = makeProject()
    const result = exportAsJSON([project], project.id)
    expect(result.projectVersions).toBeUndefined()
  })

  it('omits projectVersions when option points at empty arrays', () => {
    const project = makeProject()
    const result = exportAsJSON([project], project.id, {
      versionsByProjectId: { [project.id]: [] },
    })
    expect(result.projectVersions).toBeUndefined()
  })

  it('attaches versions for included projects only', () => {
    const p1 = makeProject({ id: 'p1' })
    const p2 = makeProject({ id: 'p2' })
    const result = exportAsJSON([p1, p2], 'p1', {
      versionsByProjectId: {
        p1: [makeVersion('p1')],
        p2: [makeVersion('p2')], // p2 not included in export → must be dropped
      },
    })

    expect(Object.keys(result.projectVersions)).toEqual(['p1'])
    expect(result.projectVersions.p1).toHaveLength(1)
  })

  it('serializes version metadata with sane defaults', () => {
    const project = makeProject()
    const v = makeVersion(project.id, { name: 'Manual', timestamp: 123, trigger: 'manual' })
    const result = exportAsJSON([project], project.id, {
      versionsByProjectId: { [project.id]: [v] },
    })

    const exported = result.projectVersions[project.id][0]
    expect(exported.id).toBe(v.id)
    expect(exported.projectId).toBe(project.id)
    expect(exported.timestamp).toBe(123)
    expect(exported.trigger).toBe('manual')
    expect(exported.stats).toEqual({ items: 1, notes: 0 })
    expect(exported.data).toBeTruthy()
  })
})

describe('validateImportData with projectVersions', () => {
  it('passes when projectVersions is an object of arrays', () => {
    const data = makeExportData([makeProject({ id: 'p1' })])
    data.projectVersions = { p1: [] }
    const result = validateImportData(data)
    expect(result.valid).toBe(true)
  })

  it('fails when projectVersions is not an object', () => {
    const data = makeExportData([makeProject({ id: 'p1' })])
    data.projectVersions = []
    const result = validateImportData(data)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('projectVersions must be an object'))).toBe(true)
  })

  it('fails when a projectVersions entry is not an array', () => {
    const data = makeExportData([makeProject({ id: 'p1' })])
    data.projectVersions = { p1: 'nope' }
    const result = validateImportData(data)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('projectVersions[p1]'))).toBe(true)
  })
})

describe('importFromJSON with projectVersions', () => {
  function makeStoredVersion(projectId, overrides = {}) {
    const innerProject = makeProject({ id: projectId, name: 'Snapshot' })
    return {
      id: overrides.id || 'v1',
      projectId,
      name: overrides.name ?? null,
      timestamp: overrides.timestamp ?? 1700000000000,
      trigger: overrides.trigger || 'manual',
      stats: overrides.stats || { items: 1, notes: 0 },
      data: overrides.data || makeExportData([innerProject]),
    }
  }

  it('returns empty projectVersions when payload omits the field (back-compat)', async () => {
    const data = makeExportData([makeProject()])
    const result = await importFromJSON(data)
    expect(result.projectVersions).toEqual({})
  })

  it('returns parsed versions grouped by original project id', async () => {
    const data = makeExportData([makeProject({ id: 'p1' })])
    data.projectVersions = {
      p1: [makeStoredVersion('p1', { id: 'va' }), makeStoredVersion('p1', { id: 'vb' })],
    }
    const result = await importFromJSON(data)
    expect(result.projectVersions.p1).toHaveLength(2)
    expect(result.projectVersions.p1[0].id).toBe('va')
  })

  it('skips malformed version entries with warnings rather than failing', async () => {
    const data = makeExportData([makeProject({ id: 'p1' })])
    data.projectVersions = {
      p1: [
        makeStoredVersion('p1', { id: 'good' }),
        { id: 'no-data', projectId: 'p1', timestamp: 100 },
        { /* no id */ projectId: 'p1', timestamp: 200, data: { projects: [makeProject()] } },
      ],
    }
    const result = await importFromJSON(data)
    expect(result.projectVersions.p1).toHaveLength(1)
    expect(result.projectVersions.p1[0].id).toBe('good')
    expect(result.warnings.filter((w) => w.startsWith('Skipped version'))).toHaveLength(2)
  })

  it('round-trips export → import to recover snapshots', async () => {
    const project = makeProject({ id: 'p1' })
    const storedVersion = makeStoredVersion('p1')
    const exported = exportAsJSON([project], project.id, {
      versionsByProjectId: { p1: [storedVersion] },
    })
    const imported = await importFromJSON(exported)

    expect(imported.projectVersions.p1).toHaveLength(1)
    const recovered = imported.projectVersions.p1[0]
    expect(recovered.id).toBe(storedVersion.id)
    expect(recovered.timestamp).toBe(storedVersion.timestamp)
    expect(recovered.data.projects[0].id).toBe('p1')
  })
})

// Media payload covers the bundling of long-note media bytes alongside
// the project payload. Exports must carry exactly the bytes referenced
// by the projects (and embedded version snapshots), and imports must
// hydrate them into the local media adapter so refs resolve afterwards.
describe('JSON export with media payload', () => {
  async function ingestImage(text) {
    const blob = new Blob([new TextEncoder().encode(text)], { type: 'image/png' })
    return ingestBlob(blob)
  }

  it('omits media field when no long-note refs are present', async () => {
    const project = makeProject({
      lists: [makeItem({ longNotes: [{ id: 'ln', text: '<p>plain</p>', collapsed: false }] })],
    })
    const exportData = exportAsJSON([project], project.id)
    await attachMediaPayload(exportData)
    expect(exportData.media).toBeUndefined()
  })

  it('attaches base64-encoded bytes for every referenced hash', async () => {
    const { hash: hashA } = await ingestImage('image-bytes-a')
    const { hash: hashB } = await ingestImage('image-bytes-b')
    const project = makeProject({
      lists: [
        makeItem({
          longNotes: [
            {
              id: 'ln1',
              text:
                `<p><img src="${buildMediaRef(hashA)}"></p>` +
                `<p><img src="${buildMediaRef(hashB)}"></p>`,
              collapsed: false,
            },
          ],
        }),
      ],
    })
    const exportData = exportAsJSON([project], project.id)
    await attachMediaPayload(exportData)

    expect(exportData.media).toBeDefined()
    expect(Object.keys(exportData.media).sort()).toEqual([hashA, hashB].sort())
    expect(typeof exportData.media[hashA].base64).toBe('string')
    expect(exportData.media[hashA].mime).toBe('image/png')
  })

  it('long-note HTML stays reference-only in the export payload', async () => {
    const { hash } = await ingestImage('only-once')
    const project = makeProject({
      lists: [
        makeItem({
          longNotes: [{ id: 'ln', text: `<img src="${buildMediaRef(hash)}">`, collapsed: false }],
        }),
      ],
    })
    const exportData = exportAsJSON([project], project.id)
    await attachMediaPayload(exportData)

    const serialized = JSON.stringify(exportData.projects)
    expect(serialized).toContain(MEDIA_REF_PROTOCOL)
    expect(serialized).not.toContain('data:image')
  })

  it('collectExportRefHashes finds refs inside embedded version snapshots', async () => {
    const { hash: liveHash } = await ingestImage('live-asset')
    const { hash: versionOnlyHash } = await ingestImage('version-asset')

    const project = makeProject({
      id: 'p1',
      lists: [
        makeItem({
          longNotes: [{ id: 'ln', text: `<img src="${buildMediaRef(liveHash)}">`, collapsed: false }],
        }),
      ],
    })

    const versionData = makeExportData([
      makeProject({
        id: 'p1',
        lists: [
          makeItem({
            longNotes: [
              { id: 'lnv', text: `<img src="${buildMediaRef(versionOnlyHash)}">`, collapsed: false },
            ],
          }),
        ],
      }),
    ])

    const exportData = exportAsJSON([project], project.id, {
      versionsByProjectId: {
        p1: [
          {
            id: 'v1',
            projectId: 'p1',
            timestamp: 1,
            stats: { items: 1, notes: 1 },
            data: versionData,
          },
        ],
      },
    })

    const refs = collectExportRefHashes(exportData)
    expect(refs.has(liveHash)).toBe(true)
    expect(refs.has(versionOnlyHash)).toBe(true)
  })
})

describe('JSON import with media payload', () => {
  it('ingests every media entry into the local adapter', async () => {
    const { hash } = await ingestBlob(
      new Blob([new TextEncoder().encode('hello-image')], { type: 'image/png' }),
    )

    const project = makeProject({
      lists: [
        makeItem({
          longNotes: [{ id: 'ln', text: `<img src="${buildMediaRef(hash)}">`, collapsed: false }],
        }),
      ],
    })
    const exported = exportAsJSON([project], project.id)
    await attachMediaPayload(exported)

    // Wipe the local adapter to simulate "fresh device receiving an export".
    const adapter = getMediaAdapter()
    for (const h of await adapter.listHashes()) {
      await adapter.delete(h)
    }
    expect(await adapter.has(hash)).toBe(false)

    const result = await importFromJSON(exported)
    expect(result.importedMediaCount).toBe(1)
    expect(await adapter.has(hash)).toBe(true)
  })

  it('skips malformed media entries with warnings rather than failing', async () => {
    const { hash } = await ingestBlob(
      new Blob([new TextEncoder().encode('skip-test')], { type: 'image/png' }),
    )
    const exported = exportAsJSON(
      [
        makeProject({
          lists: [
            makeItem({
              longNotes: [{ id: 'ln', text: `<img src="${buildMediaRef(hash)}">`, collapsed: false }],
            }),
          ],
        }),
      ],
      null,
    )
    exported.media = {
      [hash]: { mime: 'image/png', size: 9, base64: 'aGVsbG8=' },
      'not-a-hash': { mime: 'image/png', size: 0, base64: '' },
      [hash.slice(0, 63) + '!']: { mime: 'image/png', size: 0, base64: 'aaa' },
    }

    const result = await importFromJSON(exported)
    expect(result.importedMediaCount).toBe(1)
    const skipped = result.warnings.filter((w) => w.startsWith('Skipped media entry'))
    expect(skipped.length).toBeGreaterThanOrEqual(1)
  })

  it('legacy exports without a media field still import cleanly', async () => {
    const data = makeExportData([makeProject()])
    expect(data.media).toBeUndefined()
    const result = await importFromJSON(data)
    expect(result.importedMediaCount).toBe(0)
  })

  it('directly ingests via ingestMediaPayload helper for consumers that bypass importFromJSON', async () => {
    const { hash } = await ingestBlob(
      new Blob([new TextEncoder().encode('direct')], { type: 'image/png' }),
    )
    const adapter = getMediaAdapter()
    const exported = exportAsJSON(
      [makeProject({ lists: [makeItem({ longNotes: [{ id: 'ln', text: `<img src="${buildMediaRef(hash)}">`, collapsed: false }] })] })],
      null,
    )
    await attachMediaPayload(exported)

    for (const h of await adapter.listHashes()) {
      await adapter.delete(h)
    }
    const summary = await ingestMediaPayload(exported)
    expect(summary.imported).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(await adapter.has(hash)).toBe(true)
  })
})

describe('long-note collapsed background color', () => {
  it('exports project-level palette settings with normalized values', () => {
    const project = makeProject({
      settings: {
        longNoteColorRoot: '3366CC',
        longNoteRecentCustomColors: ['#abc', '#NOTHEX', '#11AABB'],
      },
    })
    const result = exportAsJSON([project])
    const s = result.projects[0].settings
    expect(s.longNoteColorRoot).toBe('#3366cc')
    expect(s.longNoteRecentCustomColors).toEqual(['#aabbcc', '#11aabb'])
  })

  it('falls back to default longNoteColorRoot when missing or invalid', () => {
    const noColor = makeProject({ settings: {} })
    const invalidColor = makeProject({ settings: { longNoteColorRoot: 'banana' } })
    const r1 = exportAsJSON([noColor])
    const r2 = exportAsJSON([invalidColor])
    expect(r1.projects[0].settings.longNoteColorRoot).toBe('#80aaff')
    expect(r2.projects[0].settings.longNoteColorRoot).toBe('#80aaff')
    expect(r1.projects[0].settings.longNoteRecentCustomColors).toEqual([])
  })

  it('exports per-note collapsedBgColor only when set, normalized to lowercase', () => {
    const item = makeItem({
      longNotes: [
        { id: 'a', text: '<p>x</p>', collapsed: true, collapsedBgColor: 'AABBCC' },
        { id: 'b', text: '<p>y</p>', collapsed: false },
        { id: 'c', text: '<p>z</p>', collapsed: true, collapsedBgColor: 'banana' },
      ],
    })
    const result = exportAsJSON([makeProject({ lists: [item] })])
    const exportedNotes = result.projects[0].items[0].longNotes
    expect(exportedNotes[0].collapsedBgColor).toBe('#aabbcc')
    expect(exportedNotes[1].collapsedBgColor).toBeUndefined()
    expect(exportedNotes[2].collapsedBgColor).toBeUndefined()
  })

  it('round-trips the long-note color settings and per-note color', async () => {
    const item = makeItem({
      longNotes: [
        { id: 'a', text: '<p>x</p>', collapsed: true, collapsedBgColor: '#aabbcc' },
        { id: 'b', text: '<p>y</p>', collapsed: false },
      ],
    })
    const original = makeProject({
      lists: [item],
      settings: {
        longNoteColorRoot: '#3366cc',
        longNoteRecentCustomColors: ['#aabbcc', '#112233'],
      },
    })

    const exported = exportAsJSON([original])
    const imported = await importFromJSON(exported)

    const importedSettings = imported.projects[0].settings
    expect(importedSettings.longNoteColorRoot).toBe('#3366cc')
    expect(importedSettings.longNoteRecentCustomColors).toEqual(['#aabbcc', '#112233'])

    const importedNotes = imported.projects[0].lists[0].longNotes
    expect(importedNotes[0].collapsedBgColor).toBe('#aabbcc')
    expect(importedNotes[1].collapsedBgColor).toBeUndefined()
  })

  it('fills longNote color defaults when importing legacy payloads without those fields', async () => {
    const data = makeExportData([makeProject({ settings: {} })])
    const imported = await importFromJSON(data)
    const s = imported.projects[0].settings
    expect(s.longNoteColorRoot).toBe('#80aaff')
    expect(s.longNoteRecentCustomColors).toEqual([])
  })
})
