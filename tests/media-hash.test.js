import { describe, it, expect } from 'vitest'
import { sha256Hex, sha256HexFromString, isValidSha256Hex } from 'src/utils/media/hash.js'

describe('sha256Hex', () => {
  it('produces a stable 64-char lowercase hex digest for known input', async () => {
    const digest = await sha256HexFromString('hello')
    expect(digest).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    expect(isValidSha256Hex(digest)).toBe(true)
  })

  it('is identical for identical bytes via Blob and Uint8Array', async () => {
    const bytes = new TextEncoder().encode('scaffold')
    const blob = new Blob([bytes], { type: 'text/plain' })
    const fromBytes = await sha256Hex(bytes)
    const fromBlob = await sha256Hex(blob)
    expect(fromBytes).toBe(fromBlob)
  })

  it('differs when bytes differ', async () => {
    const a = await sha256HexFromString('a')
    const b = await sha256HexFromString('b')
    expect(a).not.toBe(b)
  })

  it('rejects non-binary inputs', async () => {
    await expect(sha256Hex({})).rejects.toThrow(TypeError)
    await expect(sha256Hex('not bytes')).rejects.toThrow(TypeError)
  })
})

describe('isValidSha256Hex', () => {
  it('accepts a 64-char lowercase hex string', () => {
    expect(isValidSha256Hex('a'.repeat(64))).toBe(true)
    expect(isValidSha256Hex('0123456789abcdef'.repeat(4))).toBe(true)
  })

  it('rejects wrong length, non-hex, or uppercase', () => {
    expect(isValidSha256Hex('a'.repeat(63))).toBe(false)
    expect(isValidSha256Hex('a'.repeat(65))).toBe(false)
    expect(isValidSha256Hex('A'.repeat(64))).toBe(false)
    expect(isValidSha256Hex('z'.repeat(64))).toBe(false)
    expect(isValidSha256Hex('')).toBe(false)
    expect(isValidSha256Hex(null)).toBe(false)
  })
})
