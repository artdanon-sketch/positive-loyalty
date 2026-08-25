import { defineConfig } from 'vitest/config'

// Воркер — обычный Node-процесс без декораторов, поэтому swc-трансформ здесь не нужен:
// хватает стандартного пайплайна vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts'],
    },
  },
})
