/** Build-time values from quasar.config.js → build.env (dev + production). */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? ''
export const GIT_COMMIT = import.meta.env.VITE_GIT_COMMIT ?? ''
