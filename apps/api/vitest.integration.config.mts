import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * Конфиг ИНТЕГРАЦИОННЫХ тестов: ledger против настоящего PostgreSQL.
 *
 * Почему отдельный файл, а не ещё один include в vitest.config.mts.
 * `pnpm test` гоняется в CI, а базы в CI нет (.github/workflows/ci.yml, шаг Test —
 * это `pnpm test` без сервиса postgres). Тесты, которым нужна база, обязаны быть
 * недостижимы для этой команды — иначе CI покраснеет на пустом месте, и первым же
 * решением станет «давайте их скипнем», после чего проверки денег умрут молча.
 *
 * Граница проведена дважды, чтобы её нельзя было стереть случайно:
 *   • имя файла — `*.integration-spec.ts`. Основной конфиг собирает только
 *     `*.spec.ts` внутри src и `*.e2e-spec.ts` внутри test, и под оба шаблона
 *     это имя не подходит;
 *   • запуск — отдельным скриптом `test:integration`, который передаёт этот конфиг.
 *
 * Когда в CI появится сервис postgres, включать эти тесты нужно отдельным шагом
 * с `DATABASE_URL_TEST`, а не расширением include основного конфига.
 */
export default defineConfig({
  plugins: [
    // Тот же трансформ, что и в vitest.config.mts: NestJS 10 держится на
    // `emitDecoratorMetadata`, а esbuild метаданные не эмитит — без swc DI
    // не соберёт LedgerService. Блок продублирован сознательно: конфиги
    // независимы, и общий «базовый» объект здесь сэкономил бы пятнадцать строк
    // ценой того, что расширение одного молча меняет поведение другого.
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
    include: ['test/integration/**/*.integration-spec.ts'],

    // Подменяет DATABASE_URL на DATABASE_URL_TEST и падает с инструкцией,
    // если тестовая база не настроена.
    setupFiles: ['test/integration/setup-integration-env.ts'],

    // Файлы идут последовательно. Причина не в изоляции данных — она достигается
    // отдельным набором фикстур на каждый тест, — а в чистоте диагностики: под
    // Serializable параллельные файлы добавляют посторонние конфликты сериализации,
    // и падение теста на гонку перестаёт означать «в ledger есть баг».
    fileParallelism: false,

    // Тесты на гонку делают несколько итераций с реальными транзакциями и ретраями.
    // Значения по умолчанию (5 с) для этого мало, а первое подключение к базе
    // в beforeAll бывает медленным на холодном Postgres.
    testTimeout: 60_000,
    hookTimeout: 60_000,

    // ЯВНО ноль. Ретрай теста на гонку — способ покрасить в зелёный сломанную
    // блокировку: достаточно прогнать три раза и один раз повезёт. Мигающий тест
    // здесь обязан быть красным.
    retry: 0,

    clearMocks: true,
    restoreMocks: true,
  },
})
