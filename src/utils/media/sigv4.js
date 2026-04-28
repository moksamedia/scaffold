/**
 * Minimal AWS Signature Version 4 signing for fetch, implemented on
 * top of the Web Crypto API. Targeted at S3-compatible endpoints
 * (AWS S3, Cloudflare R2, MinIO, Backblaze B2 with S3 compat) but
 * service-agnostic enough for any SigV4-signed call.
 *
 * We deliberately keep this self-contained (no external dependencies)
 * so the bundle stays small and the surface area is auditable. The
 * implementation follows the canonical request / string-to-sign /
 * signing-key chain documented in
 * https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 *
 * Caveats:
 *  - We always sign `x-amz-content-sha256` for S3 (required by the
 *    service). Tests targeting AWS' general-purpose SigV4 vectors that
 *    don't include this header can pass `includeContentSha256: false`.
 *  - We do not currently support pre-signed query strings; only
 *    Authorization-header signing.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256'
const EMPTY_PAYLOAD_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function bytesToHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, '0')
  }
  return out
}

async function sha256Bytes(data) {
  const buffer =
    typeof data === 'string' ? new TextEncoder().encode(data).buffer : data
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return new Uint8Array(digest)
}

async function sha256Hex(data) {
  return bytesToHex(await sha256Bytes(data))
}

async function hmacSha256(key, data) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes)
  return new Uint8Array(sig)
}

/**
 * AWS-flavoured percent-encoding. Matches the rules from
 * https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 *  - Unreserved characters [A-Za-z0-9_~.-] pass through.
 *  - In path mode, '/' is left unescaped.
 *  - Everything else is percent-encoded as UTF-8 bytes (uppercase hex).
 */
export function awsUriEncode(value, keepSlash = false) {
  if (value == null) return ''
  let out = ''
  const str = String(value)
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.'
    ) {
      out += ch
    } else if (ch === '/' && keepSlash) {
      out += '/'
    } else {
      const bytes = new TextEncoder().encode(ch)
      for (let j = 0; j < bytes.length; j++) {
        out += '%' + bytes[j].toString(16).toUpperCase().padStart(2, '0')
      }
    }
  }
  return out
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function formatAmzDate(date) {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  )
}

export function formatShortDate(date) {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate())
  )
}

async function hashRequestBody(body) {
  if (body == null || body === '') return EMPTY_PAYLOAD_HASH
  if (typeof body === 'string') return sha256Hex(body)
  if (body instanceof Uint8Array) {
    return bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          body.byteOffset === 0 && body.byteLength === body.buffer.byteLength
            ? body.buffer
            : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        ),
      ),
    )
  }
  if (body instanceof ArrayBuffer) return sha256Hex(body)
  if (typeof body.arrayBuffer === 'function') {
    const buffer = await body.arrayBuffer()
    return sha256Hex(buffer)
  }
  return sha256Hex(String(body))
}

/**
 * Sign a single HTTPS request with SigV4 and return new headers
 * carrying `Authorization`, `x-amz-date`, and `x-amz-content-sha256`
 * (when `includeContentSha256` is true).
 *
 * @param {Object} params
 * @param {string} params.method - HTTP method (GET, PUT, ...)
 * @param {string} params.url - Fully-qualified request URL.
 * @param {Record<string, string>} [params.headers]
 * @param {string|ArrayBuffer|Uint8Array|Blob|null} [params.body]
 * @param {string} params.region
 * @param {string} [params.service='s3']
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @param {string} [params.sessionToken]
 * @param {Date} [params.date]
 * @param {boolean} [params.includeContentSha256=true]
 * @returns {Promise<Record<string, string>>}
 */
export async function signRequest({
  method,
  url,
  headers = {},
  body = null,
  region,
  service = 's3',
  accessKeyId,
  secretAccessKey,
  sessionToken,
  date = new Date(),
  includeContentSha256 = true,
}) {
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('signRequest: region, accessKeyId, and secretAccessKey are required')
  }

  const u = new URL(url)
  const amzDate = formatAmzDate(date)
  const shortDate = formatShortDate(date)
  const payloadHash = await hashRequestBody(body)

  // Caller-provided headers win, but we always set host / x-amz-date /
  // optionally x-amz-content-sha256 / x-amz-security-token.
  const merged = {}
  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null) continue
    merged[name] = String(value)
  }
  merged['host'] = u.host
  merged['x-amz-date'] = amzDate
  if (includeContentSha256) merged['x-amz-content-sha256'] = payloadHash
  if (sessionToken) merged['x-amz-security-token'] = sessionToken

  const canonicalHeadersMap = {}
  for (const [name, value] of Object.entries(merged)) {
    const lcName = name.toLowerCase().trim()
    const trimmedValue = String(value).trim().replace(/\s+/g, ' ')
    canonicalHeadersMap[lcName] = trimmedValue
  }
  const sortedHeaderNames = Object.keys(canonicalHeadersMap).sort()
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${canonicalHeadersMap[name]}\n`)
    .join('')
  const signedHeaders = sortedHeaderNames.join(';')

  // Canonical URI: each path segment URI-encoded once. Empty path -> '/'.
  let canonicalUri = '/'
  if (u.pathname && u.pathname !== '') {
    canonicalUri = u.pathname
      .split('/')
      .map((segment) => {
        if (segment === '') return ''
        try {
          return awsUriEncode(decodeURIComponent(segment))
        } catch {
          return awsUriEncode(segment)
        }
      })
      .join('/')
    if (!canonicalUri.startsWith('/')) canonicalUri = '/' + canonicalUri
  }

  // Canonical query string: sort by name, then by value, encode each
  // pair separately with awsUriEncode.
  const queryEntries = []
  u.searchParams.forEach((value, name) => {
    queryEntries.push([awsUriEncode(name), awsUriEncode(value)])
  })
  queryEntries.sort((a, b) => {
    if (a[0] === b[0]) return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    return a[0] < b[0] ? -1 : 1
  })
  const canonicalQuery = queryEntries.map(([n, v]) => `${n}=${v}`).join('&')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = await hmacSha256('AWS4' + secretAccessKey, shortDate)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign))

  const authorization = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const result = { ...merged }
  // Browsers refuse to set Host explicitly, but Node/test environments
  // may not. We omit it from the returned headers; signing already
  // accounts for it.
  delete result.host
  result.Authorization = authorization
  return result
}
