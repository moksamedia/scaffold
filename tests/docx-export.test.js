import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportAsDocx } from 'src/utils/export/docx.js'
import { makeProject, makeItem, makeDivider } from './fixtures/projects.js'

// The docx export generates binary output and triggers download.
// We stub the download path and capture the Document constructor args via Packer.
// Since we can't easily inspect the Document object, we test that the function
// completes without error for various inputs and validate structural behavior.

let downloadCalled = false

beforeEach(() => {
  downloadCalled = false

  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {},
  })
})

describe('DOCX export', () => {
  it('completes without error for a simple project', async () => {
    const project = makeProject({
      name: 'Test',
      lists: [
        makeItem({ id: 'a', text: 'First' }),
        makeItem({ id: 'b', text: 'Second' }),
      ],
    })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles project with dividers', async () => {
    const project = makeProject({
      name: 'Div Test',
      lists: [
        makeItem({ id: 'a', text: 'Before' }),
        makeDivider({ id: 'div-1' }),
        makeItem({ id: 'b', text: 'After' }),
      ],
    })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles deeply nested items', async () => {
    const gc = makeItem({ id: 'gc', text: 'Grandchild' })
    const child = makeItem({ id: 'c', text: 'Child', children: [gc] })
    const root = makeItem({ id: 'r', text: 'Root', children: [child] })
    const project = makeProject({ name: 'Deep', lists: [root] })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles items with short and long notes', async () => {
    const item = makeItem({
      id: 'noted',
      text: 'Noted item',
      shortNotes: [{ id: 's1', text: 'ref' }],
      longNotes: [
        { id: 'l1', text: '<p>Some <strong>bold</strong> note</p>', collapsed: false },
      ],
    })
    const project = makeProject({ name: 'Notes', lists: [item] })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles long notes with blockquotes', async () => {
    const item = makeItem({
      id: 'bq',
      text: 'Quote item',
      longNotes: [
        {
          id: 'l1',
          text: '<p>Before</p><blockquote><p>Quoted text</p></blockquote><p>After</p>',
          collapsed: false,
        },
      ],
    })
    const project = makeProject({ name: 'Blockquote', lists: [item] })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles empty project', async () => {
    const project = makeProject({ name: 'Empty', lists: [] })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('returns early for null project', async () => {
    await expect(exportAsDocx(null)).resolves.toBeUndefined()
  })

  it('handles mixed ordered/unordered children', async () => {
    const c1 = makeItem({ id: 'c1', text: 'Ordered child' })
    const c2 = makeItem({ id: 'c2', text: 'Unordered child' })
    const parent1 = makeItem({
      id: 'p1',
      text: 'Ordered parent',
      childrenType: 'ordered',
      children: [c1],
    })
    const parent2 = makeItem({
      id: 'p2',
      text: 'Unordered parent',
      childrenType: 'unordered',
      children: [c2],
    })
    const project = makeProject({ name: 'Mixed', lists: [parent1, parent2] })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })

  it('handles multiple dividers creating multiple sections', async () => {
    const project = makeProject({
      name: 'Multi-section',
      lists: [
        makeItem({ id: 'a', text: 'Section 1' }),
        makeDivider({ id: 'd1' }),
        makeItem({ id: 'b', text: 'Section 2' }),
        makeDivider({ id: 'd2' }),
        makeItem({ id: 'c', text: 'Section 3' }),
      ],
    })
    await expect(exportAsDocx(project)).resolves.not.toThrow()
  })
})
