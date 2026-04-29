# Application overview

**Scaffold** is a Quasar Vue 3 app for hierarchical outlines with rich notes, multiple projects, undo/redo, and offline-first persistence.

## Core features

- **Contexts**: Isolated profiles (projects, versions, program settings, media backend wiring); header switcher.
- **Projects**: Multiple per context; per-project settings (fonts, indent, list type, guides, dual-script typography).
- **Outline**: Infinite nesting; ordered/unordered lists; root **divider** rows (section breaks, ordered numbering resets).
- **Notes**: Inline short notes; expandable long notes (rich text, media refs).
- **Editing**: Click-to-edit; keyboard nav (TAB = next sibling, Shift+TAB = next in outline); conditional scroll-to-view.
- **Persistence**: Storage adapter abstraction—IndexedDB in app, localStorage in tests.
- **Import/export**: Markdown, DOCX, JSON; `.scaffoldz` zip bundles; structured JSON backups with optional embedded versions.
