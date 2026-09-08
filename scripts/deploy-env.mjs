import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * Собирает переменные окружения для боевого сервера в файл, который можно
 * вставить в Railway одним куском.
 *
 * ЗАЧЕМ ФАЙЛ, А НЕ ВЫВОД НА ЭКРАН. Среди переменных строка подключения к базе
 * с паролем. Напечатанная в терминале, она остаётся в прокрутке, попадает
 * в снимок экрана и оттуда — в переписку. Уже случалось. В файл её видно
 * только тому, кто откроет файл.
 *
 * ЗАЧЕМ ВООБЩЕ СКРИПТ. Вручную это шесть строк, три из которых легко перепутать
 * местами: под какой ролью ходит приложение, в какой схеме лежат таблицы,
 * и какой длины должен быть секрет подписи. Ошибка в первой из них — тихая:
 * всё работает, но изоляция заведений не действует.
 *
 * Запуск:
 *   pnpm setup:deploy https://админка.pages.dev https://гость.pages.dev
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ENV_FILE = join(ROOT, '.env')
const OUT_FILE = join(ROOT, '.env.railway')

const out = process.stdout
const say = (s = '') => out.write(`${s}\n`)
const die = (s) => {
  say('')
  say(`✗ ${s}`)
  say('')
  process.exit(1)
}

// ── Что уже настроено локально ───────────────────────────────────────────────

if (!existsSync(ENV_FILE)) {
  die('Файла .env нет. Сначала настрой базу:  pnpm setup:supabase')
}

const envText = readFileSync(ENV_FILE, 'utf8')

const envValue = (name) => {
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0 && trimmed.slice(0, eq).trim() === name) {
      return trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  }
  return undefined
}

const databaseUrl = envValue('DATABASE_URL')
const schema = envValue('DATABASE_SCHEMA')

if (databaseUrl === undefined || databaseUrl === '') {
  die('В .env нет DATABASE_URL. Сначала настрой базу:  pnpm setup:supabase')
}

if (schema === undefined || schema === '') {
  die('В .env нет DATABASE_SCHEMA. Сначала настрой базу:  pnpm setup:supabase')
}

// ── Главная проверка ─────────────────────────────────────────────────────────
//
// Приложение обязано ходить в базу ОГРАНИЧЕННОЙ ролью. Владелец таблицы
// игнорирует и запреты, и политики доступа: под ним изоляция заведений
// не действует, хотя всё выглядит настроенным.
//
// Отказ этот тихий — ровно поэтому проверка здесь. Один раз такая строка
// уже уехала не в ту переменную, и обнаружилось это только на ревью.

let user
try {
  user = decodeURIComponent(new URL(databaseUrl).username)
} catch {
  die('DATABASE_URL из .env не разбирается как адрес. Проверь файл.')
}

if (!user.startsWith('positive_app')) {
  die(
    `DATABASE_URL в .env ведёт под пользователем «${user}», а не positive_app.\n` +
      '  Выкладывать сервер с этой строкой нельзя: под владельцем базы\n' +
      '  изоляция заведений не действует, а доступ есть и к схеме сайта.\n' +
      '\n' +
      '  Похоже, .env собран вручную. Перенастрой:  pnpm setup:supabase',
  )
}

if (!existsSync(join(ROOT, 'prisma', 'migrations'))) {
  die('Не похоже на корень проекта: не найдена папка prisma/migrations.')
}

// ── Адреса сайтов ────────────────────────────────────────────────────────────

const origins = process.argv.slice(2)

if (origins.length === 0) {
  die(
    'Не указаны адреса сайтов.\n' +
      '  Их выдаёт Cloudflare после первой выкладки, вид такой:\n' +
      '    pnpm setup:deploy https://positive-admin.pages.dev https://positive-guest.pages.dev\n' +
      '\n' +
      '  Без них сервер не пустит браузер: он отвечает только тем адресам,\n' +
      '  которые названы здесь явно.',
  )
}

for (const origin of origins) {
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    die(`«${origin}» — не адрес сайта. Нужен вид https://что-то.pages.dev`)
  }

  if (parsed.protocol !== 'https:') {
    die(`«${origin}» — нужен https, а не ${parsed.protocol.replace(':', '')}.`)
  }

  if (parsed.pathname !== '/' || parsed.search !== '') {
    die(
      `«${origin}» — нужен только адрес сайта, без пути после него.\n` +
        `  Например: ${parsed.origin}`,
    )
  }
}

// Только origin, без завершающей косой черты: браузер присылает заголовок
// именно в таком виде, и лишний символ превратит проверку в отказ.
const corsOrigins = origins.map((o) => new URL(o).origin).join(',')

// ── Секрет подписи ───────────────────────────────────────────────────────────
//
// Из него выводится tenantId в токене, то есть от него напрямую зависит
// изоляция заведений: подобрал секрет — выписал себе токен с чужим заведением.
// Поэтому он не придумывается человеком и не переиспользуется с локальной машины.

