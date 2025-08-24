import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  convertInchesToTwip,
} from 'docx'

import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
if (typeof window !== 'undefined') {
  window.Buffer = Buffer
}

export async function exportAsDocx(project) {
  if (!project) return

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: '▪',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 3,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 4,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 5,
              format: LevelFormat.BULLET,
              text: '▪',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(3.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 6,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(3.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 7,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(4.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 8,
              format: LevelFormat.BULLET,
              text: '▪',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(4.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: '%3.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 3,
              format: LevelFormat.DECIMAL,
              text: '%4.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 4,
              format: LevelFormat.LOWER_LETTER,
              text: '%5.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 5,
              format: LevelFormat.LOWER_ROMAN,
              text: '%6.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(3.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 6,
              format: LevelFormat.DECIMAL,
              text: '%7.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(3.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 7,
              format: LevelFormat.LOWER_LETTER,
              text: '%8.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(4.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 8,
              format: LevelFormat.LOWER_ROMAN,
              text: '%9.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(4.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [
          // Project title
          new Paragraph({
            text: project.name,
            heading: HeadingLevel.TITLE,
            spacing: { after: 300 },
          }),
          // Process all items
          ...(await processItemsForDocx(
            project.lists,
            0,
            project.rootListType,
          )),
        ],
      },
    ],
  })

  async function processItemsForDocx(items, level = 0, listType = 'unordered') {
    const paragraphs = []

    for (let index = 0; index < items.length; index++) {
      const item = items[index]

      // Create main item paragraph
      const textRuns = [new TextRun(item.text || 'Untitled')]

      // Add short notes inline
      if (item.shortNotes && item.shortNotes.length > 0) {
        const shortNotesText = item.shortNotes.map((note) => note.text).join(', ')
        textRuns.push(new TextRun({ text: ` (${shortNotesText})`, italics: true }))
      }

      // Create the main paragraph with proper numbering/bullets
      const paragraph = new Paragraph({
        children: textRuns,
        numbering: {
          reference: listType === 'ordered' ? 'ordered-list' : 'bullet-list',
          level: Math.min(level, 8), // Support up to 9 levels (0-8)
        },
      })

      paragraphs.push(paragraph)

      // Add long notes
      if (item.longNotes && item.longNotes.length > 0) {
        for (const note of item.longNotes) {
          const noteText = stripHtmlForDocx(note.text)
          if (noteText.trim()) {
            paragraphs.push(
              new Paragraph({
                children: [new TextRun({ text: noteText, color: '666666' })],
                indent: {
                  left: convertInchesToTwip(0.5 * (level + 1)),
                },
                spacing: { before: 100, after: 100 },
              }),
            )
          }
        }
      }

      // Recursively process children
      if (item.children && item.children.length > 0) {
        const childParagraphs = await processItemsForDocx(
          item.children,
          level + 1,
          item.childrenType,
        )
        paragraphs.push(...childParagraphs)
      }
    }

    return paragraphs
  }

  function stripHtmlForDocx(html) {
    if (!html) return ''

    // Simple HTML to text conversion for DOCX
    return html
      .replace(/<br[^>]*>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .replace(/\n\s*\n/g, '\n') // Clean up multiple newlines
      .trim()
  }

  // Generate and download the document
  try {
    const buffer = await Packer.toBuffer(doc)
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.docx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Error generating DOCX:', error)
  }
}