/**
 * S3-compatible media storage adapter.
 *
 * Implements the same `MediaStorageAdapter` interface used by the
 * IndexedDB / OPFS / user-folder backends, so the resolver, ingest,
 * GC, and Settings code remain unchanged. Works against any service
 * that speaks the S3 REST API: AWS S3, Cloudflare R2, MinIO, Backblaze
 * B2 (with S3 compat enabled), Wasabi, etc.
 *
 * Object layout: `<prefix>/<sha256-hex-of-bytes>`
 *
 * Idempotent PUT: because object keys are content hashes, re-uploading
 * the same blob is safe and the second PUT is effectively a no-op.
 *
 * Important caveats:
 *  - Browsers cannot set the `Host` header explicitly, so virtual-host
 *    style endpoints (`https://<bucket>.s3.amazonaws.com/...`) work as
 *    expected. Path-style endpoints
 *    (`https://s3.amazonaws.com/<bucket>/...`) also work because the
 *    bucket lives in the URL path.
 *  - The bucket must allow CORS for GET, HEAD, PUT, DELETE from the
 *    Scaffold origin, and expose `ETag` / `Content-Length`.
 *  - This adapter never logs or persists credentials; callers are
 *    responsible for storing them via the credentials store
 *    (`src/utils/media/s3-config.js`).
 */

import { signRequest } from './sigv4.js'

/**
 * @typedef {Object} S3AdapterConfig
 * @property {string} endpoint - Base URL: 'https://s3.us-east-1.amazonaws.com' or 'https://<account>.r2.cloudflarestorage.com'
 * @property {string} region - e.g. 'us-east-1' or 'auto' for R2
 * @property {string} bucket
 * @property {string} [prefix='scaffold/media'] - object key prefix (no leading/trailing slashes required)
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string} [sessionToken]
 * @property {boolean} [pathStyle=true] - true: '<endpoint>/<bucket>/<key>'; false: '<bucket>.<endpoint>/<key>'
 * @property {string} [service='s3']
 * @property {boolean} [sharedBucket=false] - When true, `delete()` is a no-op
 *   (this client trusts other devices may still reference the object). Use
 *   `forceDelete()` to bypass the no-op for user-confirmed cross-client
 *   deletion.
 * @property {typeof fetch} [fetchImpl] - Test seam for mocking fetch
 */

const DEFAULT_PREFIX = 'scaffold/media'

function normalizePrefix(prefix) {
  if (!prefix) return DEFAULT_PREFIX
  return String(prefix)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim() || DEFAULT_PREFIX
}

function buildObjectUrl(config, key) {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const pathStyle = config.pathStyle !== false
  if (pathStyle) {
    return `${endpoint}/${encodeURIComponent(config.bucket)}/${encodeURI(key)}`
  }
  // Virtual host style: bucket as subdomain. The browser controls Host.
  const url = new URL(endpoint)
  return `${url.protocol}//${config.bucket}.${url.host}/${encodeURI(key)}`
}

function buildBucketUrl(config, query = '') {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const pathStyle = config.pathStyle !== false
  if (pathStyle) {
    return `${endpoint}/${encodeURIComponent(config.bucket)}/${query ? `?${query}` : ''}`
  }
  const url = new URL(endpoint)
  return `${url.protocol}//${config.bucket}.${url.host}/${query ? `?${query}` : ''}`
}

function objectKey(prefix, hash) {
  return `${prefix}/${hash}`
}

async function performSignedRequest(config, { method, url, headers = {}, body = null }) {
  const fetchImpl = config.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('S3 adapter: fetch is not available in this environment')
  }
  const signed = await signRequest({
    method,
    url,
    headers,
    body,
    region: config.region,
    service: config.service || 's3',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  })
  const response = await fetchImpl(url, {
    method,
    headers: signed,
    body,
  })
  return response
}

/**
 * Build a media adapter against an S3-compatible bucket. The shape is
 * identical to the IDB/OPFS/user-folder adapters so it can be layered
 * underneath a local cache via {@link createCachingMediaAdapter}.
 *
 * @param {S3AdapterConfig} config
 * @returns {import('./adapter.js').MediaStorageAdapter}
 */
