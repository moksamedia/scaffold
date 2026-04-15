/**
 * Migration state machine for localStorage → IndexedDB transition.
 *
 * States:
 *   not_started  → The app has never attempted migration.
 *   in_progress  → Migration started but has not yet committed.
 *   completed    → All data was successfully transferred and verified.
 *   failed       → Migration encountered an error; legacy data is intact.
 *
 * Transitions:
 *   not_started  → in_progress   (begin migration)
 *   in_progress  → completed     (verification passed)
 *   in_progress  → failed        (error during copy or verification)
 *   failed       → in_progress   (retry)
 *
 * The migration marker lives in IndexedDB (via the target adapter's meta store)
 * so that the source (localStorage) is never modified until migration is confirmed.
 * Legacy localStorage data is preserved until the user explicitly clears it
 * or a configurable grace period has passed.
 */

export const MIGRATION_STATES = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

const MIGRATION_META_KEY = 'migration-status'
const MIGRATION_TIMESTAMP_KEY = 'migration-completed-at'

/**
 * Read current migration status from the target adapter.
 * @param {import('./storage-adapter.js').StorageAdapter} targetAdapter
 * @returns {Promise<string>}
 */
export async function getMigrationStatus(targetAdapter) {
  const raw = await targetAdapter.getMeta(MIGRATION_META_KEY)
  if (!raw) return MIGRATION_STATES.NOT_STARTED
  try {
    const data = JSON.parse(raw)
    return data.status || MIGRATION_STATES.NOT_STARTED
  } catch {
    return MIGRATION_STATES.NOT_STARTED
  }
}

/**
 * Write migration status to the target adapter.
 * @param {import('./storage-adapter.js').StorageAdapter} targetAdapter
 * @param {string} status
 * @param {string} [error]
 */
async function setMigrationStatus(targetAdapter, status, error = null) {
  const payload = {
    status,
    updatedAt: Date.now(),
  }
  if (error) payload.error = error
  await targetAdapter.setMeta(MIGRATION_META_KEY, JSON.stringify(payload))
}

/**
 * Run the migration from source adapter (localStorage) to target adapter (IndexedDB).
 *
 * Guarantees:
 * - Source data is never modified or deleted.
 * - Target is not marked "completed" until verification passes.
 * - If an error occurs mid-copy, status is set to "failed" and source remains intact.
 * - Idempotent: re-running after "completed" is a no-op.
 *
 * @param {import('./storage-adapter.js').StorageAdapter} sourceAdapter
 * @param {import('./storage-adapter.js').StorageAdapter} targetAdapter
 * @returns {Promise<{status: string, projectCount: number, error?: string}>}
 */
export async function runMigration(sourceAdapter, targetAdapter) {
  const currentStatus = await getMigrationStatus(targetAdapter)

  if (currentStatus === MIGRATION_STATES.COMPLETED) {
    const existingProjects = await targetAdapter.loadProjects()
    return { status: MIGRATION_STATES.COMPLETED, projectCount: existingProjects.length }
  }

  await setMigrationStatus(targetAdapter, MIGRATION_STATES.IN_PROGRESS)

  let sourceProjects
  try {
    sourceProjects = await sourceAdapter.loadProjects()
  } catch (err) {
    await setMigrationStatus(targetAdapter, MIGRATION_STATES.FAILED, err.message)
    return { status: MIGRATION_STATES.FAILED, projectCount: 0, error: err.message }
  }

  if (!Array.isArray(sourceProjects)) {
    await setMigrationStatus(targetAdapter, MIGRATION_STATES.FAILED, 'Source projects not an array')
    return {
      status: MIGRATION_STATES.FAILED,
      projectCount: 0,
      error: 'Source projects not an array',
    }
  }

  try {
    await targetAdapter.saveProjects(sourceProjects)
  } catch (err) {
    await setMigrationStatus(targetAdapter, MIGRATION_STATES.FAILED, err.message)
    return { status: MIGRATION_STATES.FAILED, projectCount: 0, error: err.message }
  }

  // Verification: read back and compare count
  let verifyProjects
  try {
    verifyProjects = await targetAdapter.loadProjects()
  } catch {
    await setMigrationStatus(targetAdapter, MIGRATION_STATES.FAILED, 'Verification read failed')
    return {
      status: MIGRATION_STATES.FAILED,
      projectCount: 0,
      error: 'Verification read failed',
    }
  }

  if (verifyProjects.length !== sourceProjects.length) {
    await setMigrationStatus(targetAdapter, MIGRATION_STATES.FAILED, 'Verification count mismatch')
    return {
      status: MIGRATION_STATES.FAILED,
      projectCount: 0,
      error: 'Verification count mismatch',
    }
  }

  await setMigrationStatus(targetAdapter, MIGRATION_STATES.COMPLETED)
  await targetAdapter.setMeta(MIGRATION_TIMESTAMP_KEY, JSON.stringify(Date.now()))

  return { status: MIGRATION_STATES.COMPLETED, projectCount: sourceProjects.length }
}
