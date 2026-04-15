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
      include: [
        'src/stores/**',
        'src/utils/**',
      ],
    },
  },
})
