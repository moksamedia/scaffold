/**
 * From quasar.config.js → build.env. Quasar injects these via Vite `define` as
 * `process.env.*` (not import.meta.env).
 */
export const APP_VERSION = process.env.VITE_APP_VERSION ?? ''
export const GIT_COMMIT = process.env.VITE_GIT_COMMIT ?? ''
/** ISO 8601 timestamp from when the bundle was configured (dev server start or `quasar build`). */
export const BUILD_TIME = process.env.VITE_BUILD_TIME ?? ''
