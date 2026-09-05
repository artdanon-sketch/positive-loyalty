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
 * МИГРАЦИИ ХОДЯТ ПОД ВЛАДЕЛЬЦЕМ, ПРИЛОЖЕНИЕ — ПОД ОГРАНИЧЕННОЙ РОЛЬЮ.
 *
 * Это две разные учётные записи, и путать их нельзя. Создавать таблицы,
 * функции и политики умеет только владелец. А приложение обязано ходить в базу
 * НЕ владельцем: владелец таблицы игнорирует и REVOKE, и политики RLS — то есть
 * под ним изоляция заведений просто не действует, хотя выглядит настроенной.
 *
 * Рантайм читает `DATABASE_URL` (apps/api/src/core/prisma.service.ts), поэтому
 * там лежит ограниченная роль. Владелец нужен только здесь, и живёт он
 * в отдельной переменной.
 *
 * Фолбэк на DATABASE_URL сохраняет прежнее поведение там, где роль одна:
 * локальная разработка и CI ничего не меняют.
 *
 * Значения по умолчанию нет намеренно: молчаливый фолбэк на localhost однажды
 * закончится миграцией, накатанной не на ту базу.
 */
const databaseUrl = process.env.DATABASE_URL_OWNER?.trim() || process.env.DATABASE_URL

/**
 * Схема, в которую едут миграции.
 *
 * ВЫВОДИТСЯ ИЗ ТОЙ ЖЕ ПЕРЕМЕННОЙ, ЧТО И РАНТАЙМ, а не задаётся в строке
 * подключения руками. Если бы CLI брал схему из `?schema=` в URL, а приложение
 * из `DATABASE_SCHEMA`, они однажды разъехались бы молча: миграции создали бы
 * таблицы в одной схеме, а API писал бы в другую. На общей с чужим продуктом
 * базе «другая схема» — это схема соседа.
 *
 * Значение по умолчанию `public` совпадает с сегодняшним поведением.
 */
const schema = process.env.DATABASE_SCHEMA?.trim() || 'public'

if (!/^[a-z_][a-z0-9_$]*$/.test(schema)) {
  throw new Error(
    `DATABASE_SCHEMA=${schema} — не идентификатор схемы PostgreSQL. ` +
      'Допустимы строчные буквы, цифры и подчёркивание.',
  )
}

/** Строка подключения с принудительно выставленной схемой. */
const migrationUrl =
  databaseUrl === undefined
    ? undefined
    : (() => {
        const parsed = new URL(databaseUrl)
        parsed.searchParams.set('schema', schema)
        return parsed.toString()
      })()

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
  ...(migrationUrl === undefined ? {} : { datasource: { url: migrationUrl } }),
})
