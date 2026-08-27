import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Порт 5174 — гостевое приложение. 5173 занят бэк-офисом, 3000 — API.
const PORT = 5174

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
  build: {
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
})
