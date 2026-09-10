/**
 * Кладёт рядом с собранным кодом список миграций, с которым собран образ.
 *
 * ЗАЧЕМ НЕ ЧИТАТЬ КАТАЛОГ НАПРЯМУЮ. Проверка на старте (assert-migrated.ts)
 * сверяет базу с тем, что ожидает КОД. Каталога `prisma/migrations` в собранном
 * образе может не оказаться: что попадёт в него, решает сборщик, и однажды это
 * молча изменится. Проверка тогда увидит ноль ожидаемых миграций и будет всегда
 * довольна — то есть перестанет работать ровно тогда, когда нужнее всего.
 *
 * Список снимается на сборке, в репозитории, где каталог заведомо есть,
 * и едет вместе с кодом одним файлом.
 *
 * Имена — те же, что Prisma пишет в `_prisma_migrations.migration_name`:
 * имя каталога миграции целиком.
 */

import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', 'prisma', 'migrations')
const outFile = join(here, '..', 'dist', 'migrations-manifest.json')

if (!existsSync(migrationsDir)) {
  process.stderr.write(`Каталог миграций не найден: ${migrationsDir}\n`)
  process.exit(1)
}

const names = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

if (names.length === 0) {
  // Пустой список сделал бы проверку бессмысленной — лучше сломать сборку.
  process.stderr.write('В каталоге миграций нет ни одной — сборка остановлена.\n')
  process.exit(1)
}

writeFileSync(outFile, `${JSON.stringify(names, null, 2)}\n`, 'utf8')
process.stdout.write(`Список миграций записан: ${names.length} шт. → ${outFile}\n`)
