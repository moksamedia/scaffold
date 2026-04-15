import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject, makeDivider } from './fixtures/projects.js'

vi.mock('docx', () => {
  const state = {
    shouldThrow: false,
    documents: [],
    paragraphs: [],
  }

  class Document {
    constructor(options) {
      this.options = options
      state.documents.push(options)
    }
  }

  class Paragraph {
    constructor(options) {
      this.options = options
      state.paragraphs.push(options)
    }
  }

  class TextRun {
    constructor(options) {
      this.options = options
    }
  }

  const Packer = {
    async toBuffer() {
      if (state.shouldThrow) throw new Error('packer failed')
      return new Uint8Array([1, 2, 3])
    },
  }

  return {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel: { TITLE: 'TITLE' },
    AlignmentType: { LEFT: 'LEFT' },
    LevelFormat: { BULLET: 'BULLET', DECIMAL: 'DECIMAL', LOWER_LETTER: 'LOWER_LETTER', LOWER_ROMAN: 'LOWER_ROMAN' },
    convertInchesToTwip: (n) => n * 1440,
    __mockDocx: {
      reset() {
        state.shouldThrow = false
        state.documents = []
        state.paragraphs = []
      },
      setThrow(value) {
        state.shouldThrow = value
      },
      getState() {
        return state
      },
    },
  }
})

import { __mockDocx } from 'docx'
import { exportAsDocx } from 'src/utils/export/docx.js'

// We mock docx internals so we can assert semantic decisions (styles/numbering)
// without relying on brittle binary snapshot assertions.
describe('DOCX semantic structure', () => {
  beforeEach(() => {
    __mockDocx.reset()
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:mock-docx',
      revokeObjectURL: () => {},
    })
  })

  it('resets ordered numbering references after root divider', async () => {
    const project = makeProject({
      rootListType: 'ordered',
      lists: [
        makeItem({ id: 'a', text: 'Section A' }),
        makeDivider({ id: 'div-1' }),
        makeItem({ id: 'b', text: 'Section B' }),
      ],
    })

    await exportAsDocx(project)
    const refs = __mockDocx
      .getState()
      .paragraphs.map((p) => p?.numbering?.reference)
      .filter(Boolean)

    expect(refs).toContain('ordered-list-0')
    expect(refs).toContain('ordered-list-1')
  })

  it('maps blockquote content to Block Quotation style', async () => {
    const project = makeProject({
      lists: [
        makeItem({
          id: 'root',
          text: 'Root',
          longNotes: [
            {
              id: 'ln-1',
              text: '<div>before<blockquote>quoted line</blockquote>after</div>',
              collapsed: false,
            },
          ],
        }),
      ],
    })

    await exportAsDocx(project)
    const styles = __mockDocx
      .getState()
      .paragraphs.map((p) => p?.style)
      .filter(Boolean)

    expect(styles).toContain('Block Quotation')
    expect(styles).toContain('Comment')
  })

  it('uses fallback paragraph handling for plain text notes', async () => {
    const project = makeProject({
      lists: [
        makeItem({
          id: 'root',
          text: 'Root',
          longNotes: [{ id: 'ln-1', text: 'plain note text', collapsed: false }],
        }),
      ],
    })

    await exportAsDocx(project)
    const commentParagraphs = __mockDocx.getState().paragraphs.filter((p) => p?.style === 'Comment')
    expect(commentParagraphs.length).toBeGreaterThan(0)
  })

  it('logs error and returns when packing fails', async () => {
    // This protects the user experience path where export fails gracefully.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    __mockDocx.setThrow(true)

    await exportAsDocx(makeProject({ lists: [makeItem({ id: 'a' })] }))

    expect(errorSpy).toHaveBeenCalled()
  })
})
