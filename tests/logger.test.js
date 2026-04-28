import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLogs,
  getLevel,
  getRecentLogs,
  LEVELS,
  LOG_LEVEL_OVERRIDE_KEY,
  logger,
  normalizeError,
  setLevel,
  setRingBufferSize,
  setSink,
} from 'src/utils/logging/logger.js'

describe('logger', () => {
  let captured = []
  beforeEach(() => {
    captured = []
    setSink((record) => captured.push(record))
    setLevel(LEVELS.DEBUG)
    setRingBufferSize(200)
    clearLogs()
  })
  afterEach(() => {
    setSink(null) // restore default
    setLevel(LEVELS.INFO)
  })

  it('emits structured records with level, event, and ts', () => {
    logger.info('app.init.success', { contextId: 'default' })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      level: 'info',
      event: 'app.init.success',
      description: 'Application initialization completed successfully',
      operatorHint: 'operation-succeeded',
      contextId: 'default',
    })
    expect(typeof captured[0].ts).toBe('string')
  })

  it('uses curated callsite descriptions for known events', () => {
    logger.error('persist.save.failed', { projectId: 'p1' })
    expect(captured[0].description).toBe(
      'Autosave/persistence failed while writing projects/settings snapshot to storage adapter',
    )
  })

  it('uses curated operator hints for known events', () => {
    logger.error('persist.save.failed', { projectId: 'p1' })
    expect(captured[0].operatorHint).toBe('storage-write-failed')
  })

  it('allows explicit description override from payload', () => {
    logger.info('media.gc.completed', { description: 'GC sweep done' })
    expect(captured[0].description).toBe('GC sweep done')
  })

  it('allows explicit operatorHint override from payload', () => {
    logger.info('media.gc.completed', { operatorHint: 'maintenance-cycle' })
    expect(captured[0].operatorHint).toBe('maintenance-cycle')
  })

  it('gates by level (info hides debug)', () => {
    setLevel(LEVELS.INFO)
    logger.debug('noisy.event', { x: 1 })
    logger.info('useful.event', { y: 2 })
    expect(captured.map((r) => r.event)).toEqual(['useful.event'])
  })

  it('gates by level (error level hides info and debug)', () => {
    setLevel(LEVELS.ERROR)
    logger.debug('a', {})
    logger.info('b', {})
    logger.error('c', new Error('boom'))
    expect(captured.map((r) => r.event)).toEqual(['c'])
  })

  it('redacts sensitive keys', () => {
    logger.info('s3.connect', {
      bucket: 'mybucket',
      accessKey: 'AKIA...',
      secretAccessKey: 'shhh',
      passphrase: 'pass',
      headers: { Authorization: 'Bearer xyz' },
    })
    const rec = captured[0]
    expect(rec.bucket).toBe('mybucket')
    expect(rec.secretAccessKey).toBe('[redacted]')
    expect(rec.passphrase).toBe('[redacted]')
    expect(rec.headers.Authorization).toBe('[redacted]')
  })

  it('normalizes Error instances on .error()', () => {
    const err = new Error('disk full')
    err.name = 'QuotaExceededError'
    logger.error('persist.save.failed', err, { projectId: 'p1' })
    const rec = captured[0]
    expect(rec.event).toBe('persist.save.failed')
    expect(rec.errorName).toBe('QuotaExceededError')
    expect(rec.errorMessage).toBe('disk full')
    expect(rec.projectId).toBe('p1')
  })

  it('flags AbortError as isAbort', () => {
    const err = new Error('user cancelled')
    err.name = 'AbortError'
    const out = normalizeError(err)
    expect(out.isAbort).toBe(true)
    expect(out.errorName).toBe('AbortError')
  })

  it('truncates long strings to keep payload bounded', () => {
    const huge = 'x'.repeat(5000)
    logger.info('big.string', { html: huge })
    const rec = captured[0]
    expect(rec.html.length).toBeLessThan(huge.length)
    expect(rec.html).toContain('[truncated')
  })

  it('handles circular objects safely', () => {
    const a = { name: 'a' }
    a.self = a
    expect(() => logger.info('circular.test', { a })).not.toThrow()
    expect(captured[0].a.self).toBe('[circular]')
  })

  it('captures recent logs in a ring buffer', () => {
    setRingBufferSize(3)
    logger.info('one', {})
    logger.info('two', {})
    logger.info('three', {})
    logger.info('four', {})
    const recent = getRecentLogs()
    expect(recent.map((r) => r.event)).toEqual(['two', 'three', 'four'])
  })

  it('clearLogs empties ring buffer', () => {
    logger.info('x', {})
    expect(getRecentLogs()).toHaveLength(1)
    clearLogs()
    expect(getRecentLogs()).toHaveLength(0)
  })

  it('error() accepts a plain payload (no Error)', () => {
    logger.error('export.failed', { reason: 'no projects' })
    const rec = captured[0]
    expect(rec.level).toBe('error')
    expect(rec.reason).toBe('no projects')
  })

  it('error() accepts a primitive payload', () => {
    logger.error('weird.failure', 'string-thrown')
    const rec = captured[0]
    expect(rec.detail).toBe('string-thrown')
  })

  it('does not throw if sink throws', () => {
    setSink(() => {
      throw new Error('sink broken')
    })
    expect(() => logger.info('x', {})).not.toThrow()
  })

  it('reports current level', () => {
    setLevel(LEVELS.DEBUG)
    expect(getLevel()).toBe('debug')
    setLevel(LEVELS.INFO)
    expect(getLevel()).toBe('info')
  })

  it('ignores invalid setLevel values', () => {
    setLevel(LEVELS.INFO)
    setLevel('not-a-real-level')
    expect(getLevel()).toBe('info')
  })

  it('redaction is case-insensitive', () => {
    logger.info('case', { SECRET: 'a', Authorization: 'b', Passphrase: 'c' })
    const rec = captured[0]
    expect(rec.SECRET).toBe('[redacted]')
    expect(rec.Authorization).toBe('[redacted]')
    expect(rec.Passphrase).toBe('[redacted]')
  })

  it('recursively sanitizes nested arrays', () => {
    logger.info('nested', { items: [{ secret: 'no' }, { ok: 'yes' }] })
    const rec = captured[0]
    expect(rec.items[0].secret).toBe('[redacted]')
    expect(rec.items[1].ok).toBe('yes')
  })

  it('exposes the localStorage override key for support workflows', () => {
    expect(LOG_LEVEL_OVERRIDE_KEY).toBe('scaffold-log-level')
  })
})
