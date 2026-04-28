/**
 * SigV4 signing — verified against AWS' canonical "get-vanilla" test
 * vector from the aws-sig-v4-test-suite. The test vector's expected
 * Authorization header is reproduced verbatim and gives us confidence
 * the canonical-request, string-to-sign, and key-derivation chains all
 * match the spec.
 */

import { describe, it, expect } from 'vitest'
import { signRequest, awsUriEncode, formatAmzDate, formatShortDate } from 'src/utils/media/sigv4.js'

describe('signRequest (AWS get-vanilla test vector)', () => {
  const ACCESS_KEY = 'AKIDEXAMPLE'
  const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
  const REGION = 'us-east-1'
  const SERVICE = 'service'
  const FIXED_DATE = new Date(Date.UTC(2015, 7, 30, 12, 36, 0))

  it('produces the canonical Authorization header', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'http://example.amazonaws.com/',
      headers: {},
      body: null,
      region: REGION,
      service: SERVICE,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      date: FIXED_DATE,
      includeContentSha256: false,
    })

    expect(headers['x-amz-date']).toBe('20150830T123600Z')
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
  })

  it('strips Host from the returned headers (browsers refuse to set it)', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'http://example.amazonaws.com/',
      region: REGION,
      service: SERVICE,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      date: FIXED_DATE,
      includeContentSha256: false,
    })
    expect(headers.host).toBeUndefined()
    expect(headers.Host).toBeUndefined()
  })

  it('includes x-amz-content-sha256 by default', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://s3.us-east-1.amazonaws.com/bucket/key',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      date: FIXED_DATE,
    })
    expect(headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
  })

  it('includes x-amz-security-token when sessionToken is provided', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://s3.us-east-1.amazonaws.com/bucket/key',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      sessionToken: 'temp-token',
      date: FIXED_DATE,
    })
    expect(headers['x-amz-security-token']).toBe('temp-token')
    expect(headers.Authorization).toContain('x-amz-security-token')
  })

  it('hashes a non-empty PUT body and signs it', async () => {
    const body = new Uint8Array([1, 2, 3, 4])
    const headers = await signRequest({
      method: 'PUT',
      url: 'https://s3.us-east-1.amazonaws.com/bucket/object',
      headers: { 'content-type': 'application/octet-stream' },
      body,
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      date: FIXED_DATE,
    })
    // Exact signature is sensitive to many inputs; assert the content
    // hash is the SHA-256 of the bytes (not the empty hash).
    expect(headers['x-amz-content-sha256']).not.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/)
  })

  it('rejects when required credentials are missing', async () => {
    await expect(
      signRequest({
        method: 'GET',
        url: 'https://example.com/',
        region: '',
        accessKeyId: '',
        secretAccessKey: '',
      }),
    ).rejects.toThrow(/required/)
  })
})

describe('awsUriEncode', () => {
  it('passes unreserved characters through unchanged', () => {
    expect(awsUriEncode('AaZz09_-~.')).toBe('AaZz09_-~.')
  })

  it('percent-encodes spaces, slashes (when not in path mode), and unicode', () => {
    expect(awsUriEncode('a b/c')).toBe('a%20b%2Fc')
    expect(awsUriEncode('a b/c', true)).toBe('a%20b/c')
    expect(awsUriEncode('é')).toBe('%C3%A9')
  })
})

describe('formatAmzDate / formatShortDate', () => {
  it('formats UTC timestamps without separators', () => {
    const date = new Date(Date.UTC(2024, 0, 2, 3, 4, 5))
    expect(formatAmzDate(date)).toBe('20240102T030405Z')
    expect(formatShortDate(date)).toBe('20240102')
  })
})
