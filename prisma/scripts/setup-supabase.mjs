import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import pg from 'pg'

/**
 * Подготовка проекта Supabase к системе лояльности. Один запуск — и всё готово.
 *
 * ЗАЧЕМ ЭТОТ СКРИПТ СУЩЕСТВУЕТ. Ручная инструкция была такая: зайди в SQL Editor,
 * выполни блок SQL, придумай пароль, проверь список Exposed schemas, впиши строку
 * подключения в .env, добавь переменную схемы. Шесть действий, каждое со своим
 * способом ошибиться молча — а владелец проекта не программист. Всё это умеет
 * сделать программа; человеку остаётся ровно одно, чего программа сделать
 * не может: достать строку подключения из личного кабинета Supabase.
 *
 * ДВЕ УЧЁТНЫЕ ЗАПИСИ, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА.
 *
 *   DATABASE_URL_OWNER — владелец. Только миграции: создать таблицы, функции,
 *                        политики. Читает её один prisma.config.ts.
 *   DATABASE_URL       — ограниченная роль positive_app. Под ней работает
 *                        приложение, и только под ней действует изоляция
 *                        заведений: владелец таблицы игнорирует и REVOKE,
 *                        и политики RLS.
 *
 * Первая версия писала владельца в DATABASE_URL, а роль — в переменную,
 * которую в репозитории не читал никто. Выглядело настроенным, а приложение
 * ходило бы в базу владельцем: полные права на схему сайта и никакой изоляции.
 * Разводить эти две строки — не педантизм, а единственное, что делает изоляцию
 * настоящей.
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ НАМЕРЕННО:
 *   • ничего не меняет в схеме соседа (сайта). Считает в ней таблицы — и только:
 *     без этого числа нечего было бы сравнивать, чтобы доказать, что мы
 *     не наследили. Ни одной строки данных сайта скрипт не читает;
 *   • не накатывает миграции: это отдельный шаг, чтобы сбой было видно отдельно;
 *   • не печатает ни одного пароля и не показывает вводимую строку на экране.
 *
 * Запуск:
 *   pnpm setup:supabase
 *   node prisma/scripts/setup-supabase.mjs --check           только проверить
 *   node prisma/scripts/setup-supabase.mjs --reset-password  выдать роли новый пароль
 */

const { Client } = pg

const SCHEMA = 'loyalty'
const APP_ROLE = 'positive_app'

// Пути считаются от САМОГО ФАЙЛА, а не от текущего каталога.
// Иначе запуск из другого места создал бы посторонний .env и отрапортовал
// об успехе, пока настоящий файл остался бы с локальными настройками.
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ENV_FILE = join(ROOT, '.env')
const ENV_BACKUP = join(ROOT, '.env.backup-before-supabase')

const args = new Set(process.argv.slice(2))
const CHECK_ONLY = args.has('--check')
const RESET_PASSWORD = args.has('--reset-password')

const out = process.stdout
const say = (s = '') => out.write(`${s}\n`)
const die = (s) => {
  say('')
  say(`✗ ${s}`)
  say('')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Работа с .env: правим точечно, чужие строки не теряем.
// ─────────────────────────────────────────────────────────────────────────────

const readEnv = () => (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '')

/** Снимает кавычки и пробелы — ровно так же, как это делает загрузчик .env. */
const clean = (value) => value.trim().replace(/^["']|["']$/g, '')

const envValue = (text, name) => {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0 && trimmed.slice(0, eq).trim() === name) {
      // Кавычки снимаем ЗДЕСЬ. Node при загрузке .env их снимает, а наивное
      // чтение — нет; из-за этого сравнение схемы ложно расходилось, а строка
      // подключения в кавычках уходила в драйвер и падала непонятной ошибкой.
      return clean(trimmed.slice(eq + 1))
    }
  }
  return undefined
}

/** Ставит переменную: заменяет существующую строку либо дописывает в конец. */
const setEnvValue = (text, name, value) => {
  const lines = text.split(/\r?\n/)
  let replaced = false

  const next = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) return line
    const eq = trimmed.indexOf('=')
    if (eq > 0 && trimmed.slice(0, eq).trim() === name) {
      replaced = true
      return `${name}=${value}`
    }
    return line
  })

  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('')
    next.push(`${name}=${value}`)
    next.push('')
  }

  return next.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Разбор строки подключения.
