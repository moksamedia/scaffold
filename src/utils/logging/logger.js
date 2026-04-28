/**
 * Centralized application logger.
 *
 * Provides three levels — `debug`, `info`, `error` — routed through a
 * single structured-output pipeline so user-reported issues and async
 * flow diagnostics share one schema and one verbosity dial.
 *
 * Output schema:
 *   { level, event, ts, ...payload }
 *
 * Where:
 *   - `level`: one of LEVELS.
 *   - `event`: stable dot-style id (e.g. `context.switch.failed`).
 *   - `ts`: ISO timestamp at emission.
 *   - `payload`: structured fields including normalized error data.
 *
 * Behavior:
 *   - Level gating via {@link setLevel}; defaults to `info` (or `debug`
 *     when `LOG_LEVEL` / dev mode is detected).
 *   - Sensitive fields are redacted (see SENSITIVE_KEY_PATTERN).
 *   - Errors are normalized to `{ errorName, errorMessage, errorStack }`.
 *   - String payload truncation to keep console output manageable.
 *   - In-memory ring buffer (default 200 entries) for the diagnostics
 *     export feature (`getRecentLogs`).
 *
 * Tests can swap the underlying sink with {@link setSink} and inspect
 * the ring buffer with {@link getRecentLogs} / clear it with
 * {@link clearLogs}.
 */

export const LEVELS = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  ERROR: 'error',
})

const LEVEL_ORDER = { debug: 10, info: 20, error: 40, silent: 100 }

/** Keys that should never make it into a log payload (case-insensitive substring match). */
const SENSITIVE_KEY_PATTERN =
  /(secret|password|passphrase|authorization|auth-token|access[-_]?key|signature|cookie|bearer)/i

/** Default cap for string fields; long values are truncated with a sentinel. */
const DEFAULT_STRING_LIMIT = 2000

/** Default ring buffer size for the in-memory diagnostics buffer. */
const DEFAULT_RING_SIZE = 200

/** localStorage key support staff can set in the browser console: `localStorage.setItem('scaffold-log-level', 'debug')`. */
export const LOG_LEVEL_OVERRIDE_KEY = 'scaffold-log-level'

const ringBuffer = []
let ringSize = DEFAULT_RING_SIZE
let currentLevel = resolveDefaultLevel()
let stackInProd = false
let sink = defaultSink

function resolveDefaultLevel() {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem(LOG_LEVEL_OVERRIDE_KEY)
      if (override && LEVEL_ORDER[String(override).toLowerCase()] !== undefined) {
        return String(override).toLowerCase()
      }
    }
  } catch {
    // localStorage unavailable (private mode, server context); fall through.
  }
  try {
    const fromEnv =
      (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) ||
      (typeof import.meta !== 'undefined' &&
        import.meta &&
        import.meta.env &&
        import.meta.env.VITE_LOG_LEVEL)
    if (fromEnv && LEVEL_ORDER[String(fromEnv).toLowerCase()] !== undefined) {
      return String(fromEnv).toLowerCase()
    }
    const isDev =
      (typeof process !== 'undefined' &&
        process.env &&
        (process.env.NODE_ENV === 'development' || process.env.DEV)) ||
      (typeof import.meta !== 'undefined' &&
        import.meta &&
        import.meta.env &&
        (import.meta.env.DEV || import.meta.env.MODE === 'development'))
    return isDev ? LEVELS.DEBUG : LEVELS.INFO
  } catch {
    return LEVELS.INFO
  }
}

function defaultSink(record) {
  if (typeof console === 'undefined') return
  const args = [`[${record.level}] ${record.event}`, record]
  if (record.level === LEVELS.ERROR) {
    console.error(...args)
  } else if (record.level === LEVELS.INFO) {
    console.info(...args)
  } else {
    if (typeof console.debug === 'function') {
      console.debug(...args)
    } else {
      console.log(...args)
    }
  }
}

/** @param {keyof typeof LEVELS | string} level */
export function setLevel(level) {
  if (!level) return
  const normalized = String(level).toLowerCase()
  if (LEVEL_ORDER[normalized] !== undefined) {
    currentLevel = normalized
  }
}

