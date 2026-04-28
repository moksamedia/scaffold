/**
 * SHA-256 helper for content-addressable media storage.
 *
 * All media is keyed by the lowercase hex digest of its raw bytes,
 * so identical files collapse to a single record across uploads,
 * imports, and devices.
 */

/**
 * Compute the SHA-256 hex digest of the given input.
 *
 * @param {Blob|ArrayBuffer|Uint8Array} input
 * @returns {Promise<string>} 64-char lowercase hex string
 */
export async function sha256Hex(input) {
  let bytes
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    bytes = new Uint8Array(await input.arrayBuffer())
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else if (input instanceof Uint8Array) {
    bytes = input
  } else {
    throw new TypeError('sha256Hex: expected Blob, ArrayBuffer, or Uint8Array')
  }

  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto SubtleCrypto is not available in this environment')
  }
  const digest = await subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Convenience: hash a string (UTF-8 encoded). Mostly used in tests.
 *
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function sha256HexFromString(value) {
  return sha256Hex(new TextEncoder().encode(value || ''))
}

export function isValidSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function bytesToHex(bytes) {
  const out = new Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, '0')
  }
  return out.join('')
}
