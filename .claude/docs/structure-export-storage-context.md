# Export, storage, context, palette

## `utils/export/`

| Module | Responsibility |
|--------|----------------|
| `markdown.js` | HTML → Markdown, blockquotes, dividers |
| `docx.js` | Word styles, nesting, long-note structure |
| `json.js` | Schema, conflict handling, optional `projectVersions`; optional top-level **`media`** map (`sha256` → `{ mime, size, base64 }`); `attachMediaPayload` / `ingestMediaPayload`; async import; root `kind` for items/dividers; `downloadJSON` prefers `showSaveFilePicker` |
| `zip.js` | STORED-only ZIP (CRC32/PKZIP); interoperable |
| `scaffoldz.js` | `.scaffoldz`: `outline.json` + `media/<hash>` (+ sidecar meta); `isZipMagic` detection; ingest reuses JSON import |

## `utils/storage/`

- **`storage-adapter.js`**: `createLocalStorageAdapter` / `createIndexedDbAdapter`; IDB schema `scaffoldDb` v2: `projects`, `meta`, `media` (keyed by hash); media helpers on both adapters (`putMedia`, `getMedia`, etc.).
- **`context-scoped.js`**: `createContextScopedAdapter(base, contextId)` — meta under `ctx:<id>:`; **media calls pass through** (shared content-addressable store across contexts).
- **`index.js`**: Singleton `get/setStorageAdapter`; `getBaseStorageAdapter`; active context pinning (`set/getActiveContextId`).
- **`migration.js`**: Historical localStorage→IDB state machine (reference).

## `utils/context/`

- **`session.js`**: Registry CRUD, active id persistence; `cloneContextData`; `authProvider` / `externalSubject` placeholders for future auth.
- **`migration.js`**: One-time legacy → `ctx:default:*` namespaces when registry missing.

## `utils/color/long-note-palette.js`

- `normalizeHexColor`, `isValidHexColor`, `generateComplementaryPalette(root)` (six soft pastels), `pushRecentCustomColor` (max 5, deduped). Default root `#80aaff`.
