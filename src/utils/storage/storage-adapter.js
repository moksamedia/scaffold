/**
 * Storage adapter interface for Scaffold persistence.
 *
 * Both localStorage and IndexedDB providers must conform to this contract.
 * Methods are async to accommodate IndexedDB's asynchronous API —
 * the localStorage implementation resolves synchronously inside Promises.
 */

/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<object[]>} loadProjects
 * @property {(projects: object[]) => Promise<void>} saveProjects
 * @property {(id: string) => Promise<object|null>} getProject
 * @property {(project: object) => Promise<void>} saveProject
 * @property {(id: string) => Promise<void>} deleteProject
 * @property {() => Promise<{used: number, quota: number}>} getStorageStats
 * @property {(key: string) => Promise<string|null>} getMeta
 * @property {(key: string, value: string) => Promise<void>} setMeta
 */

/**
 * Create a localStorage-backed storage adapter.
 * This wraps the existing localStorage persistence with the adapter interface.
 */
export function createLocalStorageAdapter() {
  return {
    async loadProjects() {
      const raw = localStorage.getItem('outline-projects')
      if (!raw) return []
      return JSON.parse(raw)
    },

    async saveProjects(projects) {
      localStorage.setItem('outline-projects', JSON.stringify(projects))
    },

    async getProject(id) {
      const projects = await this.loadProjects()
      return projects.find((p) => p.id === id) || null
    },

    async saveProject(project) {
      const projects = await this.loadProjects()
      const idx = projects.findIndex((p) => p.id === project.id)
      if (idx >= 0) {
        projects[idx] = project
      } else {
        projects.push(project)
      }
      await this.saveProjects(projects)
    },

    async deleteProject(id) {
      const projects = await this.loadProjects()
      const filtered = projects.filter((p) => p.id !== id)
      await this.saveProjects(filtered)
    },

    async getStorageStats() {
      let used = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        const value = localStorage.getItem(key)
        if (value) used += key.length + value.length
      }
      return { used: used * 2, quota: 5 * 1024 * 1024 }
    },

    async getMeta(key) {
      return localStorage.getItem(`scaffold-meta-${key}`)
    },

    async setMeta(key, value) {
      localStorage.setItem(`scaffold-meta-${key}`, value)
    },
  }
}
