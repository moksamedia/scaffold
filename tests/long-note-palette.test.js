import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LONG_NOTE_BG_OPACITY,
  DEFAULT_LONG_NOTE_COLOR_ROOT,
  LONG_NOTE_BASE_BG,
  MAX_RECENT_CUSTOM_COLORS,
  PALETTE_SIZE,
  buildBackgroundCss,
  clampOpacity,
  generateComplementaryPalette,
  isValidHexColor,
  normalizeHexColor,
  pushRecentCustomColor,
} from 'src/utils/color/long-note-palette.js'

describe('normalizeHexColor', () => {
  it('lowercases and prefixes a 6-digit hex', () => {
    expect(normalizeHexColor('FFAABB')).toBe('#ffaabb')
    expect(normalizeHexColor('#FFAABB')).toBe('#ffaabb')
  })

  it('expands shorthand 3-digit hex into 6-digit form', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('abc')).toBe('#aabbcc')
  })

  it('returns null for invalid input', () => {
    expect(normalizeHexColor(null)).toBeNull()
    expect(normalizeHexColor(undefined)).toBeNull()
    expect(normalizeHexColor('')).toBeNull()
    expect(normalizeHexColor('#zzzzzz')).toBeNull()
    expect(normalizeHexColor('not a color')).toBeNull()
    expect(normalizeHexColor('#1234567')).toBeNull()
    expect(normalizeHexColor(123)).toBeNull()
  })
})

describe('isValidHexColor', () => {
  it('accepts valid hex strings', () => {
    expect(isValidHexColor('#aabbcc')).toBe(true)
    expect(isValidHexColor('AABBCC')).toBe(true)
    expect(isValidHexColor('#abc')).toBe(true)
  })

  it('rejects invalid input', () => {
    expect(isValidHexColor('#zzzzzz')).toBe(false)
    expect(isValidHexColor('')).toBe(false)
    expect(isValidHexColor(null)).toBe(false)
  })
})

describe('generateComplementaryPalette', () => {
  it('returns exactly 6 hex strings', () => {
    const palette = generateComplementaryPalette('#3366cc')
    expect(palette).toHaveLength(PALETTE_SIZE)
    palette.forEach((color) => {
      expect(isValidHexColor(color)).toBe(true)
    })
  })

  it('is deterministic for the same input', () => {
    const a = generateComplementaryPalette('#3366cc')
    const b = generateComplementaryPalette('#3366cc')
    expect(a).toEqual(b)
  })

  it('returns the same palette for normalized input variants', () => {
    expect(generateComplementaryPalette('#3366cc')).toEqual(
      generateComplementaryPalette('3366CC'),
    )
    expect(generateComplementaryPalette('#abc')).toEqual(
      generateComplementaryPalette('aabbcc'),
    )
  })

  it('falls back to the default root when input is invalid', () => {
    const fallback = generateComplementaryPalette(DEFAULT_LONG_NOTE_COLOR_ROOT)
    expect(generateComplementaryPalette('not a color')).toEqual(fallback)
    expect(generateComplementaryPalette(null)).toEqual(fallback)
    expect(generateComplementaryPalette('')).toEqual(fallback)
  })

  it('produces 6 distinct entries for a colored root', () => {
    const palette = generateComplementaryPalette('#3366cc')
    const unique = new Set(palette)
    expect(unique.size).toBe(palette.length)
  })

  it('clamps every swatch into a light, background-friendly band', () => {
    // High lightness keeps the swatches readable behind preview text.
    // Every channel should land above the dark-mid range (0.55+).
    const palette = generateComplementaryPalette('#003366')
    palette.forEach((hex) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const lightness = (max + min) / 2
      expect(lightness).toBeGreaterThanOrEqual(0.7)
    })
  })
})

describe('pushRecentCustomColor', () => {
  it('prepends a normalized color to an empty list', () => {
    expect(pushRecentCustomColor([], '#aabbcc')).toEqual(['#aabbcc'])
    expect(pushRecentCustomColor(null, 'AABBCC')).toEqual(['#aabbcc'])
    expect(pushRecentCustomColor(undefined, '#abc')).toEqual(['#aabbcc'])
  })

  it('moves a duplicate to the front and dedupes case-insensitively', () => {
    const next = pushRecentCustomColor(['#112233', '#aabbcc', '#445566'], 'AABBCC')
    expect(next).toEqual(['#aabbcc', '#112233', '#445566'])
  })

  it('caps the list at MAX_RECENT_CUSTOM_COLORS entries', () => {
    const seed = ['#111111', '#222222', '#333333', '#444444', '#555555']
    const next = pushRecentCustomColor(seed, '#666666')
    expect(next).toHaveLength(MAX_RECENT_CUSTOM_COLORS)
    expect(next[0]).toBe('#666666')
    expect(next).not.toContain('#555555')
  })

  it('returns a normalized copy of the existing list when input is invalid', () => {
    const next = pushRecentCustomColor(['AABBCC', 'not-a-color'], 'still-not-a-color')
    expect(next).toEqual(['#aabbcc'])
  })
})

describe('clampOpacity', () => {
  it('passes through values inside [0,1]', () => {
    expect(clampOpacity(0)).toBe(0)
    expect(clampOpacity(0.5)).toBe(0.5)
    expect(clampOpacity(1)).toBe(1)
  })

  it('clamps out-of-range numbers', () => {
    expect(clampOpacity(-0.5)).toBe(0)
    expect(clampOpacity(2)).toBe(1)
  })

  it('falls back to the default for non-numeric / null / undefined', () => {
    expect(clampOpacity(undefined)).toBe(DEFAULT_LONG_NOTE_BG_OPACITY)
    expect(clampOpacity(null)).toBe(DEFAULT_LONG_NOTE_BG_OPACITY)
    expect(clampOpacity('not-a-number')).toBe(DEFAULT_LONG_NOTE_BG_OPACITY)
    expect(clampOpacity(NaN)).toBe(DEFAULT_LONG_NOTE_BG_OPACITY)
  })
})

describe('buildBackgroundCss', () => {
  it('returns the solid hex when opacity is 1', () => {
    expect(buildBackgroundCss('#aabbcc', 1)).toBe('#aabbcc')
    expect(buildBackgroundCss('AABBCC')).toBe('#aabbcc')
  })

  it('returns the base surface color when opacity is 0', () => {
    expect(buildBackgroundCss('#aabbcc', 0)).toBe(LONG_NOTE_BASE_BG)
  })

  it('layers a translucent tint over the base surface for opacity in (0,1)', () => {
    const css = buildBackgroundCss('#aabbcc', 0.5)
    expect(css).toContain('rgba(170, 187, 204, 0.5)')
    expect(css).toContain(LONG_NOTE_BASE_BG)
    expect(css.startsWith('linear-gradient(')).toBe(true)
  })

  it('honors a custom base surface color', () => {
    const css = buildBackgroundCss('#aabbcc', 0.5, '#ffffff')
    expect(css).toContain('#ffffff')
  })

  it('returns null for invalid color input', () => {
    expect(buildBackgroundCss('banana', 0.5)).toBeNull()
    expect(buildBackgroundCss(null, 0.5)).toBeNull()
  })

  it('clamps invalid opacity to the default', () => {
    expect(buildBackgroundCss('#aabbcc', 'not-a-number')).toBe('#aabbcc')
  })
})
