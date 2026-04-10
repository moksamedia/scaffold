import LZString from 'lz-string'

/** ASCII prefix so legacy plain JSON (starts with `{`) is unchanged. */
export const VERSION_STORAGE_LZ_PREFIX = 'SCAFFOLD_V1_LZ:'

/**
 * @param {string | null} raw
 * @returns {object | null}
 */
export function parseVersionStorageValue(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  if (raw.startsWith(VERSION_STORAGE_LZ_PREFIX)) {
    const compressed = raw.slice(VERSION_STORAGE_LZ_PREFIX.length)
    const json = LZString.decompressFromUTF16(compressed)
    if (json == null) return null
    return JSON.parse(json)
  }
  return JSON.parse(raw)
}

/**
 * @param {object} versionData
 * @param {{ compress: boolean }} opts
 * @returns {string}
 */
export function serializeVersionForStorage(versionData, opts) {
  const json = JSON.stringify(versionData)
  if (!opts.compress) return json
  return VERSION_STORAGE_LZ_PREFIX + LZString.compressToUTF16(json)
}
