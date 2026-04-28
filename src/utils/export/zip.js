/**
 * Minimal STORED-only ZIP reader and writer.
 *
 * We deliberately avoid pulling in a general-purpose zip library: the
 * .scaffoldz bundle stores just one JSON manifest plus content-hashed
 * media blobs that are already compressed (PNG, JPEG, WebP, MP3, AAC,
 * etc.), so DEFLATE wouldn't materially shrink them. STORED keeps the
 * implementation tiny, deterministic, and dependency-free — and the
 * archive remains 100% interoperable with `unzip`, macOS Archive
 * Utility, Windows Explorer, etc.
 *
 * Spec: PKZIP APPNOTE 6.3.10. We only implement methods 0 (STORED).
 */

const SIG_LOCAL_FILE = 0x04034b50
const SIG_CENTRAL_DIR = 0x02014b50
const SIG_END_OF_CENTRAL_DIR = 0x06054b50
const VERSION_NEEDED_TO_EXTRACT = 20
const COMPRESSION_STORED = 0
const GENERAL_PURPOSE_FLAG = 0x0800 // bit 11: filename is UTF-8

let crcTable = null

function getCrcTable() {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

export function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = date.getFullYear() - 1980
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

function asUint8Array(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (typeof input === 'string') return new TextEncoder().encode(input)
  if (input && typeof input.length === 'number') return new Uint8Array(input)
  throw new TypeError('zip: unsupported input type')
}

/**
 * Build a STORED-method zip archive in memory.
 *
 * @param {Array<{ path: string, data: Uint8Array | ArrayBuffer | string, date?: Date }>} entries
 * @returns {Uint8Array}
 */
export function createZip(entries) {
  if (!Array.isArray(entries)) throw new Error('zip: entries must be an array')
  const localBlocks = []
  const centralBlocks = []
  let offset = 0
  const now = new Date()

  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || entry.path === '') {
      throw new Error('zip: each entry needs a non-empty path')
    }
    const nameBytes = new TextEncoder().encode(entry.path)
    const dataBytes = asUint8Array(entry.data)
    const crc = crc32(dataBytes)
    const { dosTime, dosDate } = dosDateTime(entry.date || now)

    // Local file header (30 bytes + filename + extra(0))
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lhView = new DataView(localHeader.buffer)
    lhView.setUint32(0, SIG_LOCAL_FILE, true)
    lhView.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true)
    lhView.setUint16(6, GENERAL_PURPOSE_FLAG, true)
    lhView.setUint16(8, COMPRESSION_STORED, true)
    lhView.setUint16(10, dosTime, true)
    lhView.setUint16(12, dosDate, true)
    lhView.setUint32(14, crc, true)
    lhView.setUint32(18, dataBytes.length, true)
    lhView.setUint32(22, dataBytes.length, true)
    lhView.setUint16(26, nameBytes.length, true)
    lhView.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)

    localBlocks.push(localHeader, dataBytes)
    const localBlockSize = localHeader.length + dataBytes.length

    // Central directory entry (46 bytes + filename + extra(0) + comment(0))
    const central = new Uint8Array(46 + nameBytes.length)
    const cdView = new DataView(central.buffer)
    cdView.setUint32(0, SIG_CENTRAL_DIR, true)
    cdView.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true) // version made by
    cdView.setUint16(6, VERSION_NEEDED_TO_EXTRACT, true) // version needed
    cdView.setUint16(8, GENERAL_PURPOSE_FLAG, true)
    cdView.setUint16(10, COMPRESSION_STORED, true)
    cdView.setUint16(12, dosTime, true)
    cdView.setUint16(14, dosDate, true)
    cdView.setUint32(16, crc, true)
    cdView.setUint32(20, dataBytes.length, true)
    cdView.setUint32(24, dataBytes.length, true)
    cdView.setUint16(28, nameBytes.length, true)
    cdView.setUint16(30, 0, true) // extra
    cdView.setUint16(32, 0, true) // comment
    cdView.setUint16(34, 0, true) // disk number
    cdView.setUint16(36, 0, true) // internal attrs
    cdView.setUint32(38, 0, true) // external attrs
    cdView.setUint32(42, offset, true) // local header offset
    central.set(nameBytes, 46)
    centralBlocks.push(central)

    offset += localBlockSize
  }

  const centralDirSize = centralBlocks.reduce((acc, b) => acc + b.length, 0)
  const centralDirOffset = offset

  // End of central directory record (22 bytes + comment(0))
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, SIG_END_OF_CENTRAL_DIR, true)
  eocdView.setUint16(4, 0, true)
  eocdView.setUint16(6, 0, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralDirSize, true)
  eocdView.setUint32(16, centralDirOffset, true)
  eocdView.setUint16(20, 0, true)

  const totalSize =
    offset + centralDirSize + eocd.length
  const out = new Uint8Array(totalSize)
  let pos = 0
  for (const block of localBlocks) {
    out.set(block, pos)
    pos += block.length
  }
  for (const block of centralBlocks) {
    out.set(block, pos)
    pos += block.length
  }
  out.set(eocd, pos)
  return out
}

/**
 * Parse a STORED-only zip archive and return its entries. DEFLATE
 * entries trigger an error so callers know the archive is outside our
 * supported subset (we never produce DEFLATE entries ourselves).
 *
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {Array<{ path: string, data: Uint8Array }>}
 */
export function parseZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Locate end-of-central-directory record. It's at most 22 + 65535
  // bytes from EOF (the comment can be up to 64 KiB).
  const maxScan = Math.min(bytes.length, 22 + 0xffff)
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= bytes.length - maxScan; i--) {
    if (i < 0) break
    if (view.getUint32(i, true) === SIG_END_OF_CENTRAL_DIR) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) {
    throw new Error('zip: end-of-central-directory record not found')
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirOffset = view.getUint32(eocdOffset + 16, true)

  const entries = []
  let cursor = centralDirOffset
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cursor, true) !== SIG_CENTRAL_DIR) {
      throw new Error('zip: invalid central directory entry')
    }
    const compressionMethod = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLen = view.getUint16(cursor + 28, true)
    const extraLen = view.getUint16(cursor + 30, true)
    const commentLen = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLen)
    const path = new TextDecoder('utf-8').decode(nameBytes)
    cursor += 46 + nameLen + extraLen + commentLen

    if (compressionMethod !== COMPRESSION_STORED) {
      throw new Error(
        `zip: entry "${path}" uses unsupported compression method ${compressionMethod}`,
      )
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error(`zip: STORED entry "${path}" has mismatched sizes`)
    }

    // Walk the local file header to find the data offset.
    if (view.getUint32(localHeaderOffset, true) !== SIG_LOCAL_FILE) {
      throw new Error(`zip: invalid local file header for "${path}"`)
    }
    const lfNameLen = view.getUint16(localHeaderOffset + 26, true)
    const lfExtraLen = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + lfNameLen + lfExtraLen
    const data = bytes.slice(dataOffset, dataOffset + compressedSize)
    entries.push({ path, data })
  }

  return entries
}
