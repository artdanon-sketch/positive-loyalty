/**
 * Помечает ESM-половину сборки как ESM.
 *
 * Корневой package.json пакета объявляет "type": "commonjs" — ради NestJS.
 * Из-за этого Node считает КАЖДЫЙ .js внутри пакета CommonJS-модулем, включая
 * файлы в dist/esm, и падает на первом же `export` при загрузке. Вложенный
 * package.json с "type": "module" переопределяет это для одной папки.
 *
 * Альтернатива — расширение .mjs — потребовала бы переписывать пути импортов
 * внутри сборки; вложенный маркер решает то же самое одной строкой.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const esmDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'esm')

await mkdir(esmDir, { recursive: true })
await writeFile(
  join(esmDir, 'package.json'),
  `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  'utf8',
)
