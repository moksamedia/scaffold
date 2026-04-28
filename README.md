# Scaffold

A powerful hierarchical outline and note-taking application built with Vue 3 and Quasar Framework.

## Features

### Core Functionality

- **Multiple Projects**: Create and manage multiple independent outline projects
- **Infinite Nesting**: Create hierarchical outlines with unlimited depth
- **Flexible List Types**: Toggle between ordered (1, 2, 3) and unordered (•) lists at any level
- **Root Divider Sections**: Insert root-only divider rows to split sections and restart ordered numbering
- **Rich Note-Taking**: Add short inline notes and long rich-text notes with full formatting
- **Smart Navigation**: Keyboard shortcuts for efficient outline editing
- **Undo/Redo**: Full history with 50-item undo stack
- **Auto-Save**: Automatic persistence to browser storage

### Advanced Features

- **Version Control**: Comprehensive versioning system with automatic and manual saves
- **Export/Import**: Export to Markdown, Microsoft Word (DOCX), and JSON formats; Import JSON backups
- **Backup & Restore**: Complete project backup with settings preservation and version history
- **Bulk Operations**: Collapse or expand all items and notes with one click
- **Per-Project Settings**: Customizable font size, indentation, display options, and script-specific typography
- **Program-Wide Defaults**: Set default values for all new projects
- **Dual-Script Typography**: Configure Tibetan and non-Tibetan font family, size, and color separately
- **Context-Aware Shortcuts**: Intelligent keyboard handling that adapts to editing context
- **Rich Text Editing**: Full-featured editor with lists, quotes, code blocks, links, and images
- **Long Note Media Tools**: Insert image URLs, upload small images, and insert audio URLs in long notes
- **Content-Addressable Media Store**: Uploaded images and audio are deduped by SHA-256 hash and stored once in IndexedDB; long-note HTML, version snapshots, and JSON exports carry only `scaffold-media://<hash>` references
- **Storage Guardrails**: Warns on high browser storage usage and save failures (for example quota limits)
- **GitHub Pages Deployment**: Deploy directly to GitHub Pages with automated CI/CD

## Installation & Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager

### Quick Start

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd scaffold
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start development server**

   ```bash
   npm run dev
   ```

