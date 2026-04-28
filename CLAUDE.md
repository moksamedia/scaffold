All Vue code here should use the Composition API with <script setup> paradigm.

It's important to keep the README.md updated with features and information necessary to install and run application. It's also important to keep this file (CLAUDE.md) updated with basic code structure and context necessasry to save time between sessions.

All changes should be committed before and after making large changes to code or adding features.
Before starting any new feature work, confirm the git working tree is clean (`git status` shows no pending changes).
After completing each major change set, make a git commit before moving on.

# Application Overview

Scaffold is a Quasar Vue 3 application for creating and managing hierarchical outline lists with note-taking capabilities.

## Core Features
- Multiple projects with individual settings
- Infinite nesting of outline items
- Toggle between ordered/unordered lists at any level
- Root divider rows at the top level to separate sections and reset ordered numbering
- Short notes (inline) and long notes (collapsible blocks with rich text)
- Undo/redo functionality with 50-item history
- Per-project settings: font size, indent size, default list type, indent guides, and script-specific typography
- Keyboard navigation: TAB (next sibling), Shift+TAB (next item in outline)
- Auto-scroll to visible items during navigation
- Click-to-edit text interface
- IndexedDB persistence (via storage adapter abstraction)
- Export functionality: Markdown, DOCX, and JSON formats with proper formatting
- Import functionality: JSON-based project restoration and backup
- Bulk collapse/expand controls for items and notes

## File Structure

### `/src/stores/outline-store.js`
- Pinia store with all application state management
- Project CRUD operations with program-wide default settings
- List item operations (create, update, delete, move, indent/outdent)
- Root divider operations with `kind`-aware guards (`item` vs `divider`)
- Notes management (short/long notes) with visibility controls
- Undo/redo system with state snapshots
- Per-project settings storage and restoration with real-time sync
- Navigation functions for keyboard shortcuts
- Async storage via adapter (IndexedDB in production, localStorage adapter in tests)
- `initPromise` / `storeReady` for async hydration at startup; App.vue shows spinner until ready
- Export functionality integration
- Bulk collapse/expand operations for items and notes
- Versioning system: saveVersion(), restoreVersion(), getLatestVersion() with duplicate detection (all async)
- Settings synchronization between UI components
- Dual-script typography settings (Tibetan/non-Tibetan family, size, color) with program-wide defaults for new projects

### `/src/components/`
- `OutlineItem.vue` - Recursive component for rendering nested list items with q-editor enhancements
- `OutlineEditor.vue` - Main editing interface with project header, controls, export menu, bulk operations, version saving, section-aware root numbering, and root divider insertion
- `ProjectsSidebar.vue` - Left panel for project management and real-time settings controls
- `MainLayout.vue` - Application layout with sidebar toggle and settings dialog integration
- `SettingsDialog.vue` - Tabbed dialog for program-wide and project-specific settings, version history management
- `AudioPlayer.vue` - Custom audio player UI used in long-note previews
- `LongNoteRenderer.vue` - Render-function component that converts long-note HTML to VNodes and replaces native audio with `AudioPlayer`

### `/src/utils/export/`
- `markdown.js` - Markdown export functionality with HTML to markdown conversion and blockquote handling
- `docx.js` - DOCX export with dynamic nesting levels, Word styles, and paragraph structure preservation
- `json.js` - JSON export/import with schema validation, conflict resolution, format versioning, root-entry `kind` persistence (`item`/`divider`), and optional embedded `projectVersions` payload (per-project version snapshots) controlled via `exportAsJSON(..., { versionsByProjectId })`. Also attaches an optional top-level `media` map of `<sha256>: { mime, size, base64 }` populated from the local media adapter (`attachMediaPayload`); `importFromJSON` is async, hydrates the media payload via `ingestMediaPayload`, and returns `{ projects, projectVersions, importedMediaCount, warnings }`. Legacy exports without `media` continue to import cleanly. The `downloadJSON` helper uses `window.showSaveFilePicker` when available and falls back to anchor-click download.
- `zip.js` - Self-contained STORED-only ZIP reader/writer (CRC32 + PKZIP central directory layout). No DEFLATE — media is already compressed and JSON is small enough that compression doesn't justify the extra dependency. Outputs are interoperable with system zip tools.
- `scaffoldz.js` - `.scaffoldz` bundle format. `buildScaffoldzBundle(...)` writes `outline.json` plus `media/<hash>` + `media/<hash>.meta.json` entries; the inline `media` base64 map is dropped because bundle entries already carry the bytes. `importScaffoldzBundle(bytes)` ingests media into the local adapter and reuses the regular `importFromJSON` pipeline. `isZipMagic(bytes)` lets callers auto-detect bundles via the PK\\003\\004 sniff. `downloadScaffoldzBundle` mirrors `downloadJSON` (Save dialog + anchor-click fallback).

