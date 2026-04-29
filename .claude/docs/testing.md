# Tests (`tests/`)

- **Runner**: Vitest, **happy-dom**.
- **`setup.js`**: Clears storage, stubs downloads/URLs, swaps storage + media adapters for isolation.

## Coverage areas (mirror `tests/*.test.js` when touching these areas)

- **Outline store**: CRUD, outline ops, undo, persistence, media orphan/purge/sync/inventory helpers.
- **Export**: Markdown/DOCX/JSON/`scaffoldz`, long-note color round-trip.
- **Storage / migration**: adapters, legacy migration, IDB+fakes.
- **Media**: hashes, refs, ingest, resolver, GC (incl. **cross-context** regression), tiers (OPFS layered, cached, S3 mock, select priority), SigV4 vector.
- **Context**: registry, scoped adapter, migration, store switching, clone flows, cross-context media unions.
- **Versions**: LZ snapshots, smart trim.
- **Logger**: gating, redaction, ring buffer.
- **Zip**: STORED codec + UTF-8 paths.
