import { describe, it, expect } from 'vitest'
import {
  MEDIA_REF_PROTOCOL,
  buildMediaRef,
  isMediaRef,
  parseMediaRef,
  extractRefHashesFromHtml,
  collectProjectRefHashes,
  rewriteDataUrisToRefs,
  rewriteRefsWith,
  normalizeHtmlToRefs,
  transformLongNoteHtmlInPlace,
} from 'src/utils/media/references.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

describe('media reference helpers', () => {
  it('buildMediaRef produces a scaffold-media:// URI', () => {
    expect(buildMediaRef(HASH_A)).toBe(`${MEDIA_REF_PROTOCOL}${HASH_A}`)
    expect(isMediaRef(buildMediaRef(HASH_A))).toBe(true)
  })

  it('parseMediaRef returns hash for valid ref, null otherwise', () => {
    expect(parseMediaRef(buildMediaRef(HASH_A))).toBe(HASH_A)
    expect(parseMediaRef('https://example.com/img.png')).toBeNull()
    expect(parseMediaRef(`${MEDIA_REF_PROTOCOL}not-a-hash`)).toBeNull()
  })

  it('extractRefHashesFromHtml finds every embedded ref', () => {
    const html = `<p>x</p><img src="${buildMediaRef(HASH_A)}"><audio src="${buildMediaRef(HASH_B)}"></audio>`
    const hashes = extractRefHashesFromHtml(html)
    expect(hashes.sort()).toEqual([HASH_A, HASH_B].sort())
  })

  it('extractRefHashesFromHtml is empty for non-string or empty input', () => {
    expect(extractRefHashesFromHtml('')).toEqual([])
    expect(extractRefHashesFromHtml(null)).toEqual([])
    expect(extractRefHashesFromHtml('<p>nothing</p>')).toEqual([])
  })
})

describe('collectProjectRefHashes', () => {
  it('walks lists and children of multiple projects', () => {
    const projects = [
      {
        lists: [
          {
            longNotes: [{ text: `<img src="${buildMediaRef(HASH_A)}">` }],
            children: [
              {
                longNotes: [{ text: `<audio src="${buildMediaRef(HASH_B)}"></audio>` }],
                children: [],
              },
            ],
          },
        ],
      },
      {
        items: [
          { longNotes: [{ text: `<img src="${buildMediaRef(HASH_C)}">` }], children: [] },
        ],
      },
    ]
    const set = collectProjectRefHashes(projects)
    expect([...set].sort()).toEqual([HASH_A, HASH_B, HASH_C].sort())
  })

  it('returns empty set for missing or malformed input', () => {
    expect(collectProjectRefHashes(null).size).toBe(0)
    expect(collectProjectRefHashes([{}]).size).toBe(0)
    expect(collectProjectRefHashes([{ lists: 'nope' }]).size).toBe(0)
  })
})

describe('rewriteDataUrisToRefs', () => {
  it('replaces data URIs in img/audio src with scaffold-media refs via ingest', async () => {
    const html =
      '<p>x</p>' +
      '<img src="data:image/png;base64,abc">' +
      '<audio src="data:audio/mp3;base64,def"></audio>' +
      '<img src="data:image/jpeg;base64,ghi">'

    const ingested = []
    const fakeIngest = async (dataUrl, mime, kind) => {
      ingested.push({ dataUrl, mime, kind })
      if (mime === 'image/png') return HASH_A
      if (mime === 'audio/mp3') return HASH_B
      if (mime === 'image/jpeg') return HASH_C
      return null
    }

    const out = await rewriteDataUrisToRefs(html, fakeIngest)
    expect(out).toContain(buildMediaRef(HASH_A))
    expect(out).toContain(buildMediaRef(HASH_B))
    expect(out).toContain(buildMediaRef(HASH_C))
    expect(out).not.toContain('data:image/png')
    expect(out).not.toContain('data:audio/mp3')
    expect(ingested).toHaveLength(3)
  })

  it('returns input unchanged when no data URIs present', async () => {
    const html = `<p>plain</p><img src="${buildMediaRef(HASH_A)}">`
    const out = await rewriteDataUrisToRefs(html, async () => {
      throw new Error('should not call')
    })
    expect(out).toBe(html)
  })

  it('skips elements when ingest returns a non-hash', async () => {
    const html = '<img src="data:image/png;base64,xyz">'
    const out = await rewriteDataUrisToRefs(html, async () => 'not-a-valid-hash')
    expect(out).toBe(html)
  })
})

