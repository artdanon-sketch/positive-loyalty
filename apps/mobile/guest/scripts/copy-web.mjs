import { cp, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Кладёт собранную веб-часть в `www/`, откуда её забирает Capacitor.
 *
 * Копирование, а не путь наружу в `webDir`: Capacitor резолвит `webDir`
 * относительно своей папки и заворачивает содержимое в нативный проект,
 * а ссылка через `../..` ломается ровно тогда, когда сборка идёт в CI
 * из другого рабочего каталога.
 */

/** Откуда берём собранное. Меняется вместе с приложением, остальное общее. */
const SOURCE_DIST = '../../../guest/dist-native'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, SOURCE_DIST)
const target = resolve(here, '../www')

try {
  await stat(source)
} catch {
  process.stderr.write(
    [
      `Нет собранной веб-части: ${source}`,
      'Сначала соберите её — `pnpm run web` в этой же папке.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

// Чистим перед копированием: иначе файлы прошлой сборки с другими хешами
// остаются в www и попадают в APK мёртвым грузом.
await rm(target, { recursive: true, force: true })
await cp(source, target, { recursive: true })

process.stdout.write(`Веб-часть скопирована: ${source} -> ${target}\n`)
