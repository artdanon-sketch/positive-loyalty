import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // theme.ts работает с documentElement, localStorage и matchMedia — нужен DOM.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Подмены глобалов и шпионы снимаются между тестами, чтобы состояние не текло.
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reportsDirectory: 'coverage',
    },
  },
})
