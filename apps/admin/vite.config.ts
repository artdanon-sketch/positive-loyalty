import react from '@vitejs/plugin-react'
// defineConfig из 'vitest/config', а не из 'vite': конфиг один на сборку и тесты.
// Отдельный vitest.config.ts не годится — Vitest берёт только его и не мерджит
// vite.config.ts, из-за чего плагины и алиасы молча не доезжают до тестов.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})
