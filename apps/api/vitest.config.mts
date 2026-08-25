import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * NestJS 10 держится на декораторах и `emitDecoratorMetadata`.
 * esbuild, которым vite трансформирует TypeScript по умолчанию, метаданные не эмитит —
 * без них DI не может разрешить зависимости конструктора и тесты падают на пустом месте.
 * Поэтому трансформ отдан swc: только он умеет `decoratorMetadata`.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // main.ts — только bootstrap процесса, спеки его не поднимают.
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
    },
  },
})
