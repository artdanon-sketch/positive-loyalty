import { existsSync } from 'node:fs'

import { defineConfig } from 'prisma/config'

/**
 * Конфигурация Prisma CLI.
 *
 * Prisma 7 больше не принимает `url` в блоке datasource схемы и не читает `.env`
 * автоматически — и то, и другое теперь живёт здесь.
 */

// Node 22 умеет читать .env сам, отдельный dotenv в зависимостях не нужен.
// `--env-file` на сам бинарь prisma не навесить, поэтому грузим файл здесь.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

/**
 * DATABASE_URL намеренно БЕЗ значения по умолчанию: молчаливый фолбэк на localhost
 * однажды закончится миграцией, накатанной не на ту базу.
 */
const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // Seed — обычный node-процесс со встроенным стриппингом типов: tsx в зависимости
    // не тянем. Сам prisma/seed.ts появится вместе с демо-данными (CLAUDE.md).
    seed: 'node --env-file-if-exists=.env --experimental-strip-types prisma/seed.ts',
  },

  // Блок datasource нужен только командам, которые ходят в базу: migrate, db, studio.
  // generate, validate и format работают без него — поэтому там, где DATABASE_URL нет
  // (CI, чистый клон), блок просто отсутствует, а не падает на пустой переменной.
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
})
