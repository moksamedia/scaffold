/**
 * Tests for S3 credential storage. Verifies session-mode keeps secrets
 * in memory only, persisted-mode encrypts via PBKDF2 + AES-GCM and
 * round-trips with the right passphrase, and clear/lock evict
 * everything.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setStorageAdapter } from 'src/utils/storage/index.js'
import { createLocalStorageAdapter } from 'src/utils/storage/storage-adapter.js'
import {
  saveS3Config,
  loadS3Config,
  clearS3Config,
  unlockS3Config,
  lockS3Config,
  getS3Credentials,
  setS3SessionCredentials,
  rememberS3UnlockPassphrase,
  getRememberedS3UnlockPassphrase,
  clearRememberedS3UnlockPassphrase,
} from 'src/utils/media/s3-config.js'

const PUBLIC_CONFIG = {
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  bucket: 'scaffold-test',
  prefix: 'scaffold/media',
  pathStyle: true,
  accessKeyId: 'AKIDEXAMPLE',
  mode: 'persisted',
}

describe('S3 config persistence', () => {
  beforeEach(() => {
    setStorageAdapter(createLocalStorageAdapter())
    lockS3Config()
    clearRememberedS3UnlockPassphrase()
  })

  it('persisted mode encrypts the secret and unlocks with the right passphrase', async () => {
    await saveS3Config(PUBLIC_CONFIG, {
      secretAccessKey: 'super-secret',
      passphrase: 'correct horse battery staple',
    })
    lockS3Config()
    expect(getS3Credentials()).toBeNull()

    const stored = await loadS3Config()
    expect(stored?.encryptedSecret).toBeTruthy()
    expect(stored?.iv).toBeTruthy()
    expect(stored?.salt).toBeTruthy()
    expect(stored.publicConfig.accessKeyId).toBe('AKIDEXAMPLE')

    const unlocked = await unlockS3Config('correct horse battery staple')
    expect(unlocked?.secretAccessKey).toBe('super-secret')
    expect(getS3Credentials()?.secretAccessKey).toBe('super-secret')
  })

  it('persisted mode returns null on wrong passphrase, leaves vault locked', async () => {
    await saveS3Config(PUBLIC_CONFIG, {
      secretAccessKey: 'super-secret',
      passphrase: 'right',
    })
    lockS3Config()
    const result = await unlockS3Config('wrong')
    expect(result).toBeNull()
    expect(getS3Credentials()).toBeNull()
  })

  it('session mode never writes the secret to storage', async () => {
    await setS3SessionCredentials({ ...PUBLIC_CONFIG, mode: 'session' }, 'in-memory-only')
    const stored = await loadS3Config()
    expect(stored?.encryptedSecret).toBeUndefined()
    expect(stored?.publicConfig.mode).toBe('session')
    expect(getS3Credentials()?.secretAccessKey).toBe('in-memory-only')
  })

  it('clearS3Config evicts both persisted bytes and in-memory credentials', async () => {
    await saveS3Config(PUBLIC_CONFIG, {
      secretAccessKey: 's',
      passphrase: 'p',
    })
    await clearS3Config()
    expect(await loadS3Config()).toBeNull()
    expect(getS3Credentials()).toBeNull()
  })

  it('saveS3Config validates persisted-mode requirements', async () => {
    await expect(saveS3Config(PUBLIC_CONFIG)).rejects.toThrow(/secretAccessKey/)
    await expect(
      saveS3Config(PUBLIC_CONFIG, { secretAccessKey: 's' }),
    ).rejects.toThrow(/passphrase/)
  })

  it('can remember and clear unlock passphrase in localStorage', () => {
    expect(getRememberedS3UnlockPassphrase()).toBe('')
    rememberS3UnlockPassphrase('local-passphrase')
    expect(getRememberedS3UnlockPassphrase()).toBe('local-passphrase')
    clearRememberedS3UnlockPassphrase()
    expect(getRememberedS3UnlockPassphrase()).toBe('')
  })
})
