import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Порт 5174 — гостевое приложение. 5173 занят бэк-офисом, 3000 — API.
const PORT = 5174

/**
 * Режим `native` — сборка для мобильного приложения гостя.
 *
 * Отличается ровно одним: в приложении показывается настройка адреса сервера.
 * В вебе она не нужна и вредна — адрес там известен из сборки и совпадает
 * с тем, откуда открыта страница.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_NATIVE': JSON.stringify(String(mode === 'native')),
  },
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  build: {
    // Своя папка у мобильной сборки: веб и приложение собираются из одного
    // исходника, но разными командами, и общий каталог означал бы, что одна
    // сборка молча затирает другую.
    outDir: mode === 'native' ? 'dist-native' : 'dist',
    // Гостевая карта открывается на слабом 4G: современный таргет даёт меньше полифилов,
    // sourcemap не попадает в критический путь загрузки, но чинит разбор ошибок в проде.
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    // Тесты не зависят от .env на машине: локально он есть (gitignore),
    // в CI — нет, и без этой строки прогон падает на импорте env.ts.
    // Адрес фиктивный: сеть в тестах подменена на уровне fetch.
    env: { VITE_API_URL: 'http://localhost:3000/v1' },
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
    },
  },
}))
