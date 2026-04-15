# Test Suites Guide

This document explains what each automated test suite covers and why those tests exist.

## Goals

- Protect non-UI business logic where regressions are most expensive.
- Verify import/export and persistence contracts across legacy and migration paths.
- Keep tests resilient by preferring behavior assertions over brittle implementation details.

## Test Runner and Environment

- Runner: `Vitest`
- Environment: `happy-dom`
- Setup: `tests/setup.js` resets browser storage and stubs download-click behavior.
- Fixtures: `tests/fixtures/projects.js` provides reusable canonical project/item/divider factories.

## Suite-by-Suite Coverage

### `tests/outline-store.test.js`

**Covers**
- Project CRUD and project switching behavior.
- Core outline operations (add, delete, move, indent/outdent, list-type toggles).
- Note operations (short/long notes, collapse, visibility).
- Undo/redo history and stack boundaries.
- LocalStorage roundtrip loading and migration of legacy shapes.
- Lock-aware startup/project selection branches.
- Import and versioning edge branches (`importFromJSONFile`, `saveVersion`, auto-versioning paths).

**Rationale**
- `outline-store.js` is the highest-risk logic surface. A failure here affects nearly every user action.
- Integration-style tests catch interactions between multiple store features that unit tests miss.

### `tests/json-export-import.test.js`

**Covers**
- JSON export envelope and project selection behavior.
- Schema validation error/warning branches.
- Divider/item normalization, parent-child reconstruction, and settings defaults.
- Export/import roundtrip integrity.

**Rationale**
- JSON import/export is the backup and migration contract. Breakage risks user data loss.

### `tests/markdown-export.test.js`

**Covers**
- List marker behavior (ordered/unordered), nesting indentation, divider reset sections.
- Note rendering rules including blockquote output and basic HTML-to-markdown conversion.

**Rationale**
- Markdown output is user-facing and must preserve outline semantics and note meaning.

### `tests/docx-export.test.js`

**Covers**
- Broad smoke coverage of DOCX generation across common content combinations.

**Rationale**
- Ensures normal export paths do not throw for realistic project structures.

### `tests/docx-export-structure.test.js`

**Covers**
- Semantic branches via `docx` module mock: numbering section resets, blockquote style mapping, fallback paragraph path, and error handling branch.

**Rationale**
- Improves branch confidence without brittle binary snapshot testing of `.docx` output.

### `tests/project-tab-lock.test.js`

**Covers**
- Tab ID generation and reuse.
- Lock write/read/freshness rules.
- Same-tab vs other-tab lock ownership behavior.
- Malformed lock payload tolerance.

**Rationale**
- Locking prevents multi-tab editing conflicts. Incorrect logic can silently overwrite data.

### `tests/version-storage.test.js`

**Covers**
- Version serialization/parsing for plain JSON and compressed payloads.
- Corrupt payload handling.

**Rationale**
- Version storage format must remain backward compatible for restores and pruning tools.

### `tests/version-smart-trim.test.js`

**Covers**
- Retention-window logic for auto-interval versions.
- Idempotency of trimming.
- Project-wide trimming paths, malformed `outline-projects`, and selective trimming.

**Rationale**
- Smart trim protects storage quota while preserving useful restore points.

### `tests/storage-adapter.test.js`

**Covers**
- Contract behavior for the localStorage adapter (CRUD, metadata, stats).

**Rationale**
- The adapter contract is the seam between current storage and future IndexedDB backend.

### `tests/migration.test.js`

**Covers**
- Migration state machine transitions and idempotency.
- Success path, verification checks, partial failure behavior, retry, malformed source payloads.
- Non-destructive guarantee for legacy source data.

**Rationale**
- Migration is a high-risk operation; tests focus on data safety and restartability.

## How to Run

- Run all tests: `npm test`
- Run coverage: `npm run test:coverage`
- Watch mode: `npm run test:watch`

## Design Principles Used in This Test Set

- Assert behavior contracts, not implementation internals.
- Include explicit regression tests for previously tricky branches.
- Use realistic fixtures for nested outlines, dividers, and notes.
- Keep migration tests deterministic and idempotent-focused.