const accessTokenSecret = randomBytes(48).toString('base64url')

// ── Секреты админки платформы ────────────────────────────────────────────────
//
// ОТДЕЛЬНЫЕ ОТ ВЫШЕ, И ЭТО ГЛАВНОЕ. Панель платформы работает вторым процессом
// и видит данные ВСЕХ заведений. Общий с основным API секрет подписи означал бы,
// что скомпрометированная панель может выписать токен любого владельца.
// А ключ шифрования второго фактора основному API не нужен вовсе.
//
// Каждый процесс получает ровно те секреты, которыми пользуется сам.

const platformTokenSecret = randomBytes(48).toString('base64url')
const platformTotpEncKey = randomBytes(32).toString('base64')

// Строку подключения роли платформы берём из .env, а не выдумываем: пароль
// этой роли выдавал администратор среды, и второго такого пароля не существует.
const platformDatabaseUrl = envValue('DATABASE_URL_PLATFORM')

// ── Файл ─────────────────────────────────────────────────────────────────────

const lines = [
  '# Переменные для боевого сервера (Railway).',
  '#',
  '# Скопируй ВСЁ содержимое этого файла и вставь в Railway:',
  '#   проект → сервис api → вкладка Variables → кнопка Raw Editor → вставить → Save.',
  '#',
  '# Файл в репозиторий не попадает: он подходит под правило .env.* в .gitignore.',
  '# Секрет подписи здесь новый — он не совпадает с локальным, и это правильно.',
  '',
  'NODE_ENV=production',
  `DATABASE_URL=${databaseUrl}`,
  `DATABASE_SCHEMA=${schema}`,
  `ACCESS_TOKEN_SECRET=${accessTokenSecret}`,
  `CORS_ORIGINS=${corsOrigins}`,
  '',
]

writeFileSync(OUT_FILE, lines.join('\n'))

// ── Файл для сервиса админки платформы ───────────────────────────────────────

const PLATFORM_OUT_FILE = '.env.railway.platform'

const platformLines = [
  '# Переменные для ВТОРОГО сервиса Railway — админки платформы.',
  '#',
  '# Это НЕ те же настройки, что у сервиса api, и путать их нельзя:',
  '#   • роль базы здесь positive_platform — она видит все заведения;',
  '#   • секрет подписи свой, чтобы токены двух контуров были несовместимы;',
  '#   • ACCESS_TOKEN_SECRET здесь НЕТ намеренно: панели он не нужен, а его',
  '#     наличие позволило бы ей выписывать токены владельцев заведений.',
  '#',
  '# Куда вставлять:',
  '#   проект → сервис platform → Variables → Raw Editor → вставить → Save.',
  '',
  'NODE_ENV=production',
  `DATABASE_URL_PLATFORM=${platformDatabaseUrl ?? '<нет в .env — см. подсказку в терминале>'}`,
  `DATABASE_SCHEMA=${schema}`,
  `PLATFORM_ACCESS_TOKEN_SECRET=${platformTokenSecret}`,
  `PLATFORM_TOTP_ENC_KEY=${platformTotpEncKey}`,
  `CORS_ORIGINS=${corsOrigins}`,
  '',
]

writeFileSync(PLATFORM_OUT_FILE, platformLines.join('\n'))

say('')
say('✓ Настройки для сервера собраны.')
say('')
say(`  Файл:  .env.railway`)
say(`  База:  под ролью ${user} — верно, приложение не владелец`)
say(`  Схема: ${schema}`)
say(`  Сайты, которым сервер будет отвечать:`)
for (const origin of origins) say(`           ${new URL(origin).origin}`)
say('')
say('  Что делать: открой .env.railway, скопируй всё целиком')
say('  и вставь в Railway → сервис api → Variables → Raw Editor → Save.')
say('')
say('  Ни одного пароля на этот экран не выведено.')
say('')
say('─────────────────────────────────────────────────────────')
say('')
say('✓ Настройки для админки платформы собраны отдельно.')
say('')
say('  Файл:  .env.railway.platform')
say('  База:  под ролью positive_platform — той, что видит все заведения')
say('')
if (platformDatabaseUrl === undefined || platformDatabaseUrl === '') {
  say('  ВНИМАНИЕ: в .env нет DATABASE_URL_PLATFORM.')
  say('  Роль заводится миграцией без права входа; пароль ей выдаёт')
  say('  администратор среды одной командой:')
  say("    ALTER ROLE positive_platform LOGIN PASSWORD '<пароль>';")
  say('  Впиши строку подключения в .env и запусти скрипт заново.')
  say('')
}
say('  ВАЖНО ПРО PLATFORM_TOTP_ENC_KEY: им зашифрованы секреты второго фактора.')
say('  Потеря ключа = потеря 2FA у всех админов, восстановить будет нечем.')
say('  Храни там же, где пароли базы.')
say('')
