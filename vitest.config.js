import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/stores/**',
        'src/utils/**',
      ],
      exclude: [
        'src/stores/example-store.js',
        'src/stores/index.js',
        'src/utils/text/script-runs.js',
      ],
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 80,
        lines: 76,
      },
    },
  },
})