// ─────────────────────────────────────────────────────────────────────────────

/** Параметры SSL из строки перебивают опцию ssl объекта — убираем их. */
const SSL_PARAMS = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation']

const parseConnection = (raw, { source = 'ввод' } = {}) => {
  const value = clean(raw)

  if (value === '') {
    die('Строка пустая. Запусти команду ещё раз и вставь адрес из Supabase.')
  }

  if (!/^postgres(ql)?:\/\//i.test(value)) {
    die(
      `Это не похоже на адрес базы (${source}). Он должен начинаться с postgresql://\n` +
        '  В Supabase: зелёная кнопка Connect наверху страницы проекта.',
    )
  }

  if (/\[YOUR-PASSWORD\]|\[ВАШ-ПАРОЛЬ\]|YOUR_PASSWORD/i.test(value)) {
    die(
      'В адресе осталась подстановка [YOUR-PASSWORD] — Supabase не показывает пароль сам.\n' +
        '  Замени её на пароль базы (тот, что задавался при создании проекта),\n' +
        '  либо задай новый: Project Settings → Database → Reset database password.',
    )
  }

  let url
  try {
    url = new URL(value)
  } catch {
    // Самая частая причина — спецсимвол в пароле. Называем его прямо:
    // совет «скопируй заново» тут бесполезен, копирование ничего не изменит.
    const at = value.lastIndexOf('@')
    const colon = value.indexOf(':', value.indexOf('://') + 3)
    const password = at > colon && colon > 0 ? value.slice(colon + 1, at) : ''
    const bad = [...password].find((ch) => '/?#[]@ '.includes(ch))

    if (bad !== undefined) {
      const code = `%${bad.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
      die(
        `В пароле есть символ «${bad}» — он ломает разбор адреса.\n` +
          `  Замени его в строке на ${code}, либо задай пароль без спецсимволов:\n` +
          '  Project Settings → Database → Reset database password.',
      )
    }

    die('Адрес не разбирается. Скопируй его из Supabase ещё раз, целиком, без пробелов.')
  }

  const port = url.port === '' ? '5432' : url.port

  if (port === '6543') {
    die(
      'Это адрес транзакционного пулера (порт 6543). Он не умеет создавать таблицы.\n' +
        '  Нужен адрес с портом 5432: в окне Connect выбери «Session pooler»\n' +
        '  или «Direct connection» — у обоих порт 5432.',
    )
  }

  if (port !== '5432') {
    say(`  ⚠ Необычный порт ${port}. Обычно у Supabase это 5432. Продолжаю.`)
  }

  // Режим SSL задаём только объектом, поэтому из строки его вычищаем.
  // Иначе pg берёт настройку из строки и МОЛЧА игнорирует опцию ssl —
  // то есть выбранный нами режим проверки сертификата не применяется вовсе.
  for (const key of SSL_PARAMS) url.searchParams.delete(key)

  return { value: url.toString(), url, port, hostname: url.hostname }
}

// ─────────────────────────────────────────────────────────────────────────────
// Единый разбор ошибок подключения.
//
// Раньше он существовал только для первой попытки, а вторая (обычный путь для
// Supabase) падала голым стектрейсом. Одна функция на оба вызова — значит
// человек получит понятный текст, каким бы путём соединение ни сорвалось.
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0']

const explain = (error, hostname) => {
  const message = String(error?.message ?? error)

  if (/password authentication failed/i.test(message)) {
    die(
      'База отказала в пароле.\n' +
        '  Проверь, что в адресе стоит настоящий пароль базы, а не подстановка.\n' +
        '  Задать новый: Supabase → Project Settings → Database → Reset database password.',
    )
  }

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    die(
      `Не нашёлся сервер ${hostname}.\n` +
        '  Проверь интернет и что адрес скопирован целиком, без переносов строки.',
    )
  }

  if (/ENETUNREACH|EHOSTUNREACH|EAFNOSUPPORT|ENETDOWN|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    if (LOCAL_HOSTS.includes(hostname)) {
      die(
        `Адрес ведёт на эту же машину (${hostname}), и база там не отвечает.\n` +
          '  Это локальная база для разработки, а не Supabase — она сейчас выключена.\n' +
          '  Нужен адрес из личного кабинета Supabase, в нём есть слово supabase.',
      )
    }

    die(
      `Сервер ${hostname} недоступен.\n` +
        '  Самая частая причина: «Direct connection» у Supabase работает только\n' +
        '  по IPv6, а у большинства домашних провайдеров его нет.\n' +
        '\n' +
        '  Что делать: в окне Connect выбери вкладку «Session pooler»\n' +
        '  (у неё тот же порт 5432) и запусти команду заново.',
    )
  }

  die(`Не удалось подключиться: ${message}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Соединение.
//
// Сначала пробуем с полной проверкой сертификата. Если сертификат подписан
// собственным центром Supabase, проверка не пройдёт — тогда повторяем без неё
// и ГОВОРИМ ОБ ЭТОМ ВСЛУХ. Молча ослабить проверку хуже, чем сообщить.
// ─────────────────────────────────────────────────────────────────────────────

const connect = async (connectionString, hostname) => {
  const strict = new Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
    application_name: 'positive-loyalty-setup',
  })

  try {
    await strict.connect()
    return { client: strict, verified: true }
  } catch (error) {
    try {
      await strict.end()
    } catch {
      /* соединение и не открылось */
    }

    if (!/certificate|self[- ]signed|SSL|CERT_/i.test(String(error?.message ?? error))) {
      explain(error, hostname)
    }

    say('  ⚠ Сертификат сервера не проверился — продолжаю без проверки.')
    say('    Так Supabase подключается по умолчанию. Это разовая настройка;')
    say('    приложение потом ходит в базу своим путём.')

    const relaxed = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      application_name: 'positive-loyalty-setup',
    })

    try {
      await relaxed.connect()
    } catch (secondError) {
      explain(secondError, hostname)
    }

    return { client: relaxed, verified: false }
  }
}