### `/src/utils/storage/`
- `storage-adapter.js` - Async storage adapter interface with `createLocalStorageAdapter()` and `createIndexedDbAdapter()` implementations. IndexedDB schema bumped to `scaffoldDb` v2: `projects`, `meta`, and `media` object stores (the `media` store is keyed by `hash` with a `lastUsedAt` index). Both adapters expose media methods: `putMedia`, `getMedia`, `hasMedia`, `deleteMedia`, `listMediaHashes`, `getMediaStats`. Bytes are stored as `ArrayBuffer` in IDB to be portable across real browsers and `fake-indexeddb`.
- `index.js` - Singleton accessor (`getStorageAdapter()` / `setStorageAdapter()`) used by store and components
- `migration.js` - State machine for localStorage → IndexedDB migration (not used at runtime; retained for reference)

### `/src/utils/media/`
- `adapter.js` - `MediaStorageAdapter` interface; `createMediaStorageAdapter(getStorageAdapter)` wraps the active storage adapter so the same code runs against IndexedDB and against OPFS / user-folder / S3 backends.
- `index.js` - Singleton accessors `getMediaAdapter()` / `setMediaAdapter()` and `getMediaResolver()` / `setMediaResolver()`, plus `resetMediaAdapter()` / `resetMediaResolver()` used by `tests/setup.js`. `selectMediaAdapter()` performs capability-based selection at boot in priority order: S3+cache → user-folder → OPFS → IDB.
- `hash.js` - SHA-256 hex helpers (`sha256Hex`, `sha256HexFromString`, `isValidSha256Hex`).
- `references.js` - The `scaffold-media://<hash>` URL scheme: `buildMediaRef`, `parseMediaRef`, `extractRefHashesFromHtml`, `collectProjectRefHashes`, plus HTML rewriters `rewriteDataUrisToRefs`, `rewriteRefsWith`, `normalizeHtmlToRefs`, and `transformLongNoteHtmlInPlace`. The protocol is intentionally not a real URL; the renderer/editor never lets it reach the network.
- `ingest.js` - `ingestBlob`, `ingestDataUrl`, `dataUrlToBlob`, `blobToBase64`, `base64ToBlob`. Idempotent: same bytes ingested twice keeps the original `createdAt`.
- `resolver.js` - `createMediaResolver(getAdapter)` caches one `URL.createObjectURL(blob)` per hash for the page lifetime, with `toObjectUrl`, `syncUrl`, `ensureMany`, and `dispose`.
- `gc.js` - `runMediaGc({ now, graceMs })` performs mark-and-sweep over the live set built from persisted projects + version meta entries. The default 24h grace window protects newly uploaded blobs that haven't yet been saved into a long note. `collectLiveMediaHashes` is exported for tests.
- `migration.js` - One-time, idempotent migration that ingests inline `data:image/...` and `data:audio/...` URIs from both projects and version snapshots and rewrites them to references. Triggered automatically from `outline-store.js`'s `initPromise`.
- `opfs-adapter.js` - Phase 2: `MediaStorageAdapter` implementation backed by `navigator.storage.getDirectory()` (the Origin Private File System). Mirrors the IDB layout with `.meta.json` sidecars; capability-detected at boot via `isOpfsAvailable()`.
- `userfolder-adapter.js` - Phase 3: `MediaStorageAdapter` backed by a folder picked via `window.showDirectoryPicker()`. Persists the directory handle in a private IDB database (`scaffoldHandles`) so the same folder is used across reloads, and re-prompts for permission on the next user gesture.
- `layered-adapter.js` - Composes multiple adapters (writes to the primary, reads fall through to secondaries with lazy promotion). Used to expose existing IDB content seamlessly under newer backends.
- `cached-adapter.js` - Read-through cache wrapper: writes go to the durable backend first (S3) then mirror into a local cache (OPFS or IDB); reads check the cache first and promote remote hits. Optional `localGcOnly: true` makes `delete()` cache-only and routes `listHashes`/`getStats` to the cache so a multi-device shared bucket isn't pruned by this client's automated GC. `forceDeleteFromRemote(hash)` always evicts the remote (preferring `remote.forceDelete` when available) and is the explicit "purge from S3" path used by the project-deletion prompt.
- `sigv4.js` - Self-contained AWS Signature V4 implementation built on Web Crypto. Used by the S3 adapter; verified against AWS' canonical "get-vanilla" SigV4 test vector.
- `s3-adapter.js` - Phase 4: `MediaStorageAdapter` against any S3-compatible endpoint (AWS, Cloudflare R2, MinIO, Backblaze B2, Wasabi). Performs HEAD/GET/PUT/DELETE/ListObjectsV2 with pagination; idempotent PUTs because keys are content hashes (`<prefix>/<hash>`). The optional `sharedBucket: true` config flag makes `delete()` a no-op (multi-device safety) while `forceDelete(hash)` always issues the DELETE — used by the user-confirmed remote-eviction path.
- `s3-config.js` - Persistence helpers for S3 credentials. Two modes: `'session'` (secret kept only in memory) and `'persisted'` (secret encrypted with AES-GCM via a PBKDF2-derived key from the user's passphrase). Exposes `saveS3Config`, `loadS3Config`, `unlockS3Config`, `lockS3Config`, `clearS3Config`, `getS3Credentials`, `setS3SessionCredentials`.

### `/tests/`
- Test runner: Vitest with happy-dom environment
- `tests/setup.js` - Global setup (storage clear, anchor click stub, localStorage adapter injection, media adapter/resolver reset, `URL.createObjectURL`/`revokeObjectURL` stubs for happy-dom)
- `tests/fixtures/projects.js` - Canonical project/item/divider factory helpers
- `tests/json-export-import.test.js` - JSON export/import validation, normalization, roundtrip, and media payload round-trip
- `tests/project-tab-lock.test.js` - Tab lock freshness, ownership, and edge cases
- `tests/outline-store.test.js` - Pinia store integration: CRUD, outline ops, undo/redo, persistence, legacy migration, plus `findOrphanedMediaForProjectRemoval` orphan-set semantics and the `deleteProject(id, { purgeRemoteMedia })` shared-bucket purge path
- `tests/markdown-export.test.js` - Markdown generation: numbering, nesting, dividers, notes
- `tests/docx-export.test.js` - DOCX generation structural smoke tests
- `tests/version-storage.test.js` - Version serialization/parsing with LZ compression and the reference-only invariant for new version snapshots
- `tests/version-smart-trim.test.js` - Smart trim retention bands and idempotency
- `tests/storage-adapter.test.js` - Shared contract tests for both localStorage and IndexedDB adapters (uses fake-indexeddb), including the media interface
- `tests/migration.test.js` - Migration state machine: success, idempotency, partial failure, corrupt data, retry
- `tests/media-hash.test.js` - SHA-256 helpers and hash validation
- `tests/media-references.test.js` - HTML scan/rewrite + project-tree walking for `scaffold-media://<hash>` references
- `tests/media-ingest.test.js` - Data URI / Blob ingest, encode/decode roundtrip
- `tests/media-resolver.test.js` - Cached blob URL resolution and disposal
- `tests/media-gc.test.js` - Mark-and-sweep over projects + version meta entries with grace window
- `tests/media-migration.test.js` - One-time `data:` URI → reference migration on projects and version snapshots
- `tests/media-opfs-adapter.test.js` - OPFS adapter contract using an in-memory `FileSystemDirectoryHandle` stub
- `tests/media-layered-adapter.test.js` - Multi-tier adapter behavior, lazy promotion, unified stats
- `tests/media-select-adapter.test.js` - Capability-based selection priority across S3, user-folder, OPFS, and IDB tiers
- `tests/media-sigv4.test.js` - SigV4 signing verified against AWS' "get-vanilla" canonical test vector
- `tests/media-s3-adapter.test.js` - S3 adapter HEAD/GET/PUT/DELETE/LIST against a mock fetch, including ListObjectsV2 pagination, `sharedBucket=true` no-op `delete()`, and `forceDelete()` bypass
- `tests/media-cached-adapter.test.js` - Read-through cache semantics: cache hits, lazy promotion, write-through to remote, plus `localGcOnly` mode and the `forceDeleteFromRemote` escape hatch (with and without the underlying `remote.forceDelete`)
- `tests/media-s3-config.test.js` - S3 credential persistence: session-mode in-memory only, persisted-mode AES-GCM/PBKDF2 round-trip, lock/clear semantics
- `tests/zip.test.js` - STORED-only ZIP encoder/decoder round-trips, CRC32, magic numbers, UTF-8 paths
- `tests/scaffoldz-bundle.test.js` - `.scaffoldz` bundle round-trip: media files + outline.json layout, magic-byte detection, re-ingestion on import
- `tests/fixtures/in-memory-opfs.js` - In-memory `FileSystemDirectoryHandle` stub for OPFS-style tests

### Key Technical Patterns
- Reactive Vue 3 Composition API throughout
- Pinia for centralized state management
- Recursive component rendering for infinite nesting
- Command pattern for undo/redo with context-aware keyboard handling
- Click-to-edit pattern for text input
- Per-project settings architecture
- Conditional scrolling for keyboard navigation
- State watchers for dialog lifecycle management

### Recent Implementations
- Per-project settings storage (font size, indent size, list type, indent guides)
- Dual-script typography:
  - Program-wide defaults for new projects only
  - Per-project override values used as rendering source of truth
  - Regex-based run segmentation for Tibetan vs non-Tibetan display text
- TAB navigation: cycles through siblings, Shift+TAB navigates to next item in outline hierarchy
- Conditional scroll-to-view that only scrolls if item is not already visible
- Rich text editor for long notes with lists, indentation, quotes, code blocks, links, images
- Export system: Markdown, DOCX, and JSON formats with proper formatting
- Root divider sections:
  - Divider rows are root-level structural separators
  - Ordered numbering resets after each divider in UI and exports
  - Markdown exports divider as `---`
  - DOCX exports divider as separator paragraph and uses per-section ordered numbering references
- DOCX export features:
  - Dynamic nesting level detection and numbering system generation
  - Word style application: List Paragraph, Comment, Block Quotation
  - Paragraph structure preservation for long notes with blockquote handling
  - Line break preservation within formatted text
  - Configurable indentation parameters
- Markdown export improvements:
  - Proper blockquote handling with line break preservation
  - Multi-line blockquotes with correct markdown syntax
- JSON export/import system:
 - Complete project backup with all settings and data
 - Schema validation and error handling
 - Conflict resolution for duplicate projects
 - Format versioning for future compatibility
 - Optional embedded version history (`projectVersions`) on both single-project and Export All flows; opt-in checkbox in the export dialogs (`OutlineEditor.vue` and `ProjectsSidebar.vue`)
 - Import re-keys version meta entries (`scaffold-version-${projectId}-${versionId}`) to the destination project id when duplicate-project rename produces a fresh id, and rewrites embedded `data.projects[0].id` so dedupe and restore continue to work
- Bulk operations: collapse/expand all items and all long notes separately
- Modular export architecture with separate utility files
- Context-aware keyboard shortcuts: undo/redo directed to long note editor when active
- GitHub Pages deployment with automatic CI/CD via GitHub Actions
- Comprehensive versioning system:
  - Per-project version history stored via adapter meta store
  - Manual and automatic versioning triggers
  - Duplicate version detection to prevent saving identical versions
  - Version restoration as new projects
  - Individual version export as JSON
  - Version statistics tracking (items, notes count)
- Settings synchronization:
  - Direct binding between settings dialog and left panel controls
  - Program-wide settings as defaults for new projects
  - Real-time sync across all UI components
- Q-Editor enhancements:
  - Tab/Shift+Tab keyboard shortcuts for indenting
  - Custom button to strip line breaks from selected text
  - Autosave functionality with debouncing
- Long-note media support (Tier 1):
  - Dedicated toolbar actions for image URL insertion, small image uploads, and audio file uploads
  - Dedicated toolbar action to remove selected embedded audio players
  - Backspace/Delete adjacent to an embedded audio player removes it (with empty wrapper paragraph cleanup)
  - Custom `AudioPlayer.vue` component renders embedded audio in long-note previews with full styling control
  - `LongNoteRenderer.vue` parses long-note HTML into VNodes, swapping `<audio>` for `AudioPlayer` while preserving typography
- Content-addressable media storage architecture (Phase 1):
  - Long-note HTML carries `scaffold-media://<hash>` references instead of inline `data:` URIs; bytes are resolved to blob URLs only at render/edit time.
  - Identical media collapses to a single record across uploads, projects, devices, and JSON imports (SHA-256 of raw bytes).
  - `OutlineItem.vue` long-note dialog expands refs to blob URLs on open and collapses blob URLs / pasted data URIs back to refs on save (`expandRefsForEditor`, `collapseRefsForStorage`). Image and audio upload handlers ingest into the media adapter and insert markup tagged with `data-media-hash="<hash>"`.
  - `LongNoteRenderer.vue` resolves refs through the global `MediaResolver` and re-renders when newly available URLs become resolved; falls back to a styled "media unavailable" placeholder when a hash can't be resolved.
  - `outline-store.js` runs the data-URI migration on `initPromise`, exposes `mediaUsage` (count + bytes), and triggers `runMediaGc` on project/long-note delete and on a 10-minute idle timer (`startMediaGcTimer`).
  - `SettingsDialog.vue` Project storage banner now sums per-project image/audio bytes by reading the media adapter for each unique referenced hash, instead of regex-scanning HTML for inline `data:` URIs.
  - `json.js` adds the optional top-level `media` map on export (via `attachMediaPayload`) and hydrates it on import (via `ingestMediaPayload`); long-note HTML, version snapshots, and exported project payloads stay reference-only.
- Pluggable media storage backends (Phases 2–4):
  - Capability-based selection at boot via `selectMediaAdapter()`. Priority (highest to lowest): S3-with-cache → user-picked folder → OPFS → IndexedDB.
  - Phase 2 — OPFS adapter (`opfs-adapter.js`) layered with IDB through `layered-adapter.js`; reads fall through to IDB and lazily promote into OPFS on first hit.
  - Phase 3 — User-picked folder adapter (`userfolder-adapter.js`) using `window.showDirectoryPicker()`. The directory handle is persisted in a private `scaffoldHandles` IndexedDB; permission is re-requested on the next user gesture. Settings dialog (Program tab) exposes "Choose folder…" / "Disconnect" controls and a live backend label.
  - Phase 3 — JSON exports use `window.showSaveFilePicker` when supported (true Save dialog), with the anchor-click download as a fallback.
  - Phase 4 — S3-compatible adapter (`s3-adapter.js`) with self-contained SigV4 signing (`sigv4.js`), CORS-friendly HEAD/GET/PUT/DELETE, paginated ListObjectsV2 for `listHashes` / `getStats`. Wrapped by `cached-adapter.js` so writes go to S3 first (durability) and reads check the local cache first (speed + offline-tolerant).
  - Phase 4 — Credential persistence (`s3-config.js`): `'session'` keeps the secret in memory only; `'persisted'` encrypts the secret with AES-GCM using a PBKDF2-derived key from a user passphrase. The Settings dialog gates the locked vault behind a passphrase prompt before the adapter activates.
  - Phase 4.5 — Shared-bucket mode (`s3Form.sharedBucket` checkbox in `SettingsDialog.vue`). When enabled, the bucket is treated as multi-tenant: `s3-adapter.js` `delete()` becomes a no-op so this device's automated GC can't remove bytes another device may still reference, and `cached-adapter.js` runs in `localGcOnly` mode so `listHashes`/`getStats` walk the local cache instead of round-tripping every object on S3. Project deletion gains an opt-in prompt: `findOrphanedMediaForProjectRemoval(projectId)` computes hashes uniquely held by the project (residual = other projects + ALL persisted version snapshots), and `deleteProject(id, { purgeRemoteMedia: true })` calls `purgeRemoteMediaHashes` → `cached-adapter.forceDeleteFromRemote` → `s3-adapter.forceDelete` for those hashes BEFORE removing the project locally. Backends without `forceDeleteFromRemote` (purely local IDB / OPFS / user-folder) hide the prompt entirely.
  - Phase 5 — `.scaffoldz` bundle export/import (`zip.js`, `scaffoldz.js`). Same data shape as JSON exports but media bytes are stored as separate `media/<hash>` files in a STORED-only zip, avoiding base64 inflation. `OutlineEditor.vue` and `ProjectsSidebar.vue` expose a format radio (`json` vs `scaffoldz`) in their export dialogs; the import handler auto-detects the format via extension or magic bytes.
  - Store wiring: `outline-store.js` exposes `mediaBackend` (active backend label), `reselectMediaBackend()`, `findOrphanedMediaForProjectRemoval(projectId)`, and `purgeRemoteMediaHashes(hashes)`. `deleteProject` is async and accepts `{ purgeRemoteMedia }` to drive the shared-bucket eviction path.
- Storage safety guardrails:
  - High-storage-usage warning based on adapter usage/quota stats
  - User-facing save error when persistence fails (including quota overflow scenarios)
- Show/hide all long notes toggle for quick overview