export function createS3MediaAdapter(config) {
  if (!config) throw new Error('createS3MediaAdapter: config is required')
  const fullConfig = { ...config, prefix: normalizePrefix(config.prefix) }

  async function has(hash) {
    const url = buildObjectUrl(fullConfig, objectKey(fullConfig.prefix, hash))
    const response = await performSignedRequest(fullConfig, { method: 'HEAD', url })
    if (response.status === 404) return false
    if (!response.ok) {
      throw new Error(`S3 HEAD ${hash} failed: ${response.status} ${response.statusText}`)
    }
    return true
  }

  async function get(hash) {
    const url = buildObjectUrl(fullConfig, objectKey(fullConfig.prefix, hash))
    const response = await performSignedRequest(fullConfig, { method: 'GET', url })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`S3 GET ${hash} failed: ${response.status} ${response.statusText}`)
    }
    const blob = await response.blob()
    const mime =
      response.headers.get('x-amz-meta-mime') ||
      response.headers.get('content-type') ||
      'application/octet-stream'
    const createdAtRaw =
      response.headers.get('x-amz-meta-createdat') ||
      response.headers.get('last-modified')
    const createdAt = createdAtRaw ? Date.parse(createdAtRaw) || Date.now() : Date.now()
    return {
      blob,
      mime,
      size: blob.size,
      createdAt,
    }
  }

  async function put(hash, blob, mime) {
    const url = buildObjectUrl(fullConfig, objectKey(fullConfig.prefix, hash))
    const effectiveMime = mime || blob?.type || 'application/octet-stream'
    const buffer = await blob.arrayBuffer()
    const response = await performSignedRequest(fullConfig, {
      method: 'PUT',
      url,
      headers: {
        'content-type': effectiveMime,
        'x-amz-meta-mime': effectiveMime,
        'x-amz-meta-createdat': new Date().toISOString(),
      },
      body: new Uint8Array(buffer),
    })
    if (!response.ok) {
      throw new Error(`S3 PUT ${hash} failed: ${response.status} ${response.statusText}`)
    }
  }

  async function performRemoteDelete(hash) {
    const url = buildObjectUrl(fullConfig, objectKey(fullConfig.prefix, hash))
    const response = await performSignedRequest(fullConfig, { method: 'DELETE', url })
    // S3 returns 204 on successful delete and (per spec) treats deletes
    // of missing objects as success. Anything else is an error.
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE ${hash} failed: ${response.status} ${response.statusText}`)
    }
  }

  // When `sharedBucket` is true, this client treats the bucket as
  // multi-tenant: another device may still hold references to a hash
  // we no longer use locally, so automated GC must not issue DELETE.
  // Use `forceDelete` for explicit, user-confirmed remote eviction.
  async function deleteHash(hash) {
    if (fullConfig.sharedBucket) return
    await performRemoteDelete(hash)
  }

  async function forceDelete(hash) {
    await performRemoteDelete(hash)
  }

  async function listAllObjects() {
    const objects = []
    let continuationToken = null
    do {
      const params = new URLSearchParams()
      params.set('list-type', '2')
      params.set('prefix', `${fullConfig.prefix}/`)
      if (continuationToken) params.set('continuation-token', continuationToken)
      const url = buildBucketUrl(fullConfig, params.toString())
      const response = await performSignedRequest(fullConfig, { method: 'GET', url })
      if (!response.ok) {
        throw new Error(`S3 LIST failed: ${response.status} ${response.statusText}`)
      }
      const xml = await response.text()
      const parsed = parseListV2Xml(xml, fullConfig.prefix)
      objects.push(...parsed.objects)
      continuationToken = parsed.nextContinuationToken
    } while (continuationToken)
    return objects
  }

  async function listHashes() {
    const objects = await listAllObjects()
    return objects.map((o) => o.hash).filter(Boolean)
  }

  async function getStats() {
    const objects = await listAllObjects()
    let bytes = 0
    for (const o of objects) bytes += o.size || 0
    return { count: objects.length, bytes }
  }

  return { has, get, put, delete: deleteHash, forceDelete, listHashes, getStats }
}

/**
 * Lightweight ListObjectsV2 XML parser. AWS returns a deterministic
 * envelope with `<Contents><Key/><Size/></Contents>` repeated per
 * object plus an optional `<NextContinuationToken/>`. We extract just
 * the bits we need (object key tail = hash, byte size, pagination
 * cursor) without pulling in a full XML parser.
 */
export function parseListV2Xml(xml, prefix) {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      const contents = doc.getElementsByTagName('Contents')
      const objects = []
      for (let i = 0; i < contents.length; i++) {
        const el = contents[i]
        const key = el.getElementsByTagName('Key')[0]?.textContent || ''
        const sizeText = el.getElementsByTagName('Size')[0]?.textContent || '0'
        const hash = key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : ''
        if (!hash) continue
        objects.push({ key, hash, size: Number(sizeText) || 0 })
      }
      const tokenEl = doc.getElementsByTagName('NextContinuationToken')[0]
      const isTruncatedEl = doc.getElementsByTagName('IsTruncated')[0]
      const isTruncated = (isTruncatedEl?.textContent || 'false').trim() === 'true'
      const nextContinuationToken = isTruncated ? tokenEl?.textContent || null : null
      return { objects, nextContinuationToken }
    } catch {
      // Fall through to the regex fallback below.
    }
  }
  // Regex fallback for environments without DOMParser (rare).
  const objects = []
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g
  for (const match of xml.matchAll(contentsRegex)) {
    const block = match[1]
    const key = (block.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || ''
    const size = Number((block.match(/<Size>([\s\S]*?)<\/Size>/) || [])[1] || '0')
    const hash = key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : ''
    if (hash) objects.push({ key, hash, size: Number.isFinite(size) ? size : 0 })
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const tokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)
  return {
    objects,
    nextContinuationToken: truncated && tokenMatch ? tokenMatch[1] : null,
  }
}