/** Проверка «роль реально может войти» — по факту, а не по наличию строки. */
const canLogIn = async (connectionString) => {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: 'positive-loyalty-setup-verify',
  })

  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    try {
      await client.end()
    } catch {
      /* уже закрыто */
    }
  }
}

/** Строка подключения для роли приложения на том же сервере. */
const appUrlFrom = (ownerUrl, password) => {
  const u = new URL(ownerUrl)

  // Имя пользователя у пулера Supabase выглядит как `postgres.идентификатор`:
  // хвост после точки — адрес, по которому пулер понимает, в какой проект вести.
  // Подставив просто `positive_app`, мы бы отрезали его, и через пулер
  // соединение перестало бы находить базу.
  const currentUser = decodeURIComponent(u.username)
  const dot = currentUser.indexOf('.')

  u.username = dot > 0 ? `${APP_ROLE}${currentUser.slice(dot)}` : APP_ROLE
  u.password = password

  return u.toString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Главное.
// ─────────────────────────────────────────────────────────────────────────────

say('')
say('═══════════════════════════════════════════════════════════════')
say('  Настройка Supabase для системы лояльности')
say('═══════════════════════════════════════════════════════════════')
say('')

const existingEnv = readEnv()
const existingOwner = envValue(existingEnv, 'DATABASE_URL_OWNER')
const existingApp = envValue(existingEnv, 'DATABASE_URL')

let owner

if (CHECK_ONLY) {
  const schema = envValue(existingEnv, 'DATABASE_SCHEMA')

  if (existingOwner === undefined || schema !== SCHEMA) {
    die(
      'Похоже, настройка ещё не выполнялась: в .env нет DATABASE_URL_OWNER\n' +
        '  или DATABASE_SCHEMA=loyalty.\n' +
        '  Запусти:  pnpm setup:supabase',
    )
  }

  owner = parseConnection(existingOwner, { source: '.env' })
  say('Проверяю по адресу, записанному в .env. Ничего не меняю.')
  say('')
} else if (typeof process.env['SETUP_DATABASE_URL'] === 'string') {
  // Неинтерактивный вход — для автоматических проверок и разбора этого файла.
  // Обычный путь остаётся интерактивным: в переменной окружения секрет живёт
  // дольше, чем нужно, и попадает в историю оболочки.
  owner = parseConnection(process.env['SETUP_DATABASE_URL'], { source: 'SETUP_DATABASE_URL' })
  say('Адрес взят из SETUP_DATABASE_URL.')
  say('')
} else {
  if (process.stdin.isTTY !== true) {
    die(
      'Эту команду нужно запускать в обычном окне терминала: она задаёт вопрос\n' +
        '  и ждёт ответа. Сейчас ввод подан не с клавиатуры.\n' +
        '\n' +
        '  Если это автоматический запуск — передай адрес так:\n' +
        '    SETUP_DATABASE_URL=... node prisma/scripts/setup-supabase.mjs',
    )
  }

  say('Мне нужен адрес твоей базы. Где его взять:')
  say('')
  say('  1. Открой supabase.com и зайди в проект сайта.')
  say('  2. Сверху нажми зелёную кнопку «Connect».')
  say('  3. Выбери вкладку «Session pooler». Если её нет — «Direct connection».')
  say('  4. Скопируй строку целиком. Она начинается с postgresql://')
  say('  5. Если внутри написано [YOUR-PASSWORD] — замени это на пароль базы.')
  say('')
  say('Вставь строку и нажми Enter.')
  say('ТЕКСТ НА ЭКРАНЕ НЕ ПОЯВИТСЯ — так и задумано, в нём твой пароль.')
  say('')

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })

  let muted = false
  const write = rl._writeToOutput?.bind(rl)
  rl._writeToOutput = (chunk) => {
    if (!muted && write) write(chunk)
  }

  let answer
  try {
    const pending = rl.question('> ')
    muted = true
    answer = await pending
  } catch {
    // Ctrl+C внутри вопроса приходит сюда как AbortError. Без перехвата
    // человек увидел бы английский стектрейс вместо слова «отменено».
    muted = false
    rl.close()
    say('')
    say('Отменено. Ничего не изменено.')
    say('')
    process.exit(130)
  }

  muted = false
  rl.close()
  out.write('\n')

  owner = parseConnection(answer)
  say('')
}

