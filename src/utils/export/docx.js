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

  // First pass: determine maximum nesting depth
  function getMaxDepth(items, currentDepth = 0) {
    let maxDepth = currentDepth
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        const childDepth = getMaxDepth(item.children, currentDepth + 1)
        maxDepth = Math.max(maxDepth, childDepth)
      }
    }
    return maxDepth
  }

  const maxDepth = getMaxDepth(project.lists)

  // Generate bullet list levels dynamically
  function generateBulletLevels(
    maxLevel,
    baseIndent = 0.25,
    indentIncrement = 0.25,
    hangingIndent = 0.125,
  ) {
    const bulletSymbols = ['•', '◦', '▪']
    const levels = []

    for (let i = 0; i <= maxLevel; i++) {
      levels.push({
        level: i,
        format: LevelFormat.BULLET,
        text: bulletSymbols[i % bulletSymbols.length],
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: {
              left: convertInchesToTwip(baseIndent + i * indentIncrement),
              hanging: convertInchesToTwip(hangingIndent),
            },
          },
        },
      })
    }
    return levels
  }

  // Generate ordered list levels dynamically
  function generateOrderedLevels(
    maxLevel,
    baseIndent = 0.25,
    indentIncrement = 0.25,
    hangingIndent = 0.125,
  ) {
    const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN]
    const levels = []

    for (let i = 0; i <= maxLevel; i++) {
      levels.push({
        level: i,
        format: formats[i % formats.length],
        text: `%${i + 1}.`,
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: {
              left: convertInchesToTwip(baseIndent + i * indentIncrement),
              hanging: convertInchesToTwip(hangingIndent),
            },
          },
        },
      })
    }
    return levels
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: generateBulletLevels(maxDepth),
        },
        {
          reference: 'ordered-list',
          levels: generateOrderedLevels(maxDepth),
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
          ...(await processItemsForDocx(project.lists, 0, project.rootListType)),
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
        style: 'List Paragraph',
        numbering: {
          reference: listType === 'ordered' ? 'ordered-list' : 'bullet-list',
          level: level, // Use actual level - no artificial limit
        },
      })

      paragraphs.push(paragraph)

      // Add long notes
      if (item.longNotes && item.longNotes.length > 0) {
        for (const note of item.longNotes) {
          const noteParagraphs = parseHtmlToDocxParagraphs(note.text, level)
          paragraphs.push(...noteParagraphs)
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

  function parseHtmlToDocxParagraphs(html, level) {
    if (!html || !html.trim()) return []

    const paragraphs = []

    // Split by paragraph/div tags, preserving content
    const paragraphMatches = html.split(/<\/p>|<\/div>/i)

    for (let i = 0; i < paragraphMatches.length; i++) {
      let paragraphContent = paragraphMatches[i].replace(/<p[^>]*>|<div[^>]*>/i, '').trim()

      if (paragraphContent) {
        // Check for blockquotes within this paragraph
        const blockquoteRegex = /<blockquote[^>]*>(.*?)<\/blockquote>/gis
        let lastIndex = 0
        let match
        let hasBlockquote = false

        while ((match = blockquoteRegex.exec(paragraphContent)) !== null) {
          hasBlockquote = true

          // Add content before the blockquote as a regular paragraph
          const beforeQuote = paragraphContent.substring(lastIndex, match.index).trim()
          if (beforeQuote) {
            const textRuns = parseFormattedText(beforeQuote)
            if (textRuns.length > 0) {
              paragraphs.push(
                new Paragraph({
                  children: textRuns,
                  style: 'Comment',
                  indent: {
                    left: convertInchesToTwip(0.25 + (level + 1) * 0.25),
                  },
                  spacing: { before: 100, after: 100 },
                }),
              )
            }
          }

          // Add the blockquote content as an indented paragraph
          const quoteContent = match[1].trim()
          if (quoteContent) {
            const quoteTextRuns = parseFormattedText(quoteContent)
            if (quoteTextRuns.length > 0) {
              paragraphs.push(
                new Paragraph({
                  children: quoteTextRuns,
                  style: 'Block Quotation',
                  indent: {
                    left: convertInchesToTwip(0.25 + (level + 2) * 0.25), // Extra indent for quotes
                  },
                  spacing: { before: 100, after: 100 },
                }),
              )
            }
          }

          lastIndex = blockquoteRegex.lastIndex
        }

        if (hasBlockquote) {
          // Add any remaining content after the last blockquote
          const afterQuote = paragraphContent.substring(lastIndex).trim()
          if (afterQuote) {
            const textRuns = parseFormattedText(afterQuote)
            if (textRuns.length > 0) {
              paragraphs.push(
                new Paragraph({
                  children: textRuns,
                  style: 'Comment',
                  indent: {
                    left: convertInchesToTwip(0.25 + (level + 1) * 0.25),
                  },
                  spacing: { before: 100, after: 100 },
                }),
              )
            }
          }
        } else {
          // If no blockquotes were found, treat as regular paragraph
          const textRuns = parseFormattedText(paragraphContent)
          if (textRuns.length > 0) {
            paragraphs.push(
              new Paragraph({
                children: textRuns,
                style: 'Comment',
                indent: {
                  left: convertInchesToTwip(0.25 + (level + 1) * 0.25),
                },
                spacing: { before: 100, after: 100 },
              }),
            )
          }
        }
      }
    }

    // If no paragraph tags found, treat as single paragraph
    if (paragraphs.length === 0 && html.trim()) {
      const textRuns = parseFormattedText(html)
      if (textRuns.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: textRuns,
            style: 'Comment',
            indent: {
              left: convertInchesToTwip(0.25 + (level + 1) * 0.25),
            },
            spacing: { before: 100, after: 100 },
          }),
        )
      }
    }

    return paragraphs
  }

  function parseFormattedText(html) {
    if (!html) return []

    // Simple parsing for basic formatting
    const textRuns = []
    let currentText = html

    // Handle line breaks
    currentText = currentText.replace(/<br[^>]*>/gi, '\n')

    // For now, create a single text run with basic formatting stripped
    // This could be enhanced to preserve bold, italic, etc.
    const cleanText = currentText
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '$1')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '$1')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '$1')
      .replace(/<[^>]*>/g, '') // Remove remaining HTML tags
      .trim()

    if (cleanText) {
      // Split by line breaks and create separate text runs with breaks
      const lines = cleanText.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          textRuns.push(new TextRun({ text: lines[i].trim(), color: '666666' }))
        }
        // Add line break after each line except the last
        if (i < lines.length - 1) {
          textRuns.push(new TextRun({ text: '', break: 1 }))
        }
      }
    }

    return textRuns
  }

  /*
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
      */

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
