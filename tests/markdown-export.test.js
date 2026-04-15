import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportAsMarkdown } from 'src/utils/export/markdown.js'
import { makeProject, makeItem, makeDivider } from './fixtures/projects.js'

let capturedMarkdown = ''

beforeEach(() => {
  capturedMarkdown = ''

  // Intercept Blob constructor to capture generated markdown
  vi.stubGlobal(
    'Blob',
    class MockBlob {
      constructor(parts) {
        capturedMarkdown = parts.join('')
      }
    },
  )
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {},
  })
})

function getMarkdown(project) {
  exportAsMarkdown(project)
  return capturedMarkdown
}

describe('Markdown export', () => {
  it('includes project title as h1', () => {
    const md = getMarkdown(makeProject({ name: 'My Project', lists: [] }))
    expect(md).toContain('# My Project')
  })

  it('renders ordered list items with numbering', () => {
    const items = [
      makeItem({ id: 'a', text: 'First' }),
      makeItem({ id: 'b', text: 'Second' }),
    ]
    const md = getMarkdown(makeProject({ lists: items, rootListType: 'ordered' }))
    expect(md).toContain('1. First')
    expect(md).toContain('2. Second')
  })

  it('renders unordered list items with dash', () => {
    const items = [makeItem({ id: 'a', text: 'Bullet' })]
    const md = getMarkdown(makeProject({ lists: items, rootListType: 'unordered' }))
    expect(md).toContain('- Bullet')
  })

  it('renders nested items with indentation', () => {
    const child = makeItem({ id: 'c1', text: 'Child', parentId: 'p1' })
    const parent = makeItem({
      id: 'p1',
      text: 'Parent',
      childrenType: 'unordered',
      children: [child],
    })
    const md = getMarkdown(makeProject({ lists: [parent], rootListType: 'ordered' }))
    expect(md).toContain('1. Parent')
    expect(md).toContain('    - Child')
  })

  it('renders short notes inline in italics', () => {
    const item = makeItem({
      id: 'a',
      text: 'Item',
      shortNotes: [{ id: 's1', text: 'page 42' }],
    })
    const md = getMarkdown(makeProject({ lists: [item] }))
    expect(md).toContain('_(page 42)_')
  })

  it('renders long notes as blockquotes', () => {
    const item = makeItem({
      id: 'a',
      text: 'Item',
      longNotes: [{ id: 'l1', text: '<p>A note</p>', collapsed: false }],
    })
    const md = getMarkdown(makeProject({ lists: [item] }))
    expect(md).toContain('> ')
    expect(md).toContain('A note')
  })

  it('converts bold/italic HTML to markdown', () => {
    const item = makeItem({
      id: 'a',
      text: 'Item',
      longNotes: [
        { id: 'l1', text: '<p><strong>bold</strong> and <em>italic</em></p>', collapsed: false },
      ],
    })
    const md = getMarkdown(makeProject({ lists: [item] }))
    expect(md).toContain('**bold**')
    expect(md).toContain('*italic*')
  })

  it('renders dividers as horizontal rules and resets numbering', () => {
    const items = [
      makeItem({ id: 'a', text: 'Before' }),
      makeDivider({ id: 'div-1' }),
      makeItem({ id: 'b', text: 'After' }),
    ]
    const md = getMarkdown(makeProject({ lists: items, rootListType: 'ordered' }))
    expect(md).toContain('1. Before')
    expect(md).toContain('---')
    expect(md).toContain('1. After')
  })

  it('renders deeply nested structures correctly', () => {
    const grandchild = makeItem({ id: 'gc', text: 'GC', parentId: 'c' })
    const child = makeItem({
      id: 'c',
      text: 'C',
      parentId: 'r',
      childrenType: 'ordered',
      children: [grandchild],
    })
    const root = makeItem({
      id: 'r',
      text: 'R',
      childrenType: 'unordered',
      children: [child],
    })
    const md = getMarkdown(makeProject({ lists: [root], rootListType: 'ordered' }))
    expect(md).toContain('1. R')
    expect(md).toContain('    - C')
    expect(md).toContain('        1. GC')
  })

  it('does not render for null project', () => {
    exportAsMarkdown(null)
    expect(capturedMarkdown).toBe('')
  })
})