const { client, verified } = await connect(owner.value, owner.hostname)

say('✓ Подключился к базе.')

// ── Что уже есть ─────────────────────────────────────────────────────────────

const { rows: state } = await client.query(
  `SELECT
     current_user                                                          AS who,
     (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user)      AS can_create_role,
     (SELECT count(*) FROM pg_namespace WHERE nspname = $1)                 AS schema_exists,
     (SELECT count(*) FROM pg_roles     WHERE rolname = $2)                 AS role_exists,
     (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE')         AS site_tables,
     (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = $1)                                            AS our_tables,
     (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = '_prisma_migrations')      AS our_marker`,
  [SCHEMA, APP_ROLE],
)

const s = state[0]
const schemaExisted = Number(s.schema_exists) > 0
const roleExisted = Number(s.role_exists) > 0

say(`✓ У сайта в базе ${s.site_tables} таблиц. Мы их не тронем.`)

// ── Режим проверки ───────────────────────────────────────────────────────────

if (CHECK_ONLY) {
  const { rows: stray } = await client.query(
    `SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN (
        'auth_tenant_for_device','pos_link_for_merchant',
        'webhook_deliveries_due','ledger_entries_awaiting_delivery')`,
  )

  await client.end()

  const appWorks = existingApp === undefined ? false : await canLogIn(existingApp)

  say('')
  say(`  схема ${SCHEMA}:              ${schemaExisted ? 'есть' : 'НЕТ'}`)
  say(`  роль ${APP_ROLE}:        ${roleExisted ? 'есть' : 'НЕТ'}`)
  say(`  наших таблиц в ${SCHEMA}:     ${s.our_tables}`)
  say(`  вход под ролью приложения:  ${appWorks ? 'работает' : 'НЕ РАБОТАЕТ'}`)
  say(`  наших следов у соседа:      ${stray[0].n} (должно быть 0)`)
  say('')

  process.exit(Number(stray[0].n) === 0 && appWorks ? 0 : 1)
}

