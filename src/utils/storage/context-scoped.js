/**
 * Wraps a base storage adapter so every per-context read/write lives
 * under a `ctx:<contextId>:` key namespace.
 *
 * Projects are stored as a single JSON blob in the meta store under
 * the namespaced key `ctx:<contextId>:projects` rather than the
 * dedicated projects object store / `outline-projects` key. This
 * keeps both the localStorage and IndexedDB adapters consistent
 * without requiring schema changes — the dedicated projects backing
 * is only touched during one-time legacy migration.
 *
 * Media methods and `getStorageStats` pass through unchanged because
 * the physical media store is shared across contexts: bytes are
 * content-addressable, and the same hash is the same bytes regardless
 * of which context references it. Live-set computation is still
 * per-context, so unreferenced media gets garbage collected normally.
 *
 * @param {import('./storage-adapter.js').StorageAdapter} base
 * @param {string} contextId
 */
export function createContextScopedAdapter(base, contextId) {
  if (!base) {
    throw new Error('createContextScopedAdapter: base adapter is required')
  }
  if (!contextId || typeof contextId !== 'string') {
    throw new Error('createContextScopedAdapter: contextId must be a non-empty string')
  }

  const prefix = `ctx:${contextId}:`
  const PROJECTS_META_KEY = 'projects'

  const scoped = {
    async loadProjects() {
      const raw = await base.getMeta(`${prefix}${PROJECTS_META_KEY}`)
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    },

    async saveProjects(projects) {
      await base.setMeta(
        `${prefix}${PROJECTS_META_KEY}`,
        JSON.stringify(projects || []),
      )
    },

    async getProject(id) {
      const projects = await scoped.loadProjects()
      return projects.find((p) => p.id === id) || null
    },

    async saveProject(project) {
      const projects = await scoped.loadProjects()
      const idx = projects.findIndex((p) => p.id === project.id)
      if (idx >= 0) {
        projects[idx] = project
      } else {
        projects.push(project)
      }
      await scoped.saveProjects(projects)
    },

    async deleteProject(id) {
      const projects = await scoped.loadProjects()
      await scoped.saveProjects(projects.filter((p) => p.id !== id))
    },

    async getStorageStats() {
      return base.getStorageStats()
    },

    async getMeta(key) {
      return base.getMeta(`${prefix}${key}`)
    },

    async setMeta(key, value) {
      return base.setMeta(`${prefix}${key}`, value)
    },

    async deleteMeta(key) {
      return base.deleteMeta(`${prefix}${key}`)
    },

    async getMetaEntries(p) {
      const entries = await base.getMetaEntries(`${prefix}${p}`)
      return entries.map((entry) => ({
        key: entry.key.slice(prefix.length),
        value: entry.value,
      }))
    },

    async putMedia(...args) {
      return base.putMedia(...args)
    },

    async getMedia(...args) {
      return base.getMedia(...args)
    },

    async hasMedia(...args) {
      return base.hasMedia(...args)
    },

    async deleteMedia(...args) {
      return base.deleteMedia(...args)
    },

    async listMediaHashes(...args) {
      return base.listMediaHashes(...args)
    },

    async getMediaStats(...args) {
      return base.getMediaStats(...args)
    },
  }

  return scoped
}

/**
 * Build the meta key prefix used for a specific context. Exported for
 * use by migration utilities that need to reach into the base adapter
 * directly.
 *
 * @param {string} contextId
 * @returns {string}
 */
export function getContextMetaPrefix(contextId) {
  if (!contextId) throw new Error('getContextMetaPrefix: contextId is required')
  return `ctx:${contextId}:`
}
