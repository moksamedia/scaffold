# Scaffold

A powerful hierarchical outline and note-taking application built with Vue 3 and Quasar Framework.

## Features

### Core Functionality

- **Multiple Contexts (User-Like Profiles)**: Switch between fully isolated workspaces. Each context has its own projects, version history, program-wide settings, and media-backend configuration — like signing in as a different user, but everything stays local. Use the avatar dropdown in the header to switch, create, rename, or delete contexts. New contexts can either start fresh with default settings or be cloned from the active context (a one-shot fork that copies projects, version history, and configuration; future edits stay isolated). The architecture is future-auth-ready: every context carries optional `authProvider` and `externalSubject` fields so signed-in/OAuth users can plug in later without re-architecting the data model.
- **Multiple Projects**: Create and manage multiple independent outline projects within a context
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
- **Diagnostics & Logging**: Structured `debug`/`info`/`error` logs across startup, context switching, media, and import/export, with a redaction-aware in-memory ring buffer the user can copy or download from the Settings dialog when reporting issues
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

- **Context-Scoped Persistence**: Every persisted value (projects blob, current-project pointer, font scale, program-wide settings, version snapshots, S3 config, user-folder marker) lives under a `ctx:<contextId>:` namespace in the meta store. A thin context-scoped adapter wraps the underlying storage adapter and transparently namespaces every read/write so the rest of the app can stay context-agnostic. The shared media bytes are intentionally NOT scoped (content-addressable hashes are identical across contexts) — but the live-set GC and shared-bucket S3 purge prompts walk the **union** of every context's references, so a hash that any context references is always preserved, while truly unreferenced blobs still get reclaimed.
- **One-Time Migration**: On first launch after upgrading, any pre-context legacy keys (`outline-projects`, `current-project`, `font-scale`, `program-settings`, `media-s3-config`, `media-userfolder-handle`, and `scaffold-version-*`) are migrated into the canonical "Default" context's namespace. The migration is gated by the presence of the `scaffold-contexts` registry, so it runs at most once.
- **IndexedDB Persistence**: Project data, version meta entries, and uploaded media all live in a single `scaffoldDb` IndexedDB database (schema v2: `projects`, `meta`, `media` object stores). The localStorage adapter remains available as a test backend.
- **Content-Addressable Media Store**: A pluggable `MediaStorageAdapter` keys uploads by SHA-256 hex of their bytes; identical media collapses to a single record across uploads, projects, devices, and JSON imports. Long-note HTML, version snapshots, and JSON exports reference media by hash via the `scaffold-media://<hash>` URL scheme — bytes are resolved to blob URLs only at render/edit time.
- **Pluggable Storage Backends**: At app start, capability-based selection picks the best available media backend in priority order:
  1. **S3-compatible bucket** (Phase 4, opt-in) layered on top of OPFS or IndexedDB as a local read-through cache. Works with AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi, etc. Configure CORS on the bucket to allow GET/HEAD/PUT/DELETE from this origin. Credentials may be kept session-only or persisted with AES-GCM (PBKDF2-derived key).
     - **Multi-device S3 sharing**: turn on the **Shared bucket** checkbox in the S3 settings to keep this device's automated GC from removing media that another device may still reference. Listing/usage stats then walk only the local cache, and `delete()` is suppressed for the shared bucket. When you delete a project locally, you'll be prompted with the count of media files this project uniquely references — opt in if you want to also evict them from S3, otherwise they stay for other devices.
     - **Push existing local media to S3**: when you connect S3 on a device that already has media stored locally, those bytes are NOT auto-uploaded. The existing local store becomes the cache layer (so reads keep working), but other devices on the same bucket won't see those files. The Settings dialog shows two warning banners when this happens: a per-project banner in the Project tab listing how many of the current project's media files aren't on S3 yet, and a program-wide banner under the connected-bucket row showing the device-wide count. Both banners include a **Push to S3** button that uploads the missing bytes (idempotent — safe to re-run, skips anything already on S3).
- **Per-project Media Files inventory**: the Settings dialog Project tab includes a collapsible "Media files" list showing every image and audio file referenced by the current project, along with its MIME type, size, and where it currently lives. On S3-backed setups each row carries a coloured badge: green "Local cache + S3" (replicated), amber "Local cache only" (needs Push to S3), or blue "On S3 only" (would re-download on next view). On local-only backends the badge is just "Stored locally" or red "Missing". The inventory is read from the cache without triggering any S3 GETs, so opening the panel is cheap even with a large remote bucket.
  2. **User-picked folder** (Phase 3, opt-in, Chromium-only) via the File System Access API; the directory handle is persisted in IndexedDB and re-prompted for permission on the next user gesture.
  3. **Origin Private File System** (Phase 2) layered with IndexedDB as a fallback for legacy content.
  4. **IndexedDB** (Phase 1) as the universal default.
