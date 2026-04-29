import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  define: {
    'process.env.VITE_APP_VERSION': JSON.stringify('0.0.0-test'),
    'process.env.VITE_GIT_COMMIT': JSON.stringify(''),
    'process.env.VITE_BUILD_TIME': JSON.stringify(''),
  },
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
