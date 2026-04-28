/**
 * S3 media adapter — exercised against a mock fetch that returns
 * AWS-shaped responses (HEAD, GET, PUT, DELETE, ListObjectsV2). We
 * assert the adapter:
 *   - issues correctly-signed requests (Authorization header present),
 *   - parses object metadata from response headers,
 *   - paginates ListObjectsV2 via continuation tokens,
 *   - reports total bytes / count via getStats,
 *   - treats 404 as "not found" without throwing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createS3MediaAdapter, parseListV2Xml } from 'src/utils/media/s3-adapter.js'

function makeResponse({ status = 200, body = '', headers = {} } = {}) {
  const headersMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]))
  return {
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => headersMap.get(name.toLowerCase()) ?? null,
    },
    text: async () => (typeof body === 'string' ? body : ''),
    blob: async () => {
      if (body instanceof Blob) return body
      if (body instanceof Uint8Array) return new Blob([body])
      return new Blob([typeof body === 'string' ? body : ''])
    },
  }
}

const BASE_CONFIG = {
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  bucket: 'scaffold-test',
  prefix: 'scaffold/media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

describe('createS3MediaAdapter', () => {
  let calls = []
  let fetchImpl
  let nextResponses

  beforeEach(() => {
    calls = []
    nextResponses = []
    fetchImpl = async (url, init) => {
      calls.push({ url, init })
      const response = nextResponses.shift()
      if (!response) throw new Error(`Unexpected fetch ${init?.method || 'GET'} ${url}`)
      return response
    }
  })

  function adapter(overrides = {}) {
    return createS3MediaAdapter({ ...BASE_CONFIG, fetchImpl, ...overrides })
  }

  it('signs HEAD requests and returns true on 200', async () => {
    nextResponses = [makeResponse({ status: 200 })]
    const result = await adapter().has('abc123')
    expect(result).toBe(true)
    const [{ url, init }] = calls
    expect(url).toBe('https://s3.us-east-1.amazonaws.com/scaffold-test/scaffold/media/abc123')
    expect(init.method).toBe('HEAD')
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
  })

  it('treats HEAD 404 as not present', async () => {
    nextResponses = [makeResponse({ status: 404 })]
    expect(await adapter().has('missing')).toBe(false)
  })

  it('GETs an object and returns blob, mime, size, createdAt', async () => {
    const bodyBytes = new Uint8Array([1, 2, 3, 4, 5])
    nextResponses = [
      makeResponse({
        status: 200,
        body: bodyBytes,
        headers: {
          'Content-Type': 'image/png',
          'x-amz-meta-mime': 'image/png',
          'x-amz-meta-createdat': '2024-01-02T03:04:05Z',
          'Content-Length': '5',
        },
      }),
    ]
    const result = await adapter().get('hash-1')
    expect(result.mime).toBe('image/png')
    expect(result.size).toBe(bodyBytes.length)
    expect(result.createdAt).toBe(Date.parse('2024-01-02T03:04:05Z'))
  })

  it('GET 404 returns null', async () => {
    nextResponses = [makeResponse({ status: 404 })]
    expect(await adapter().get('absent')).toBeNull()
  })

  it('PUTs with content-type and meta headers, idempotent on retry', async () => {
    nextResponses = [makeResponse({ status: 200 }), makeResponse({ status: 200 })]
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/mpeg' })
    await adapter().put('hash-2', blob, 'audio/mpeg')
    await adapter().put('hash-2', blob, 'audio/mpeg')
    expect(calls).toHaveLength(2)
    const [first] = calls
    expect(first.init.method).toBe('PUT')
    expect(first.init.headers['content-type']).toBe('audio/mpeg')
    expect(first.init.headers['x-amz-meta-mime']).toBe('audio/mpeg')
    expect(first.init.headers['x-amz-meta-createdat']).toBeTruthy()
    expect(first.init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256/)
  })

  it('treats DELETE 404 as success (no throw)', async () => {
    nextResponses = [makeResponse({ status: 404 })]
    await expect(adapter().delete('missing')).resolves.toBeUndefined()
  })

  it('paginates listHashes via continuation tokens', async () => {
    const page1 = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>cursor-2</NextContinuationToken>
  <Contents><Key>scaffold/media/aaa</Key><Size>10</Size></Contents>
  <Contents><Key>scaffold/media/bbb</Key><Size>20</Size></Contents>
</ListBucketResult>`
    const page2 = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>scaffold/media/ccc</Key><Size>30</Size></Contents>
</ListBucketResult>`
    nextResponses = [
      makeResponse({ status: 200, body: page1 }),
      makeResponse({ status: 200, body: page2 }),
    ]
    const hashes = await adapter().listHashes()
    expect(hashes).toEqual(['aaa', 'bbb', 'ccc'])
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('list-type=2')
    expect(calls[0].url).toContain('prefix=scaffold%2Fmedia%2F')
    expect(calls[1].url).toContain('continuation-token=cursor-2')
  })

  it('getStats sums object sizes', async () => {
    const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>scaffold/media/aaa</Key><Size>1024</Size></Contents>
  <Contents><Key>scaffold/media/bbb</Key><Size>2048</Size></Contents>
</ListBucketResult>`
    nextResponses = [makeResponse({ status: 200, body: xml })]
    const stats = await adapter().getStats()
    expect(stats).toEqual({ count: 2, bytes: 3072 })
  })

  it('throws on PUT failure with response status in message', async () => {
    nextResponses = [makeResponse({ status: 403 })]
    await expect(
      adapter().put('h', new Blob([new Uint8Array([1])]), 'application/octet-stream'),
    ).rejects.toThrow(/403/)
  })

  it('sharedBucket=true makes delete() a no-op (no fetch issued)', async () => {
    const a = adapter({ sharedBucket: true })
    await expect(a.delete('shared-hash')).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('sharedBucket=true still allows forceDelete() to issue DELETE', async () => {
    nextResponses = [makeResponse({ status: 204 })]
    const a = adapter({ sharedBucket: true })
    await a.forceDelete('shared-hash')
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[0].url).toBe(
      'https://s3.us-east-1.amazonaws.com/scaffold-test/scaffold/media/shared-hash',
    )
  })

  it('forceDelete treats 404 as success', async () => {
    nextResponses = [makeResponse({ status: 404 })]
    const a = adapter({ sharedBucket: true })
    await expect(a.forceDelete('missing')).resolves.toBeUndefined()
  })

  it('sharedBucket=false (default) still issues real DELETEs', async () => {
    nextResponses = [makeResponse({ status: 204 })]
    await adapter().delete('h')
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('skips objects whose keys do not start with the prefix in list parsing', () => {
    const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>not-mine/abc</Key><Size>1</Size></Contents>
  <Contents><Key>scaffold/media/x</Key><Size>2</Size></Contents>
</ListBucketResult>`
    const parsed = parseListV2Xml(xml, 'scaffold/media')
    expect(parsed.objects).toEqual([{ key: 'scaffold/media/x', hash: 'x', size: 2 }])
  })
})
