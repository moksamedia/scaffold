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
- LocalStorage persistence
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
- LocalStorage persistence with migration logic
- Export functionality integration
- Bulk collapse/expand operations for items and notes
- Versioning system: saveVersion(), restoreVersion(), getLatestVersion() with duplicate detection
- Settings synchronization between UI components
- Dual-script typography settings (Tibetan/non-Tibetan family, size, color) with program-wide defaults for new projects

### `/src/components/`
- `OutlineItem.vue` - Recursive component for rendering nested list items with q-editor enhancements
- `OutlineEditor.vue` - Main editing interface with project header and controls, export menu, bulk operations, version saving
- `OutlineEditor.vue` - Main editing interface with section-aware root numbering and root divider insertion
- `ProjectsSidebar.vue` - Left panel for project management and real-time settings controls
- `MainLayout.vue` - Application layout with sidebar toggle and settings dialog integration
- `SettingsDialog.vue` - Tabbed dialog for program-wide and project-specific settings, version history management

### `/src/utils/export/`
- `markdown.js` - Markdown export functionality with HTML to markdown conversion and blockquote handling
- `docx.js` - DOCX export with dynamic nesting levels, Word styles, and paragraph structure preservation
- `json.js` - JSON export/import with schema validation, conflict resolution, and format versioning
- `json.js` - JSON export/import with root-entry `kind` persistence (`item`/`divider`)

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
- Bulk operations: collapse/expand all items and all long notes separately
- Modular export architecture with separate utility files
- Context-aware keyboard shortcuts: undo/redo directed to long note editor when active
- GitHub Pages deployment with automatic CI/CD via GitHub Actions
- Comprehensive versioning system:
  - Per-project version history stored in localStorage
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
- Show/hide all long notes toggle for quick overview
