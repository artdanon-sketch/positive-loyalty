import react from '@vitejs/plugin-react'
// defineConfig из 'vitest/config', а не из 'vite': конфиг один на сборку и тесты.
// Отдельный vitest.config.ts не годится — Vitest берёт только его и не мерджит
// vite.config.ts, из-за чего плагины и алиасы молча не доезжают до тестов.
import { defineConfig } from 'vitest/config'

/**
 * Режимы сборки: `owner` и `cashier` — два мобильных приложения из одного
 * исходника, `production` — обычный веб бэк-офиса.
 *
 * Различие вынесено в РЕЖИМ, а не в файлы окружения: `.env.*` в этом
 * репозитории под игнором (там живут секреты), и флаги сборки, спрятанные
 * в неотслеживаемом файле, воспроизводятся только на машине автора.
 *
 * Третьей кодовой базы при этом не появляется — ТЗ (docs/03, раздел 10)
 * прямо против неё. Появляется вторая упаковка того же приложения.
 */
const NATIVE_MODES = new Set(['owner', 'cashier'])

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: {
    outDir: NATIVE_MODES.has(mode) ? `dist-${mode}` : 'dist',
    sourcemap: true,
  },
  define: {
    'import.meta.env.VITE_NATIVE': JSON.stringify(String(NATIVE_MODES.has(mode))),
    'import.meta.env.VITE_APP_ROLE': JSON.stringify(mode === 'cashier' ? 'cashier' : 'owner'),
  },
  test: {
    environment: 'jsdom',
    // Тесты не должны зависеть от .env на машине: локально он есть (gitignore),
    // в CI — нет, и без этой строки прогон падает на импорте env.ts.
    // Адрес фиктивный: сеть в тестах подменена на уровне fetch.
    env: { VITE_API_URL: 'http://localhost:3000/v1' },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
}))
