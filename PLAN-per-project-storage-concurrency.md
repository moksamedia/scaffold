# Per-project multi-tab save guard

Plan: optimistic concurrency per project so different browser tabs can edit different projects without clobbering each other, while a stale tab cannot overwrite newer on-disk data for the same project.

## Implementation todos

- [ ] **model-revision** — Add `persistRevision` to projects; migrate in `loadFromLocalStorage`; default in `createProject` / import JSON
- [ ] **dirty-baseline** — Track `dirtyProjectIds` + `baselinePersistRevision`; `markProjectDirty` from mutating store actions
- [ ] **merge-save** — Replace `saveToLocalStorage` with read-merge-check-write + sync `projects.value` from merged result
- [ ] **conflict-ux** — Surface conflict to user (notify/dialog + reload path)
- [ ] **optional-storage** — Optional: `storage` listener to refresh non-dirty projects from disk
- [ ] **qa-docs** — Manual two-tab scenarios; note behavior in README/CLAUDE if desired

## Goal

- **Different tabs** may edit **different projects**; saves must **not drop** updates another tab wrote to other projects.
- **Same project** in two tabs: the tab with **stale** data must **not** overwrite **newer** persisted data; **warn** the user (and offer reload / discard local for that conflict case).

This is **not** a three-way merge of outline content—it is **optimistic locking per project** plus **taking non-dirty projects from disk** when building the blob to write.

## Revision token (integer vs timestamp)

The plan uses **`persistRevision`** as an integer. Alternatively, a **persist-only timestamp** (e.g. `lastPersistedAt` as `Date.now()` ms) updated **only** on successful persist works similarly. Do **not** reuse **`updatedAt`** for the guard unless it is bumped **only** on persist (it is currently bumped on many edits). Integers avoid clock skew; timestamps aid debugging.

## Data model

- Add **`persistRevision`** (integer, monotonic per project, bumped only when that project’s row is successfully written as part of a save) on each project object in [`src/stores/outline-store.js`](src/stores/outline-store.js).
- Migrate in **`loadFromLocalStorage`**: if missing, set `persistRevision` to `0` or `1` for all projects.
- Ensure **JSON export/import** in [`src/utils/export/json.js`](src/utils/export/json.js) carries `persistRevision` through (default on import when absent).

## In-memory tracking (this tab)

- **`dirtyProjectIds`**: `Set` or reactive structure of project IDs mutated in this tab since last successful save (or since load).
- **`baselinePersistRevision`**: map `projectId -> number` captured when this tab last **loaded** or **successfully saved** that project from disk.

**`markProjectDirty(projectId)`** (internal): call from mutation paths that change project data. Add **`markProjectDirty`** and call it from each store action that mutates a project (outline items, settings, rename, create, delete, import merge, etc.). **Create project** marks new id dirty; **delete project** must be represented (see save algorithm).

## Save algorithm (`saveToLocalStorage`)

Replace the single `setItem` of `projects.value` with:

1. **`diskProjects`** = `JSON.parse(localStorage.getItem('outline-projects') || '[]')` (guard parse errors).
2. Build **`diskById`** / **`memoryById`** maps from `diskProjects` and `projects.value`.
3. **Conflict check** (before mutating anything): for every `id` in **`dirtyProjectIds`**, if `diskById[id]` exists and `diskById[id].persistRevision !== baselinePersistRevision[id]`, **abort save**, set a store flag or return a result the UI can use, **Quasar notify/dialog**: “This project was saved in another window; reload to get the latest data.” Do not write `outline-projects`.
4. **Build `merged` array** (authoritative list of projects to persist):
   - **Order**: preserve a stable rule (e.g. **memory order** for `projects.value`, then append any **disk-only** ids not in memory so another tab’s **new project** is not dropped—detail to implement carefully).
   - For each project **id** in the chosen union:
     - If **id ∈ dirtyProjectIds**: take **memory** copy; set `persistRevision = (disk.persistRevision ?? baseline) + 1` (or increment from max(disk, baseline)).
     - If **not dirty**: take **disk** copy if present, else **memory** (new id only in memory).
   - **Deletions**: ids present on disk but **absent** from `projects.value` mean this tab deleted them—**omit** from `merged` (document as intentional; rare cross-tab delete conflicts can be noted as out-of-scope or “last writer wins on full list”).
5. Assign **`projects.value = merged`** so non-dirty projects **pick up** other tabs’ updates from disk in memory (avoids persisting stale copies of projects this tab did not edit).
6. `localStorage.setItem('outline-projects', JSON.stringify(projects.value))` and the existing sibling keys unchanged.
7. On success: update **`baselinePersistRevision`** for all projects in `merged` from their new `persistRevision`; **clear `dirtyProjectIds`**.

## UX

- **Conflict**: dialog or persistent banner + notify; primary action **Reload** (`location.reload()` or re-run `loadFromLocalStorage` and reconcile UI state).
- Optional: **Export current (stale) project as JSON** before reload—nice-to-have, not required for MVP.

## Optional: `storage` listener

- In app bootstrap (e.g. [`src/layouts/MainLayout.vue`](src/layouts/MainLayout.vue) or store init after `loadFromLocalStorage`), `window.addEventListener('storage', …)` for key **`outline-projects`**.
- When fired (other tab): **`JSON.parse`** disk projects and **replace in-memory only** projects whose `id` is **not** in `dirtyProjectIds` with disk versions; update **`baselinePersistRevision`** for those ids. This keeps Tab A’s view of Tab B’s project fresh **without** Tab A saving.

## Testing (manual)

- Two tabs, **different projects**: edit both, save alternating order—both projects’ changes remain.
- Two tabs, **same project**: Tab A saves; Tab B (stale) tries save—**blocked** + message; reload B sees A’s data.
- **storage** path (if implemented): Tab B saves project 2; Tab A (not editing project 2, not dirty) sees updated project 2 without save.

## Files to touch

- [`src/stores/outline-store.js`](src/stores/outline-store.js) — revisions, dirty/baseline, merge save, migration, `markProjectDirty` wiring.
- [`src/utils/export/json.js`](src/utils/export/json.js) — import/export `persistRevision`.
- One UI shell — likely [`src/layouts/MainLayout.vue`](src/layouts/MainLayout.vue) or [`src/components/OutlineEditor.vue`](src/components/OutlineEditor.vue) — conflict dialog / optional listener registration (if not kept entirely inside store + `$q` from store, prefer injecting notify via a small composable or passing callback to avoid tight coupling).