4. **Open in browser**
   Navigate to `http://localhost:9000` (or the port shown in terminal)

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run build:gh-pages` - Build for GitHub Pages deployment
- `npm run test` - Run unit and integration tests (Vitest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint code checking
- `npm run format` - Format code with Prettier

### Cloud Storage Setup

- For Google Cloud Storage with S3-compatible access (used by the media S3 adapter), see `GCS_S3_COMPAT_SETUP.md`.
- For Cloudflare R2 setup, see `R2_S3_SETUP.md`.
- For AWS S3 setup, see `AWS_S3_SETUP.md`.
- For Backblaze B2 setup, see `B2_S3_SETUP.md`.
- For MinIO (self-hosted) setup, see `MINIO_S3_SETUP.md`.

## Usage Guide

### Getting Started

1. **Create Your First Project**
   - Click the "+" button in the sidebar
   - Enter a project name and press Create

2. **Add Outline Items**
   - Click "Add Root Item" or press the "+" button
   - Type your content; press Enter to finish editing and move to the next sibling when there is one
   - Use Tab to create child items, Shift+Tab to navigate through items

3. **Add Notes**
   - Click the note icon next to any item
   - Choose "Short Note" for inline references (e.g., "p. 23-45")
   - Choose "Long Note" for detailed rich-text content

### Keyboard Shortcuts

#### Global Shortcuts

- `Ctrl/Cmd + Z` - Undo (outline level)
- `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` - Redo (outline level)
- `Ctrl/Cmd + B` - Toggle sidebar

#### Editing Mode

- `Tab` - Navigate to next sibling item (with wraparound)
- `Shift + Tab` - Navigate to next item in entire outline
- `Enter` - Stop editing; if there is a next sibling at the same level, start editing it (default “New Item” text is cleared when you start editing)
- `Esc` - Stop editing without changes

#### Long Note Editor

- `Ctrl/Cmd + Z` - Undo (within editor)
- `Ctrl/Cmd + Y` - Redo (within editor)
- `Tab` - Increase indentation
- `Shift + Tab` - Decrease indentation
- Strip Line Breaks button - Remove all line breaks from selected text
- Media toolbar buttons:
  - Insert image by URL (`http`/`https`)
  - Upload small image files (inline)
  - Upload audio files for inline playback
  - Remove selected audio player embed
- Press `Backspace` or `Delete` next to an embedded audio player to remove it
- Rich text formatting toolbar available

### Export Options

#### Markdown Export

- Preserves hierarchical structure with proper indentation
- Converts rich text to Markdown syntax
- Includes inline short notes and blockquoted long notes
- Proper line break handling within blockquotes
- Emits `---` divider markers between root sections and resets ordered numbering after each divider

#### Word Document Export

- Dynamic numbering system adapts to your outline depth
- Applies Word styles: List Paragraph, Comment, Block Quotation
- Preserves paragraph structure and line breaks
- Configurable indentation for professional documents
- Renders root dividers as separator paragraphs and restarts root ordered numbering by section

#### JSON Export/Import

- **Complete Backup**: Exports all project data, settings, and metadata
- **Selective Export**: Export single project or all projects
- **Optional Version History**: Both single-project and Export All flows offer an "Include version history" checkbox that embeds every saved version snapshot in the exported JSON. Imports restore those snapshots automatically, remapping them to the new project ID when an imported project collides with an existing one.
- **Import Validation**: Schema validation with detailed error reporting
- **Conflict Resolution**: Automatically handles duplicate project names
- **Format Versioning**: Future-proof with version compatibility checking
- **Divider Persistence**: Preserves root entry `kind` (`item` or `divider`) and defaults missing values to `item`

### Customization

#### Settings Dialog

- **Program Settings Tab**: Configure defaults for new projects
  - Auto-versioning options (on start, on close, at intervals)
  - Default font and indent sizes
  - Default list type preference
  - Default Tibetan and non-Tibetan typography (family, size, color)

#### Project Settings (Per-Project)

- **Font Size**: 12-40px range with real-time preview
- **Indent Size**: 5-50px for visual hierarchy
- **Default List Type**: Choose between numbered or bulleted
- **Indent Guides**: Visual lines to show nesting levels
- **Script Typography**: Separate Tibetan and non-Tibetan family/size/color settings for display
- **Version History**: View, restore, export, and manage project versions

#### Display Options

- Collapsible outline items for focused viewing
- Collapsible long notes to reduce visual clutter
- Show/Hide all long notes toggle
- Bulk expand/collapse operations

## Technical Architecture

### Built With

- **Vue 3** - Progressive JavaScript framework with Composition API
- **Quasar Framework** - Vue-based UI framework
- **Pinia** - State management
- **Vite** - Build tool and dev server

### Key Patterns

- **Reactive State Management**: Centralized store with reactive updates
- **Recursive Components**: Infinite nesting through self-referencing components
- **Command Pattern**: Undo/redo system with state snapshots
- **Modular Architecture**: Separated concerns with utility modules

### Browser Support

- Modern browsers with ES2022 support
- Chrome 115+, Firefox 115+, Safari 14+

### Storage

- **IndexedDB Persistence**: Project data, version meta entries, and uploaded media all live in a single `scaffoldDb` IndexedDB database (schema v2: `projects`, `meta`, `media` object stores). The localStorage adapter remains available as a test backend.
- **Content-Addressable Media Store**: A pluggable `MediaStorageAdapter` keys uploads by SHA-256 hex of their bytes; identical media collapses to a single record across uploads, projects, devices, and JSON imports. Long-note HTML, version snapshots, and JSON exports reference media by hash via the `scaffold-media://<hash>` URL scheme — bytes are resolved to blob URLs only at render/edit time.
- **Pluggable Storage Backends**: At app start, capability-based selection picks the best available media backend in priority order:
  1. **S3-compatible bucket** (Phase 4, opt-in) layered on top of OPFS or IndexedDB as a local read-through cache. Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi, etc. Configure CORS on the bucket to allow GET/HEAD/PUT/DELETE from this origin. Credentials may be kept session-only or persisted with AES-GCM (PBKDF2-derived key).
     - **Multi-device S3 sharing**: turn on the **Shared bucket** checkbox in the S3 settings to keep this device's automated GC from removing media that another device may still reference. Listing/usage stats then walk only the local cache, and `delete()` is suppressed for the shared bucket. When you delete a project locally, you'll be prompted with the count of media files this project uniquely references — opt in if you want to also evict them from S3, otherwise they stay for other devices.
     - **Push existing local media to S3**: when you connect S3 on a device that already has media stored locally, those bytes are NOT auto-uploaded. The existing local store becomes the cache layer (so reads keep working), but other devices on the same bucket won't see those files. The Settings dialog shows two warning banners when this happens: a per-project banner in the Project tab listing how many of the current project's media files aren't on S3 yet, and a program-wide banner under the connected-bucket row showing the device-wide count. Both banners include a **Push to S3** button that uploads the missing bytes (idempotent — safe to re-run, skips anything already on S3).
  2. **User-picked folder** (Phase 3, opt-in, Chromium-only) via the File System Access API; the directory handle is persisted in IndexedDB and re-prompted for permission on the next user gesture.
  3. **Origin Private File System** (Phase 2) layered with IndexedDB as a fallback for legacy content.
  4. **IndexedDB** (Phase 1) as the universal default.
