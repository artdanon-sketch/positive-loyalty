import { writeFileSync, readFileSync, existsSync } from 'node:fs'

import pg from 'pg'

/**
 * Снимок состояния базы: что есть в схемах и кому принадлежит.
 *
 * ЗАЧЕМ. Система лояльности въезжает в базу, где уже живёт чужой продукт.
 * Утверждение «мы ничего у соседа не тронули» должно быть ДОКАЗАНО, а не
 * заявлено: сравнением снимков до и после наката.
 *
 * Снимаются только имена и количества — ни одной строки данных сайта скрипт
 * не читает. Заглядывать в чужие таблицы, чтобы доказать, что мы в них не
 * заглядывали, было бы странно.
 *
 * Применение:
 *   node prisma/scripts/schema-snapshot.mjs before   — до наката
 *   node prisma/scripts/schema-snapshot.mjs after    — после, сразу сравнит
 */

const { Client } = pg

const LABEL = process.argv[2] ?? 'snapshot'
const FILE = `.schema-snapshot-${LABEL}.json`
const BEFORE_FILE = '.schema-snapshot-before.json'

// Снимок снимается ПОД ВЛАДЕЛЬЦЕМ, а не под ролью приложения.
//
// information_schema показывает только те объекты, на которые у тебя есть права.
// Под ограниченной ролью схема соседа выглядела бы пустой — и снимок «до» совпал
// бы со снимком «после» просто потому, что мы ничего не видим. Проверка,
// которая не может увидеть нарушение, зелёная всегда.
const url = process.env.DATABASE_URL_OWNER?.trim() || process.env.DATABASE_URL

if (url === undefined || url.trim() === '') {
  process.stderr.write('DATABASE_URL не задан. Впишите его в .env\n')
  process.exit(1)
}

/**
 * SSL включается для всего, что не на этой машине.
 *
 * Проверено на живой базе: Supabase пускает и БЕЗ шифрования, а node-postgres
 * по умолчанию его не просит — то есть пароль и все данные шли бы через
 * интернет открытым текстом, и ничто бы об этом не сказало.
 *
 * `rejectUnauthorized: false` — сертификат Supabase подписан их собственным
 * центром, и строгая проверка на нём падает. Шифрование без проверки защищает
 * от подслушивания, но не от подмены; полная проверка требует их CA-сертификата
 * и сделана отдельно.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])
const isLocal = LOCAL_HOSTS.has(new URL(url).hostname)

const client = new Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})
await client.connect()

/** Таблицы по схемам. Только имена — содержимое чужих таблиц нас не касается. */
const tables = await client.query(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name
`)

/** Функции по схемам. Тут же видно, не осели ли наши у соседа. */
const functions = await client.query(`
  SELECT n.nspname AS schema, p.proname AS name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY n.nspname, p.proname
`)

/** Схемы и их владельцы. */
const schemas = await client.query(`
  SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner
  FROM pg_namespace
  WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
  ORDER BY nspname
`)

/** Роли: интересует наличие positive_app и то, что она не суперпользователь. */
const roles = await client.query(`
  SELECT rolname, rolsuper, rolcanlogin
  FROM pg_roles
  WHERE rolname NOT LIKE 'pg_%'
  ORDER BY rolname
`)

await client.end()

const group = (rows, keyField, valueField) => {
  const out = {}
  for (const row of rows) {
    const key = row[keyField]
    out[key] ??= []
    out[key].push(row[valueField])
  }
  return out
}

const snapshot = {
  label: LABEL,
  schemas: schemas.rows.map((r) => `${r.name} (владелец ${r.owner})`),
  tablesBySchema: group(tables.rows, 'table_schema', 'table_name'),
  functionsBySchema: group(functions.rows, 'schema', 'name'),
  roles: roles.rows.map(
    (r) => `${r.rolname}${r.rolsuper ? ' [СУПЕР]' : ''}${r.rolcanlogin ? ' [вход]' : ''}`,
  ),
}

writeFileSync(FILE, JSON.stringify(snapshot, null, 2))

const out = process.stdout
out.write(`\nСнимок «${LABEL}» сохранён в ${FILE}\n\n`)
out.write('Схемы:\n')
for (const s of snapshot.schemas) out.write(`  ${s}\n`)
out.write('\nТаблиц по схемам:\n')
for (const [schema, list] of Object.entries(snapshot.tablesBySchema)) {
  out.write(`  ${schema}: ${list.length}\n`)
}

/** После наката — сравниваем с «до» и показываем, что изменилось у соседа. */
if (LABEL === 'after' && existsSync(BEFORE_FILE)) {
  const before = JSON.parse(readFileSync(BEFORE_FILE, 'utf8'))

  out.write('\n─── Что изменилось ───\n')

  const beforePublic = new Set(before.tablesBySchema['public'] ?? [])
  const afterPublic = new Set(snapshot.tablesBySchema['public'] ?? [])

  const addedToPublic = [...afterPublic].filter((t) => !beforePublic.has(t))
  const removedFromPublic = [...beforePublic].filter((t) => !afterPublic.has(t))

  const beforePublicFns = new Set(before.functionsBySchema['public'] ?? [])
  const afterPublicFns = new Set(snapshot.functionsBySchema['public'] ?? [])
  const addedFns = [...afterPublicFns].filter((f) => !beforePublicFns.has(f))
  const removedFns = [...beforePublicFns].filter((f) => !afterPublicFns.has(f))

  let clean = true

  if (addedToPublic.length > 0) {
    clean = false
    out.write(`  ✗ В схему сайта ДОБАВЛЕНЫ таблицы: ${addedToPublic.join(', ')}\n`)
  }
  if (removedFromPublic.length > 0) {
    clean = false
    out.write(`  ✗ Из схемы сайта УДАЛЕНЫ таблицы: ${removedFromPublic.join(', ')}\n`)
  }
  if (addedFns.length > 0) {
    clean = false
    out.write(`  ✗ В схему сайта добавлены функции: ${addedFns.join(', ')}\n`)
  }
  if (removedFns.length > 0) {
    clean = false
    out.write(`  ✗ Из схемы сайта удалены функции: ${removedFns.join(', ')}\n`)
  }

  if (clean) {
    out.write('  ✓ Схема сайта (public) не изменилась ни на одну таблицу и функцию\n')
  }

  const ourTables = (snapshot.tablesBySchema['loyalty'] ?? []).length
  out.write(`  ✓ В схеме loyalty таблиц: ${ourTables}\n`)

  if (!clean) {
    out.write('\nИзменения в схеме сайта — это НЕ норма. Разбирайтесь до запуска.\n')
    process.exit(1)
  }
}

out.write('\n')
