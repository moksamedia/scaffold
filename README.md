# Scaffold

A powerful hierarchical outline and note-taking application built with Vue 3 and Quasar Framework.

## Features

### Core Functionality

- **Multiple Projects**: Create and manage multiple independent outline projects
- **Infinite Nesting**: Create hierarchical outlines with unlimited depth
- **Flexible List Types**: Toggle between ordered (1, 2, 3) and unordered (•) lists at any level
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
- `npm run lint` - Run ESLint code checking
- `npm run format` - Format code with Prettier

## Usage Guide

### Getting Started

1. **Create Your First Project**
   - Click the "+" button in the sidebar
   - Enter a project name and press Create

2. **Add Outline Items**
   - Click "Add Root Item" or press the "+" button
   - Type your content and press Enter to create the next item
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
- `Enter` - Stop editing and create new sibling
- `Esc` - Stop editing without changes

#### Long Note Editor

- `Ctrl/Cmd + Z` - Undo (within editor)
- `Ctrl/Cmd + Y` - Redo (within editor)
- `Tab` - Increase indentation
- `Shift + Tab` - Decrease indentation
- Strip Line Breaks button - Remove all line breaks from selected text
- Rich text formatting toolbar available

### Export Options

#### Markdown Export

- Preserves hierarchical structure with proper indentation
- Converts rich text to Markdown syntax
- Includes inline short notes and blockquoted long notes
- Proper line break handling within blockquotes

#### Word Document Export

- Dynamic numbering system adapts to your outline depth
- Applies Word styles: List Paragraph, Comment, Block Quotation
- Preserves paragraph structure and line breaks
- Configurable indentation for professional documents

#### JSON Export/Import

- **Complete Backup**: Exports all project data, settings, and metadata
- **Selective Export**: Export single project or all projects
- **Import Validation**: Schema validation with detailed error reporting
- **Conflict Resolution**: Automatically handles duplicate project names
- **Format Versioning**: Future-proof with version compatibility checking

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

- **Local Storage**: All data persists automatically in browser
- **Version History**: Per-project version tracking with duplicate detection
- **Migration System**: Seamless updates preserve existing data
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
│   └── export/              # Export functionality
│       ├── markdown.js      # Markdown export
│       ├── docx.js         # Word document export
│       └── json.js         # JSON export/import
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