- **Save Dialog**: JSON exports use `window.showSaveFilePicker` when available so users get a true file save dialog; falls back to the classic anchor-click download otherwise.
- **`.scaffoldz` Bundle Format**: Optional zip bundle export carries `outline.json` (the same envelope as JSON exports, minus the inline media map) plus raw media bytes under `media/<sha256-hex>` with sidecar `.meta.json` files. Imports auto-detect bundles by extension (`.scaffoldz`, `.zip`) or by sniffing the PK\\003\\004 magic bytes, so users can drop either format into the import dialog without picking a mode.
- **Automatic Migration**: On every load, any pre-existing inline `data:image/...` or `data:audio/...` URIs in long-note HTML (across both live projects and persisted version snapshots) are ingested into the media store and replaced with references. The migration is idempotent because IDs are content hashes.
- **Mark-and-Sweep GC**: Unreferenced media is reclaimed in the background. The live set is computed from persisted projects + version meta entries, and a 24h grace window protects newly uploaded blobs that haven't yet been saved into a long note. GC also runs on project/long-note delete events.
- **Version History**: Per-project version tracking with duplicate detection. After the migration, version snapshots are reference-only and stay tiny regardless of how much media a project contains.
- **No Server Required**: Fully client-side application

### Deployment

- **GitHub Pages**: Automated deployment via GitHub Actions
- **Custom Domain**: Configurable public path for deployment
- **CI/CD Pipeline**: Automatic builds on push to main branch

## Development

### Project Structure

```
src/
├── components/          # Vue components
│   ├── OutlineEditor.vue    # Main editing interface
│   ├── OutlineItem.vue      # Recursive outline item
│   ├── ProjectsSidebar.vue  # Project management sidebar
│   ├── SettingsDialog.vue   # Settings and version management
│   └── MainLayout.vue       # Application layout
├── stores/              # Pinia stores
│   └── outline-store.js     # Main application state
├── utils/               # Utility modules
│   ├── export/              # Export functionality
│   │   ├── markdown.js      # Markdown export
│   │   ├── docx.js          # Word document export
│   │   ├── json.js          # JSON export/import (carries optional `media` payload)
│   │   ├── zip.js           # STORED-only ZIP reader/writer (CRC32 + PKZIP layout)
│   │   └── scaffoldz.js     # `.scaffoldz` bundle export/import (zip with separate media files)
│   ├── media/               # Content-addressable media store
│   │   ├── adapter.js       # MediaStorageAdapter interface (IndexedDB-backed)
│   │   ├── hash.js          # SHA-256 helpers
│   │   ├── references.js    # `scaffold-media://<hash>` HTML scan/rewrite
│   │   ├── ingest.js        # data URI / Blob → stored hash
│   │   ├── resolver.js      # hash → cached blob URL
│   │   ├── gc.js            # mark-and-sweep over projects + versions
│   │   ├── migration.js     # idempotent data: → reference migration
│   │   ├── opfs-adapter.js  # Phase 2: Origin Private File System adapter
│   │   ├── userfolder-adapter.js  # Phase 3: showDirectoryPicker-backed adapter
│   │   ├── layered-adapter.js     # multi-tier adapter (writes primary, reads fall through)
│   │   ├── cached-adapter.js      # read-through cache wrapper for remote backends
│   │   ├── sigv4.js               # AWS Signature V4 signer (WebCrypto)
│   │   ├── s3-adapter.js          # Phase 4: S3-compatible adapter (HEAD/GET/PUT/DELETE/LIST)
│   │   ├── s3-config.js           # S3 credential persistence (session or AES-GCM/PBKDF2)
│   │   └── index.js               # singleton accessors + capability-based selection
│   └── storage/             # Storage abstraction
│       ├── storage-adapter.js  # IndexedDB v2 + localStorage backends, including media methods
│       ├── index.js         # Singleton accessor for the storage adapter
│       └── migration.js     # localStorage→IndexedDB migration state machine
├── layouts/             # Application layouts
└── pages/               # Route pages
```

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit with descriptive messages
5. Push to your fork and submit a pull request

### Code Standards

- Vue 3 Composition API with `<script setup>`
- ESLint configuration for code quality
- Consistent naming conventions
- Comprehensive error handling

## License

This project is available under the MIT License. See LICENSE file for details.

## Support

For bug reports, feature requests, or questions:

- Create an issue in the repository
- Include detailed reproduction steps for bugs
- Specify your browser and version for compatibility issues
