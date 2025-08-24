export function exportAsMarkdown(project) {
  if (!project) return

  let markdown = `# ${project.name}\n\n`

  function processItems(items, level = 0, listType = 'unordered') {
    let result = ''

    items.forEach((item, index) => {
      const indent = '    '.repeat(level)

      // Generate list marker
      let marker
      if (listType === 'ordered') {
        marker = `${index + 1}. `
      } else {
        marker = '- '
      }

      // Add main item text
      result += `${indent}${marker}${item.text || 'Untitled'}`

      // Add short notes inline
      if (item.shortNotes && item.shortNotes.length > 0) {
        const shortNotesText = item.shortNotes.map((note) => note.text).join(', ')
        result += ` _(${shortNotesText})_`
      }

      result += '\n'

      // Add long notes as blockquotes
      if (item.longNotes && item.longNotes.length > 0) {
        item.longNotes.forEach((note) => {
          const noteText = stripHtmlForExport(note.text)
          if (noteText.trim()) {
            result += '\n'
            result += noteText
              .split('\n')
              .map((line) => `${indent}  > ${line.trim()}`)
              .join(`  \n${indent}  >  \n`)
            result += '\n'
          }
        })
      }

      // Recursively process children
      if (item.children && item.children.length > 0) {
        result += processItems(item.children, level + 1, item.childrenType)
      }
    })

    return result
  }

  function stripHtmlForExport(html) {
    if (!html) return ''

    // Convert common HTML tags to markdown equivalents
    let result = html
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<u[^>]*>(.*?)<\/u>/gi, '$1')

    // Handle blockquotes specially to preserve line breaks
    result = result.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, content) => {
      const cleanContent = content
        .replace(/<br[^>]*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]*>/g, '') // Remove remaining HTML tags
        .trim()

      // Split by lines and prefix each with > for markdown blockquote
      return cleanContent
    })

    // Handle remaining tags
    result = result
      .replace(/<ul[^>]*>/gi, '')
      .replace(/<\/ul>/gi, '')
      .replace(/<ol[^>]*>/gi, '')
      .replace(/<\/ol>/gi, '')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
      .trim()

    return result
  }

  markdown += processItems(project.lists, 0, project.rootListType)

  // Create and download file
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
