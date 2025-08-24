All Vue code here should use the Composition API with <script setup> paradigm.

It's important to keep the README.md updated with features and information necessary to install and run application. It's also important to keep this file (CLAUDE.md) updated with basic code structure and context necessasry to save time between sessions.

All changes should be committed before and after making large changes to code or adding features.

# Application Overview

This is a Quasar Vue 3 application for creating and managing hierarchical outline lists with note-taking capabilities.

## Core Features
- Multiple projects with individual settings
- Infinite nesting of outline items
- Toggle between ordered/unordered lists at any level
- Short notes (inline) and long notes (collapsible blocks with rich text)
- Undo/redo functionality with 50-item history
- Per-project settings: font size, indent size, default list type, indent guides
- Keyboard navigation: TAB (next sibling), Shift+TAB (next item in outline)
- Auto-scroll to visible items during navigation
- Click-to-edit text interface
- LocalStorage persistence
- Export functionality: Markdown and DOCX formats with proper formatting
- Bulk collapse/expand controls for items and notes

## File Structure

### `/src/stores/outline-store.js`
- Pinia store with all application state management
- Project CRUD operations
- List item operations (create, update, delete, move, indent/outdent)
- Notes management (short/long notes)
- Undo/redo system with state snapshots
- Per-project settings storage and restoration
- Navigation functions for keyboard shortcuts
- LocalStorage persistence with migration logic
- Export functionality integration
- Bulk collapse/expand operations for items and notes

### `/src/components/`
- `OutlineItem.vue` - Recursive component for rendering nested list items
- `OutlineEditor.vue` - Main editing interface with project header and controls, export menu, bulk operations
- `ProjectsSidebar.vue` - Left panel for project management and settings
- `MainLayout.vue` - Application layout with sidebar toggle

### `/src/utils/export/`
- `markdown.js` - Markdown export functionality with HTML to markdown conversion
- `docx.js` - DOCX export with dynamic nesting levels, Word styles, and paragraph structure preservation

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
- TAB navigation: cycles through siblings, Shift+TAB navigates to next item in outline hierarchy
- Conditional scroll-to-view that only scrolls if item is not already visible
- Rich text editor for long notes with lists, indentation, quotes, code blocks, links, images
- Export system: Markdown and DOCX formats with proper formatting
- DOCX export features:
  - Dynamic nesting level detection and numbering system generation
  - Word style application: List Paragraph, Comment, Block Quotation
  - Paragraph structure preservation for long notes with blockquote handling
  - Line break preservation within formatted text
  - Configurable indentation parameters
- Bulk operations: collapse/expand all items and all long notes separately
- Modular export architecture with separate utility files
- Context-aware keyboard shortcuts: undo/redo directed to long note editor when active