// ── Право заводить роли ──────────────────────────────────────────────────────
//
// Проверяется ТОЛЬКО при настройке. В режиме --check строка подключения ведёт
// под ролью приложения, у которой этого права нет и быть не должно — требовать
// его там значило бы ронять проверку ровно на правильно настроенной машине.

if (s.can_create_role !== true) {
  await client.end()
  die(
    `Пользователь ${s.who} не может создавать роли.\n` +
      '  Нужен адрес с пользователем postgres — именно он в строке из Supabase.',
  )
}

say('✓ Прав достаточно.')

// ── Схема ────────────────────────────────────────────────────────────────────
//
// Имя фиксировано и не приходит извне: подставлять в DDL имя из пользовательского
// ввода — прямая дорога к внедрению SQL.

if (schemaExisted && Number(s.our_tables) > 0 && Number(s.our_marker) === 0) {
  await client.end()
  die(
    `Схема ${SCHEMA} уже существует, в ней ${s.our_tables} таблиц, и это НЕ наши.\n` +
      '  Присваивать чужую схему нельзя. Разберись, чья она, или заведи нашу\n' +
      '  под другим именем — скажи об этом Клоду, он поменяет имя в настройках.',
  )
}

await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
say(`✓ Схема ${SCHEMA} ${schemaExisted ? 'уже была' : 'создана'}.`)

// ── Роль приложения ──────────────────────────────────────────────────────────
//
// Нужен ли новый пароль — решается ПО ФАКТУ ВХОДА, а не по наличию строки в .env.
//
// Иначе выходило вот что: роль positive_app общая на весь проект Supabase,
// а .env лежит на конкретной машине. Запуск с другой машины, где строки нет,
// перевыпускал бы пароль — и боевое приложение, которому старый пароль вписан
// в настройках хостинга, теряло бы доступ к базе. Причина при этом лежала бы
// на чужом компьютере.
//
// Проверка входом заодно чинит обрыв посередине: если прошлый запуск успел
// сменить пароль, но не успел записать файл, вход не пройдёт — и пароль
// будет выдан заново, а не объявлен «уже настроенным».

if (!roleExisted) {
  await client.query(`CREATE ROLE ${APP_ROLE} NOLOGIN`)
}

const appStillWorks =
  !RESET_PASSWORD &&
  roleExisted &&
  existingApp !== undefined &&
  existingApp.includes(APP_ROLE) &&
  (await canLogIn(existingApp))

let appUrl

if (appStillWorks) {
  appUrl = existingApp
  say(`✓ Роль ${APP_ROLE} уже работает — пароль оставлен прежним.`)
} else {
  // Пароль генерируется здесь и уходит прямо в .env. На экран он не печатается:
  // содержимое терминала легко переслать не тому, кому следует.
  const password = randomBytes(24).toString('base64url')

  // ALTER ROLE — служебная команда, и параметры ($1) она НЕ принимает.
  // Значит пароль придётся вставить в текст. Это безопасно ровно потому, что он
  // сгенерирован здесь же из букв, цифр, дефиса и подчёркивания — кавычке
  // взяться неоткуда. Проверка ниже делает это утверждение фактом.
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    await client.end()
    die('Внутренняя ошибка: сгенерирован пароль с недопустимыми символами.')
  }

  await client.query(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${password}'`)
  appUrl = appUrlFrom(owner.value, password)

  say(`✓ Роль ${APP_ROLE} ${roleExisted ? 'получила новый пароль' : 'создана'}.`)
}

// ── Схема не должна торчать наружу через API Supabase ────────────────────────
//
// PostgREST отдаёт наружу схемы из своего списка, а список хранится настройкой
// роли `authenticator`. Раньше я читал его через current_setting в своей сессии —
// там его нет никогда, так что ветка успеха была недостижима, и проверка
// всегда отвечала «прочитать не удалось».

