# Patterns and product notes

## Technical patterns

- Vue 3 reactivity + **Pinia**.
- Recursive `OutlineItem` for infinite depth.
- Undo/redo as command snapshots; keyboard routing respects long-note focus.
- Per-project settings; watchers for dialogs and navigation.

## Product behavior worth remembering

### Contexts and cloning

- Clone copies **persisted meta** under `ctx:<source>:` → new id; **`flushPersistence()`** ensures RAM matches disk first. Bytes stay shared.

### Typography and navigation

- Dual-script segmentation (regex); TAB shifts within siblings; Shift+TAB walks outline order; scroll only when needed.

### Dividers and export

- Root dividers reset ordered lists; Markdown `---`; DOCX separator + per-section numbering.

### Long notes: colors and media

- **`collapsedBgColor`** per note; opacity **`longNoteBgOpacity`** project-wide. Dialog: swatches, root color, custom + recents, strength slider, clear. Saved notes can flush background immediately via `setLongNoteBackground`.
- **`loadFromStorage`** migrates legacy per-note opacity into project opacity once.
- Long-note HTML: expand refs for editor, collapse to refs on save; **`LongNoteRenderer`** + **MediaResolver**; missing hash → placeholder.
- Tier-1 editor: image URL, uploads, audio, remove-audio, delete-adjacent audio cleanup.

### Media stack (user-visible)

- Idle GC + delete triggers; JSON export may embed **media** map; OPFS/user-folder/S3/cached layers as above.
- **Settings**: storage warning, failed-save surfacing, media inventory expansion, S3 banners (unsynced / push all), `.scaffoldz` format in export/import.

### Logging

- Prefer **logger** over raw `console` in listed app modules; key lifecycle events include init, context switch, media select/GC, import/export, delete project, persist failures.

### Misc

- GitHub Pages + CI; show/hide all long notes; q-editor tab indent and strip-line-breaks helper.
