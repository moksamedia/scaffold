/**
 * Long-note collapsed background palette utilities.
 *
 * The user picks a single "root" color per project; from it we
 * deterministically derive 6 complementary swatches that sit in a
 * background-friendly luminance / saturation band so they read well
 * behind preview text. The user can also pick fully custom colors;
 * the 5 most recent custom picks are remembered per project.
 *
 * All public helpers are pure so the UI can render them reactively
 * and tests can assert exact outputs.
 */

const HUE_OFFSETS = [0, 60, 120, 180, 240, 300]
const TARGET_LIGHTNESS = 0.88
const SATURATION_MIN = 0.2
const SATURATION_MAX = 0.6
const FALLBACK_SATURATION = 0.4

export const PALETTE_SIZE = HUE_OFFSETS.length
export const MAX_RECENT_CUSTOM_COLORS = 5
export const DEFAULT_LONG_NOTE_COLOR_ROOT = '#80aaff'
export const DEFAULT_LONG_NOTE_BG_OPACITY = 1
/** Default surface color the tint is layered over so opacity behaves
 *  intuitively as "tint strength" rather than letting the page show
 *  through. Mirrors the `.long-note` CSS rule. */
export const LONG_NOTE_BASE_BG = '#f5f5f5'

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null
  let v = value.trim().toLowerCase()
  if (!v) return null
  if (!v.startsWith('#')) v = `#${v}`
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = `#${v.slice(1).split('').map((c) => c + c).join('')}`
  }
  if (!/^#[0-9a-f]{6}$/.test(v)) return null
  return v
}

export function isValidHexColor(value) {
  return normalizeHexColor(value) !== null
}

function hexToRgb(hex) {
  const norm = normalizeHexColor(hex)
  if (!norm) return null
  return {
    r: parseInt(norm.slice(1, 3), 16) / 255,
    g: parseInt(norm.slice(3, 5), 16) / 255,
    b: parseInt(norm.slice(5, 7), 16) / 255,
  }
}

function rgbToHex({ r, g, b }) {
  const toByte = (v) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255)
    return n.toString(16).padStart(2, '0')
  }
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}

function rgbToHsl({ r, g, b }) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0)
    } else if (max === g) {
      h = (b - r) / d + 2
    } else {
      h = (r - g) / d + 4
    }
    h /= 6
  }
  return { h, s, l }
}

function hslToRgb({ h, s, l }) {
  if (s === 0) return { r: l, g: l, b: l }
  const hueToRgb = (p, q, t) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToRgb(p, q, h + 1 / 3),
    g: hueToRgb(p, q, h),
    b: hueToRgb(p, q, h - 1 / 3),
  }
}

/**
 * Derive an array of 6 complementary, background-friendly hex colors
 * from a single root color. The first element is anchored to the root
 * hue; subsequent entries rotate around the color wheel by 60°
 * increments. All entries share a high lightness and a saturation
 * clamped into a soft pastel band so they remain readable as
 * collapsed-note backgrounds.
 *
 * Invalid input falls back to {@link DEFAULT_LONG_NOTE_COLOR_ROOT}.
 *
 * @param {string} rootColor hex color (with or without leading #).
 * @returns {string[]} array of 6 normalized hex strings.
 */
export function generateComplementaryPalette(rootColor) {
  const rgb = hexToRgb(rootColor) || hexToRgb(DEFAULT_LONG_NOTE_COLOR_ROOT)
  const hsl = rgbToHsl(rgb)
  const sourceSat = hsl.s > 0 ? hsl.s : FALLBACK_SATURATION
  const sat = Math.max(SATURATION_MIN, Math.min(SATURATION_MAX, sourceSat))
  return HUE_OFFSETS.map((offset) => {
    const h = (((hsl.h + offset / 360) % 1) + 1) % 1
    return rgbToHex(hslToRgb({ h, s: sat, l: TARGET_LIGHTNESS }))
  })
}

/**
 * Push a custom color into the project-level "recent customs" list,
 * dedupe case-insensitively, and cap the list at
 * {@link MAX_RECENT_CUSTOM_COLORS}. Returns a new array so callers
 * can assign it directly without worrying about mutation.
 *
 * Invalid colors are silently ignored (the original list is returned
 * unchanged) so reducer-style call sites stay simple.
 *
 * @param {string[]|null|undefined} list
 * @param {string} color
 * @returns {string[]}
 */
/**
 * Clamp an arbitrary input into the valid CSS opacity range [0, 1].
 * Non-numeric or undefined inputs fall back to
 * {@link DEFAULT_LONG_NOTE_BG_OPACITY} so call sites can pass raw
 * stored values without guarding.
 */
export function clampOpacity(value) {
  if (value === null || value === undefined) return DEFAULT_LONG_NOTE_BG_OPACITY
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_LONG_NOTE_BG_OPACITY
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Build the CSS `background` value for a long note. Layers the tint
 * over the long-note base surface so the opacity slider behaves as
 * "strength of the tint over gray" rather than "see-through to the
 * page". Returns `null` when no valid color is provided.
 *
 * @param {string} hex hex color (with or without leading #).
 * @param {number} [opacity=1] tint strength in [0, 1].
 * @param {string} [baseBg=LONG_NOTE_BASE_BG] the surface color the
 *   tint is layered over (mirrors `.long-note` CSS).
 * @returns {string|null}
 */
export function buildBackgroundCss(hex, opacity = DEFAULT_LONG_NOTE_BG_OPACITY, baseBg = LONG_NOTE_BASE_BG) {
  const norm = normalizeHexColor(hex)
  if (!norm) return null
  const a = clampOpacity(opacity)
  if (a <= 0) return baseBg
  if (a >= 1) return norm
  const r = parseInt(norm.slice(1, 3), 16)
  const g = parseInt(norm.slice(3, 5), 16)
  const b = parseInt(norm.slice(5, 7), 16)
  const tint = `rgba(${r}, ${g}, ${b}, ${a})`
  return `linear-gradient(${tint}, ${tint}), ${baseBg}`
}

export function pushRecentCustomColor(list, color) {
  const norm = normalizeHexColor(color)
  const existing = Array.isArray(list)
    ? list.map(normalizeHexColor).filter(Boolean)
    : []
  if (!norm) return existing
  const filtered = existing.filter((c) => c !== norm)
  return [norm, ...filtered].slice(0, MAX_RECENT_CUSTOM_COLORS)
}