describe('rewriteRefsWith', () => {
  it('substitutes refs using the provided resolver', () => {
    const html = `<img src="${buildMediaRef(HASH_A)}"><audio src="${buildMediaRef(HASH_B)}"></audio>`
    const out = rewriteRefsWith(html, (hash) => `blob:fake/${hash.slice(0, 8)}`)
    expect(out).toContain('blob:fake/aaaaaaaa')
    expect(out).toContain('blob:fake/bbbbbbbb')
    expect(out).not.toContain(MEDIA_REF_PROTOCOL)
  })

  it('tags rewritten elements with data-media-hash when requested', () => {
    const html = `<img src="${buildMediaRef(HASH_A)}">`
    const out = rewriteRefsWith(html, () => 'blob:replaced', { tagWithHash: true })
    expect(out).toContain(`data-media-hash="${HASH_A}"`)
    expect(out).toContain('src="blob:replaced"')
  })

  it('leaves elements alone when resolver returns null', () => {
    const html = `<img src="${buildMediaRef(HASH_A)}">`
    const out = rewriteRefsWith(html, () => null)
    expect(out).toBe(html)
  })
})

describe('normalizeHtmlToRefs', () => {
  it('collapses tagged blob URLs back to refs', async () => {
    const html =
      `<img src="blob:scaffold/1" data-media-hash="${HASH_A}">` +
      `<audio src="blob:scaffold/2" data-media-hash="${HASH_B}"></audio>`
    const out = await normalizeHtmlToRefs(html, async () => {
      throw new Error('ingest should not be called for tagged elements')
    })
    expect(out).toContain(buildMediaRef(HASH_A))
    expect(out).toContain(buildMediaRef(HASH_B))
    expect(out).not.toContain('blob:scaffold')
    expect(out).not.toContain('data-media-hash')
  })

  it('ingests any inline data URIs encountered during save', async () => {
    const html = '<img src="data:image/png;base64,zzz">'
    const out = await normalizeHtmlToRefs(html, async () => HASH_C)
    expect(out).toContain(buildMediaRef(HASH_C))
    expect(out).not.toContain('data:image/png')
  })

  it('preserves untagged blob/http URLs untouched', async () => {
    const html =
      '<img src="https://example.com/x.png">' +
      '<img src="blob:scaffold/9">'
    const out = await normalizeHtmlToRefs(html, async () => {
      throw new Error('should not be called for non-tagged')
    })
    expect(out).toContain('https://example.com/x.png')
    expect(out).toContain('blob:scaffold/9')
  })
})

describe('transformLongNoteHtmlInPlace', () => {
  it('walks lists/children and replaces note text where transform changes it', async () => {
    const items = [
      {
        longNotes: [{ text: 'one' }, { text: 'two' }],
        children: [
          {
            longNotes: [{ text: 'three' }],
            children: [],
          },
        ],
      },
    ]
    const changed = await transformLongNoteHtmlInPlace(items, async (html) =>
      html.toUpperCase(),
    )
    expect(changed).toBe(true)
    expect(items[0].longNotes[0].text).toBe('ONE')
    expect(items[0].longNotes[1].text).toBe('TWO')
    expect(items[0].children[0].longNotes[0].text).toBe('THREE')
  })

  it('returns false when nothing is rewritten', async () => {
    const items = [{ longNotes: [{ text: 'leave-me-alone' }], children: [] }]
    const changed = await transformLongNoteHtmlInPlace(items, async (html) => html)
    expect(changed).toBe(false)
    expect(items[0].longNotes[0].text).toBe('leave-me-alone')
  })
})