export function getLevel() {
  return currentLevel
}

/** Enable error stack capture when running with `info` (defaults to false). */
export function setIncludeStackInProd(flag) {
  stackInProd = Boolean(flag)
}

/** Override the underlying log sink (tests). Call with no args to restore. */
export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : defaultSink
}

export function setRingBufferSize(n) {
  if (typeof n === 'number' && n > 0) {
    ringSize = Math.floor(n)
    while (ringBuffer.length > ringSize) ringBuffer.shift()
  }
}

export function getRecentLogs() {
  return ringBuffer.slice()
}

export function clearLogs() {
  ringBuffer.length = 0
}

function shouldEmit(level) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]
}

function isSensitiveKey(key) {
  return typeof key === 'string' && SENSITIVE_KEY_PATTERN.test(key)
}

function truncateString(value, limit = DEFAULT_STRING_LIMIT) {
  if (typeof value !== 'string') return value
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}…[truncated ${value.length - limit} chars]`
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return truncateString(value)
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value
  if (t === 'function' || t === 'symbol') return `[${t}]`
  if (value instanceof Error) return normalizeError(value)
  if (depth > 4) return '[truncated:depth]'
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const cap = 50
    const out = value
      .slice(0, cap)
      .map((v) => sanitizeValue(v, depth + 1, seen))
    if (value.length > cap) out.push(`[+${value.length - cap} more]`)
    return out
  }
  if (t === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = '[redacted]'
      } else {
        out[k] = sanitizeValue(v, depth + 1, seen)
      }
    }
    return out
  }
  return String(value)
}

/**
 * Normalize any thrown value into a plain payload-safe object.
 * @param {unknown} err
 */
export function normalizeError(err) {
  if (!err) return null
  if (err instanceof Error) {
    const out = {
      errorName: err.name || 'Error',
      errorMessage: err.message || String(err),
    }
    if (currentLevel === LEVELS.DEBUG || stackInProd) {
      out.errorStack = truncateString(err.stack || '', 4000)
    }
    if (err.name === 'AbortError') out.isAbort = true
    if (typeof err.code !== 'undefined') out.errorCode = err.code
    return out
  }
  if (typeof err === 'object') {
    return sanitizeValue(err)
  }
  return { errorMessage: String(err) }
}

function emit(level, event, payload) {
  if (!shouldEmit(level)) return
  const record = {
    level,
    event: typeof event === 'string' && event.length > 0 ? event : 'unknown',
    ts: new Date().toISOString(),
  }
  if (payload && typeof payload === 'object') {
    const sanitized = sanitizeValue(payload)
    if (sanitized && typeof sanitized === 'object') {
      Object.assign(record, sanitized)
    } else {
      record.payload = sanitized
    }
  } else if (payload !== undefined) {
    record.payload = sanitizeValue(payload)
  }
  ringBuffer.push(record)
  while (ringBuffer.length > ringSize) ringBuffer.shift()
  try {
    sink(record)
  } catch {
    // Never throw from logging.
  }
}

export const logger = {
  debug(event, payload) {
    emit(LEVELS.DEBUG, event, payload)
  },
  info(event, payload) {
    emit(LEVELS.INFO, event, payload)
  },
  /**
   * Emit at error level. The second argument may be an `Error` (or any
   * thrown value) which is normalized into the payload, or a plain
   * payload object. When both an error and a payload are provided, the
   * payload's fields are merged on top of the normalized error data.
   *
   * @param {string} event
   * @param {unknown} errorOrPayload
   * @param {object} [extra]
   */
  error(event, errorOrPayload, extra) {
    let payload = {}
    if (errorOrPayload instanceof Error) {
      payload = normalizeError(errorOrPayload) || {}
    } else if (errorOrPayload && typeof errorOrPayload === 'object') {
      payload = errorOrPayload
    } else if (errorOrPayload !== undefined) {
      payload = { detail: errorOrPayload }
    }
    if (extra && typeof extra === 'object') {
      payload = { ...payload, ...extra }
    }
    emit(LEVELS.ERROR, event, payload)
  },
}

export default logger
