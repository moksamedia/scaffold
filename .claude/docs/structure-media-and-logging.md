# Media subsystem and logging (`utils/media/` + `utils/logging/`)

## Core concepts

- **Refs**: HTML uses `scaffold-media://<hash>` — not network URLs.
- **`adapter.js`**: `MediaStorageAdapter`; `createMediaStorageAdapter(getStorageAdapter)`.
- **`index.js`**: `get/setMediaAdapter`, `get/setMediaResolver`; `selectMediaAdapter()` priority: **S3+cache → user folder → OPFS → IDB**.
- **`hash.js`**: SHA-256 helpers.
- **`references.js`**: Parse/build refs, rewrite `data:` → refs, normalize HTML for storage.
- **`ingest.js`**: Blob/data-URL ingestion; idempotent `createdAt` on duplicates.
- **`resolver.js`**: One blob URL per hash per session (`ensureMany`, `dispose`).
- **`gc.js`**: Mark-and-sweep; **`collectLiveMediaHashes` unions all contexts** via base adapter + registry (critical: media is per-origin, not per-context). `collectLiveMediaHashesExcludingProject` for shared-bucket eviction prompts. Grace window (~24h) for not-yet-saved blobs.
- **`migration.js`**: One-time inline `data:` → refs on projects + version snapshots (`initPromise`).

## Backend tiers

| Piece | Role |
|-------|------|
| `opfs-adapter.js` | OPFS; layered over IDB for migration |
| `userfolder-adapter.js` | `showDirectoryPicker`; handle in `scaffoldHandles` IDB |
| `layered-adapter.js` | Primary writes, read fall-through + lazy promote |
| `cached-adapter.js` | S3 durable + local cache; `localGcOnly` for shared bucket; **`forceDeleteFromRemote`**; **`backfillRemoteFromCache`**; **`getCached`** (no remote GET for inventory rows) |
| `s3-adapter.js` | SigV4, HEAD/GET/PUT/LIST; `sharedBucket` ⇒ `delete()` no-op on remote; **`forceDelete`** explicit |
| `s3-config.js` | Session vs passphrase-encrypted persisted credentials |

## Operational notes that bite

- Shared-bucket GC + project deletion: orphaned detection uses **`collectLiveMediaHashesExcludingProject`** so other contexts/version snapshots retain refs.
- S3 passphrase + user-folder handles: **namespaced per active context**.
- **`outline-store`** exposes GC triggers, optional `purgeRemoteMedia` on delete, backfill/sync helpers (`mediaBackendSupportsRemoteSync`, `getUnsyncedMediaForProject`, `backfillMediaToRemote`), **`getProjectMediaInventory`**.

## Logging (`utils/logging/logger.js`)

- Levels: `debug`, `info`, `error`; schema `{ level, event, ts, ...payload }`; redaction of secrets; error normalization.
- **`LOG_LEVEL_OVERRIDE_KEY`**: e.g. `localStorage.setItem('scaffold-log-level', 'debug')`.
- Ring buffer → **Settings → Diagnostics** (copy/download JSON); tests swap `setSink`; `tests/setup` silences/restores sink.
