/**
 * Persistence and encryption helpers for S3 media storage credentials.
 *
 * Two storage modes are supported:
 *
 *  1. `'session'` — the secret access key never touches disk. The
 *     non-secret bits (endpoint, region, bucket, prefix, accessKeyId)
 *     are persisted; the user must paste the secret each session. Best
 *     when the device is shared.
 *
 *  2. `'persisted'` — the entire credential blob is encrypted at rest
 *     using AES-GCM with a key derived from a user passphrase via
 *     PBKDF2 (SHA-256, 200k iterations). The salt and IV are stored
 *     alongside the ciphertext but the passphrase is never stored, so
 *     a stolen IDB dump cannot be decrypted offline without it.
 *
 * Mode `'session'` keeps a credentials object in module-local memory;
 * `'persisted'` returns the unlocked credentials when `unlock()`
 * succeeds. Either way, callers feed the result into
 * {@link createS3MediaAdapter}.
 */

import { getStorageAdapter } from '../storage/index.js'

const META_KEY = 'media-s3-config'
const PBKDF2_ITERATIONS = 200_000

/**
 * @typedef {Object} S3PublicConfig
 * @property {string} endpoint
 * @property {string} region
 * @property {string} bucket
 * @property {string} prefix
 * @property {boolean} pathStyle
 * @property {string} accessKeyId  - public-ish: identifies the user
 * @property {'session' | 'persisted'} mode
 */

/**
 * @typedef {Object} S3StoredConfig
 * @property {S3PublicConfig} publicConfig
 * @property {string} [encryptedSecret] - base64 ciphertext (persisted mode)
 * @property {string} [iv]               - base64 IV
 * @property {string} [salt]             - base64 PBKDF2 salt
 */

/**
 * @typedef {Object} S3FullCredentials
 * @property {string} endpoint
 * @property {string} region
 * @property {string} bucket
 * @property {string} prefix
 * @property {boolean} pathStyle
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 */

let inMemoryCredentials = null

function bufferToBase64(buffer) {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveAesKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Save the public bits (and optionally the encrypted secret) to IDB
 * meta. Pass `secretAccessKey` and `passphrase` together for
 * `mode: 'persisted'`; omit both for `mode: 'session'` (the secret
 * lives only in memory).
 *
 * @param {S3PublicConfig} publicConfig
 * @param {{ secretAccessKey?: string, passphrase?: string }} [options]
 */
export async function saveS3Config(publicConfig, options = {}) {
  const storage = getStorageAdapter()
  const stored = { publicConfig: { ...publicConfig } }

  if (publicConfig.mode === 'persisted') {
    if (!options.secretAccessKey) {
      throw new Error('saveS3Config: secretAccessKey is required for persisted mode')
    }
    if (!options.passphrase) {
      throw new Error('saveS3Config: passphrase is required for persisted mode')
    }
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveAesKey(options.passphrase, salt)
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(options.secretAccessKey),
    )
    stored.encryptedSecret = bufferToBase64(encrypted)
    stored.iv = bufferToBase64(iv)
    stored.salt = bufferToBase64(salt)
  }

  await storage.setMeta(META_KEY, JSON.stringify(stored))

  if (options.secretAccessKey) {
    inMemoryCredentials = {
      ...publicConfig,
      secretAccessKey: options.secretAccessKey,
    }
  }
}

/**
 * Load the stored config envelope from IDB meta. Returns null when no
 * config has been saved.
 *
 * @returns {Promise<S3StoredConfig | null>}
 */
export async function loadS3Config() {
  const storage = getStorageAdapter()
  const raw = await storage.getMeta(META_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.publicConfig) return null
    return parsed
  } catch {
    return null
  }
}

/** Remove the stored config and clear in-memory credentials. */
export async function clearS3Config() {
  const storage = getStorageAdapter()
  await storage.deleteMeta(META_KEY)
  inMemoryCredentials = null
}

/**
 * Decrypt a stored persisted config using the supplied passphrase and
 * cache the resulting credentials in memory for the session.
 *
 * @param {string} passphrase
 * @returns {Promise<S3FullCredentials | null>}
 */
export async function unlockS3Config(passphrase) {
  const stored = await loadS3Config()
  if (!stored) return null
  const { publicConfig, encryptedSecret, iv, salt } = stored
  if (publicConfig.mode !== 'persisted' || !encryptedSecret || !iv || !salt) {
    return null
  }
  const key = await deriveAesKey(passphrase, base64ToBytes(salt))
  let plaintext
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) },
      key,
      base64ToBytes(encryptedSecret),
    )
  } catch {
    return null
  }
  const secretAccessKey = new TextDecoder().decode(plaintext)
  const credentials = { ...publicConfig, secretAccessKey }
  inMemoryCredentials = credentials
  return credentials
}

/**
 * Drop in-memory credentials so subsequent `getS3Credentials()` calls
 * return null until the user re-enters the secret or unlocks again.
 */
export function lockS3Config() {
  inMemoryCredentials = null
}

/**
 * Return the credentials currently held in memory, or null when the
 * vault is locked / no secret has been provided this session.
 *
 * @returns {S3FullCredentials | null}
 */
export function getS3Credentials() {
  return inMemoryCredentials
}

/**
 * Provide credentials directly (used for `mode: 'session'`). Stores the
 * secret in memory only and updates the persisted public bits.
 */
export async function setS3SessionCredentials(publicConfig, secretAccessKey) {
  await saveS3Config({ ...publicConfig, mode: 'session' })
  inMemoryCredentials = {
    ...publicConfig,
    mode: 'session',
    secretAccessKey,
  }
}