const { rows: pgrst } = await client.query(
  `SELECT unnest(coalesce(rolconfig, '{}')) AS setting
     FROM pg_roles WHERE rolname = 'authenticator'`,
)

const exposedLine = pgrst.map((r) => r.setting).find((v) => v.startsWith('pgrst.db_schemas='))

if (exposedLine === undefined) {
  say('  · Список Exposed schemas прочитать не удалось. Проверь глазами:')
  say(`    Project Settings → API → Exposed schemas. Схемы ${SCHEMA} там быть не должно.`)
} else if (
  exposedLine
    .slice('pgrst.db_schemas='.length)
    .split(',')
    .map((v) => v.trim())
    .includes(SCHEMA)
) {
  await client.end()
  die(
    `Схема ${SCHEMA} отдаётся наружу через API Supabase.\n` +
      '  Это значит, что данные лояльности доступны публичным ключом проекта\n' +
      '  в обход нашего API и всех его проверок.\n' +
      '\n' +
      `  Убери ${SCHEMA} из списка: Project Settings → API → Exposed schemas,\n` +
      '  сохрани и запусти команду заново.',
  )
} else {
  say(`✓ Наружу через API Supabase схема ${SCHEMA} не отдаётся.`)
}

await client.end()

// ── Запись .env ──────────────────────────────────────────────────────────────

if (!existsSync(ENV_FILE)) {
  say(`  · Файла ${ENV_FILE} не было — создаю новый.`)
} else if (!existsSync(ENV_BACKUP)) {
  copyFileSync(ENV_FILE, ENV_BACKUP)
  say('✓ Прежний .env сохранён как .env.backup-before-supabase.')
}

let text = readEnv()
text = setEnvValue(text, 'DATABASE_URL', appUrl)
text = setEnvValue(text, 'DATABASE_URL_OWNER', owner.value)
text = setEnvValue(text, 'DATABASE_SCHEMA', SCHEMA)
writeFileSync(ENV_FILE, text)

say('✓ Файл .env обновлён.')

// ── Проверка боем ────────────────────────────────────────────────────────────
//
// Записать строку и объявить успех — не одно и то же. Если под этой строкой
// не входится, узнать об этом надо здесь, а не при первом запуске приложения.

if (!(await canLogIn(appUrl))) {
  die(
    'Записал настройки, но войти под ролью приложения не удалось.\n' +
      '  Похоже, Supabase не принял пароль. Попробуй ещё раз:\n' +
      '    node prisma/scripts/setup-supabase.mjs --reset-password',
  )
}

say('✓ Вход под ролью приложения проверен — работает.')

// ── Предупреждение про остальные базы в .env ────────────────────────────────
//
// DATABASE_SCHEMA одна на процесс и действует на ВСЕ строки подключения.
// Локальные тестовые базы, где таблицы лежат в public, после этой записи
// перестанут находиться. Промолчать значило бы оставить человеку загадку.

const otherDatabases = existingEnv
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => !l.startsWith('#') && /^DATABASE_URL_(TEST|TEST_APP_ROLE)\b/.test(l))
  .map((l) => l.slice(0, l.indexOf('=')))

if (otherDatabases.length > 0) {
  say('')
  say(`  · В .env остались другие базы: ${otherDatabases.join(', ')}.`)
  say(`    Они теперь тоже читаются в схеме ${SCHEMA}, а не public,`)
  say('    так что локальные интеграционные тесты работать не будут.')
  say('    Боевой системы это не касается.')
}

say('')
say('═══════════════════════════════════════════════════════════════')
say('  Готово. Ни одна таблица сайта не тронута.')
say('')
say('  Таблицы лояльности ещё не созданы — это следующий шаг.')
say('  Скажи Клоду «готово», он накатит их и всё проверит.')
say('═══════════════════════════════════════════════════════════════')

if (!verified) {
  say('')
  say('  (подключение шло без проверки сертификата — см. сообщение выше)')
}

say('')
