# Store and UI (`src/`)

## `stores/outline-store.js` (Pinia)

- Projects, outline tree, dividers (`kind`: `item` | `divider`), move/indent/outdent, undo/redo (50 snapshots).
- Notes: short/long; long-note palette helpers (`long-note-palette.js`): `collapsedBgColor`, `setLongNoteBackground`, project-level `longNoteColorRoot` / `longNoteBgOpacity` / `longNoteRecentCustomColors`.
- **Contexts**: registry `contexts`, `activeContextId`, `switchingContext`; `initContexts()` → legacy migration + active pinning → `loadFromStorage()` → `hydrateActiveContext()` (media, GC timer, auto-versioning). APIs: `switchContext`, `createNewContext(_, { activate, cloneFromCurrent })`, `renameContextById`, `deleteContextById`, `refreshContextRegistry`. `createNewContext` with `cloneFromCurrent: true` runs `flushPersistence()` before fork. `switchContext` sets `switchingContext` synchronously before first await so the app spinner appears immediately; `teardownAutoVersioning()` prevents leaking timers/handlers across switches.
- Versioning (async): save / restore / latest; duplicate detection.
- Typography: Tibetan vs non-Tibetan overrides + program defaults for **new** projects only.
- `initPromise` / `storeReady`; export hooks; bulk collapse/expand.

## Components (`components/`)

| File | Role |
|------|------|
| `OutlineItem.vue` | Recursive outline + long-note dialog (q-editor, media tooling) |
| `OutlineEditor.vue` | Main canvas: exports, versioning, bulk ops, dividers |
| `ProjectsSidebar.vue` | Projects + live settings |
| `MainLayout.vue` | Shell, sidebar toggle, context switcher hookup |
| `ContextSwitcher.vue` | Context CRUD/subscribe (`contexts`, `activeContextId`, `switchingContext`) |
| `SettingsDialog.vue` | Program/project tabs, versions, S3/user-folder/media inventory/diagnostics |
| `AudioPlayer.vue` | Long-note audio UI |
| `LongNoteRenderer.vue` | Parses long-note HTML → VNodes; swaps `<audio>` for `AudioPlayer` |
