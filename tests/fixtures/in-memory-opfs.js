/**
 * Minimal in-memory FileSystemDirectoryHandle stub good enough to back
 * the OPFS adapter contract tests under happy-dom. Implements only the
 * subset of the File System Access API the adapter actually uses:
 *   - root.getDirectoryHandle(name, { create })
 *   - dir.getFileHandle(name, { create })
 *   - dir.removeEntry(name)
 *   - for await (const [name, handle] of dir.entries())
 *   - file.getFile()           → Blob-like with .text()/.arrayBuffer()/.size/.type
 *   - file.createWritable()    → { write(blobOrArrayBuffer), close() }
 *
 * Intentionally permissive: missing entries throw a NotFoundError,
 * matching the real API closely enough for the adapter to behave the
 * same as in production.
 */

class InMemoryFile {
  constructor(name) {
    this.name = name
    this.kind = 'file'
    this._buffer = new Uint8Array()
    this._type = ''
  }

  async getFile() {
    const buf = this._buffer
    const type = this._type
    return {
      name: this.name,
      size: buf.length,
      type,
      async arrayBuffer() {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
      async text() {
        return new TextDecoder().decode(buf)
      },
    }
  }

  async createWritable() {
    const owner = this
    return {
      async write(input) {
        if (input instanceof Blob) {
          owner._type = input.type || owner._type
          const buf = await input.arrayBuffer()
          owner._buffer = new Uint8Array(buf)
        } else if (input instanceof ArrayBuffer) {
          owner._buffer = new Uint8Array(input)
        } else if (input instanceof Uint8Array) {
          owner._buffer = input
        } else if (typeof input === 'string') {
          owner._buffer = new TextEncoder().encode(input)
        } else {
          throw new TypeError('unsupported write payload')
        }
      },
      async close() {
        // no-op
      },
    }
  }
}

class InMemoryDir {
  constructor(name = '') {
    this.name = name
    this.kind = 'directory'
    this._entries = new Map()
  }

  async getDirectoryHandle(name, options = {}) {
    let entry = this._entries.get(name)
    if (!entry) {
      if (!options.create) {
        const err = new Error(`NotFoundError: ${name}`)
        err.name = 'NotFoundError'
        throw err
      }
      entry = new InMemoryDir(name)
      this._entries.set(name, entry)
    }
    if (entry.kind !== 'directory') {
      throw new TypeError(`${name} is not a directory`)
    }
    return entry
  }

  async getFileHandle(name, options = {}) {
    let entry = this._entries.get(name)
    if (!entry) {
      if (!options.create) {
        const err = new Error(`NotFoundError: ${name}`)
        err.name = 'NotFoundError'
        throw err
      }
      entry = new InMemoryFile(name)
      this._entries.set(name, entry)
    }
    if (entry.kind !== 'file') {
      throw new TypeError(`${name} is not a file`)
    }
    return entry
  }

  async removeEntry(name) {
    if (!this._entries.has(name)) {
      const err = new Error(`NotFoundError: ${name}`)
      err.name = 'NotFoundError'
      throw err
    }
    this._entries.delete(name)
  }

  async *entries() {
    for (const [name, handle] of this._entries) {
      yield [name, handle]
    }
  }
}

export function createInMemoryOpfsRoot() {
  return new InMemoryDir('/')
}