- **Save Dialog**: JSON exports use `window.showSaveFilePicker` when available so users get a true file save dialog; falls back to the classic anchor-click download otherwise.
- **`.scaffoldz` Bundle Format**: Optional zip bundle export carries `outline.json` (the same envelope as JSON exports, minus the inline media map) plus raw media bytes under `media/<sha256-hex>` with sidecar `.meta.json` files. Imports auto-detect bundles by extension (`.scaffoldz`, `.zip`) or by sniffing the PK\\003\\004 magic bytes, so users can drop either format into the import dialog without picking a mode.
- **Automatic Migration**: On every load, any pre-existing inline `data:image/...` or `data:audio/...` URIs in long-note HTML (across both live projects and persisted version snapshots) are ingested into the media store and replaced with references. The migration is idempotent because IDs are content hashes.
- **Mark-and-Sweep GC**: Unreferenced media is reclaimed in the background. The live set is the **union of every registered context's** persisted projects + version meta entries — never just the active context — so switching contexts and triggering GC will never delete media that another context still uses. A 24h grace window protects newly uploaded blobs that haven't yet been saved into a long note. GC also runs on project/long-note delete events.
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
│   ├── ContextSwitcher.vue  # Header dropdown for switching/creating/managing contexts
│   └── MainLayout.vue       # Application layout
├── stores/              # Pinia stores
│   └── outline-store.js     # Main application state
├── utils/               # Utility modules
│   ├── context/             # User-like profiles ("contexts")
│   │   ├── session.js       # Registry CRUD + active-context resolution
│   │   └── migration.js     # One-time legacy → ctx:default: migration
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
│   │   ├── gc.js            # mark-and-sweep over projects + versions across every context
│   │   ├── migration.js     # idempotent data: → reference migration
│   │   ├── opfs-adapter.js  # Phase 2: Origin Private File System adapter
│   │   ├── userfolder-adapter.js  # Phase 3: showDirectoryPicker-backed adapter
│   │   ├── layered-adapter.js     # multi-tier adapter (writes primary, reads fall through)
│   │   ├── cached-adapter.js      # read-through cache wrapper for remote backends
│   │   ├── sigv4.js               # AWS Signature V4 signer (WebCrypto)
│   │   ├── s3-adapter.js          # Phase 4: S3-compatible adapter (HEAD/GET/PUT/DELETE/LIST)
│   │   ├── s3-config.js           # S3 credential persistence (session or AES-GCM/PBKDF2)
│   │   └── index.js               # singleton accessors + capability-based selection
│   ├── storage/             # Storage abstraction
│   │   ├── storage-adapter.js  # IndexedDB v2 + localStorage backends, including media methods
│   │   ├── context-scoped.js   # Wrapper that namespaces meta keys under ctx:<id>:
│   │   ├── index.js         # Singleton accessor for the storage adapter (scoped + base)
│   │   └── migration.js     # localStorage→IndexedDB migration state machine
│   └── logging/             # Application logger
│       └── logger.js        # Structured debug/info/error logger with redaction + in-memory ring buffer
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
- Open **Settings → Program Settings → Diagnostics** and click **Copy diagnostics** or **Download diagnostics** to attach the most recent 200 structured log entries to your report. Sensitive fields (S3 secrets, passphrases, auth headers) are redacted before they leave the buffer.

### Reporting an Issue (Diagnostics Workflow)

1. Reproduce the bug while the app is open.
2. Open **Settings → Program Settings → Diagnostics** at the bottom of the tab.
3. Click **Copy diagnostics** to put the JSON payload on your clipboard, or **Download diagnostics** to save a `scaffold-diagnostics-*.json` file.
4. Paste/attach the payload to your issue report along with the steps to reproduce.

For deeper investigations, support staff can ask you to enable verbose logs by running this in the browser console and reloading:

```js
localStorage.setItem('scaffold-log-level', 'debug')
```

To return to the default verbosity:

```js
localStorage.removeItem('scaffold-log-level')
```

The structured log schema is `{ level, event, ts, ...payload }`, with stable dot-style event ids (e.g. `app.init.success`, `context.switch.failed`, `media.backend.select.failed`, `import.failed`).
