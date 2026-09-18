import { parseProgramConfig } from '@positive/contracts'

import { loadApiRuntime } from './api-runtime.ts'

/**
 * Заводит боевое заведение: само заведение, владельца и его устройство входа.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ seed.ts. Seed наполняет полигон выдуманными данными:
 * двести гостей, девяносто дней продаж. Здесь не создаётся ни одного гостя
 * и ни одной операции — только то, без чего в систему нельзя войти. На боевой
 * базе это важно: операции журнала удалить невозможно, и выдуманная продажа
 * останется в отчётах навсегда.
 *
 * ПОЧЕМУ ПОД ВЛАДЕЛЬЦЕМ БАЗЫ. Политика доступа на таблице заведений разрешает
 * видеть и менять только своё заведение — то, чей идентификатор объявлен
 * в текущей транзакции. У НОВОГО заведения такого идентификатора ещё нет,
 * поэтому завести его ограниченной ролью нельзя в принципе. Это не обход
 * защиты, а её прямое следствие: раздача прав — работа администратора,
 * как и миграции.
 *
 * PIN НЕ ПОПАДАЕТ НИ В КОМАНДУ, НИ НА ЭКРАН. Он спрашивается отдельно и скрыто:
 * то, что набрано в командной строке, остаётся в истории оболочки и видно
 * в списке процессов.
 *
 * Запуск:
 *   pnpm setup:business "Kefir=RESTAURANT" "Siri massage=SPA"
 *
 * Виды: RESTAURANT, SPA, RENTAL, RETAIL, OTHER.
 * Повторный запуск безопасен: заведения и сотрудники обновляются, а не двоятся.
 */

const VERTICALS = ['RESTAURANT', 'SPA', 'RENTAL', 'RETAIL', 'OTHER'] as const
type Vertical = (typeof VERTICALS)[number]

const out = process.stdout
const say = (s = ''): void => void out.write(`${s}\n`)

const die = (message: string): never => {
  say('')
  say(`✗ ${message}`)
  say('')
  process.exit(1)
}

/** Латиница, цифры и дефис — из этого получаются код устройства и идентификаторы. */
const slugify = (name: string): string => {
  const translit: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }

  const slug = [...name.toLowerCase()]
    .map((ch) => translit[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug === '') {
    die(`Из названия «${name}» не получается код: в нём нет ни латиницы, ни цифр.`)
  }

  return slug
}

/**
 * Скрытый ввод.
 *
 * Тот же приём, что и в настройке Supabase, и по той же причине: подмена
 * внутреннего метода readline на живой машине не сработала, и вставленный
 * секрет оказался на экране. Читаем посимвольно сами.
 */
/** Обычный видимый ввод строки — для почты: она не секрет. */
const askLine = async (prompt: string): Promise<string> => {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: out })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
  }
}

const askHidden = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    const stdin = process.stdin

    if (typeof stdin.setRawMode !== 'function') {
      die('Эту команду нужно запускать в обычном окне терминала: она задаёт вопрос.')
    }

    out.write(prompt)

    const wasRaw = stdin.isRaw === true
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''
    let inEscape = false

    const finish = (done: () => void): void => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      done()
    }

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (inEscape) {
          if (/[A-Za-z~]/.test(ch)) inEscape = false
          continue
        }

        if (ch === '\u001b') {
          inEscape = true
          continue
        }

        if (ch === '\r' || ch === '\n') {
          out.write('\n')
          finish(() => resolve(value))
          return
        }

        if (ch === '\u0003') {
          out.write('\n')
          finish(() => {
            say('')
            say('Отменено. Ничего не создано.')
            say('')
            process.exit(130)
          })
          return
        }

        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            out.write('\b \b')
          }
          continue
        }

        if (ch < ' ') continue

        value += ch
        out.write('*')
      }
    }

    stdin.on('data', onData)
  })

// ── Разбор аргументов ────────────────────────────────────────────────────────

interface BusinessInput {
  readonly brandName: string
  readonly vertical: Vertical
  readonly slug: string
}

const parseArgs = (argv: readonly string[]): BusinessInput[] => {
  if (argv.length === 0) {
    die(
      'Не указано ни одного заведения.\n' +
        '  Пример:  pnpm setup:business "Kefir=RESTAURANT" "Siri massage=SPA"\n' +
        `  Виды: ${VERTICALS.join(', ')}`,
    )
  }

  const seen = new Set<string>()

  return argv.map((raw) => {
    const eq = raw.lastIndexOf('=')

    if (eq <= 0) {
      die(`«${raw}» — не пара «название=вид». Пример: "Kefir=RESTAURANT"`)
    }

    const brandName = raw.slice(0, eq).trim()
    const vertical = raw
      .slice(eq + 1)
      .trim()
      .toUpperCase()

    if (brandName === '') {
      die(`В «${raw}» пустое название.`)
    }

    if (!VERTICALS.includes(vertical as Vertical)) {
      die(`«${vertical}» — неизвестный вид заведения. Допустимы: ${VERTICALS.join(', ')}`)
    }

    const slug = slugify(brandName)

    if (seen.has(slug)) {
      die(`Два заведения дают одинаковый код «${slug}». Названия должны различаться.`)
    }
    seen.add(slug)

    return { brandName, vertical: vertical as Vertical, slug }
  })
}

const businesses = parseArgs(process.argv.slice(2))

// ── Подключение под владельцем ───────────────────────────────────────────────
//
// Подменяется ДО загрузки рантайма: PrismaService читает адрес при создании пула.

const ownerUrl = process.env['DATABASE_URL_OWNER']?.trim()

if (ownerUrl !== undefined && ownerUrl !== '') {
  process.env['DATABASE_URL'] = ownerUrl
}

// ── Почта и пароль владельца ───────────────────────────────────────────────

say('')
say('═══════════════════════════════════════════════════════════════')
say('  Создание заведений')
say('═══════════════════════════════════════════════════════════════')
say('')

for (const b of businesses) {
  say(`  • ${b.brandName}  (${b.vertical})`)
}

say('')
say('Владелец входит в бэк-офис по почте и паролю. Для каждого заведения')
say('своя почта: по ней вход понимает, куда пускать. Пароль скрыт звёздочками.')
say('Запиши пароль: восстановление по почте появится позже, пока новый пароль')
say('задаётся этой же командой.')
say('')

/** Собираем учётки владельца ДО создания: половинчатый ввод не должен оставить заведение. */
const creds: Array<{ email: string; password: string }> = []
const seenEmails = new Set<string>()

for (const b of businesses) {
  say(`— ${b.brandName}`)
  const email = (await askLine('  Почта владельца: ')).trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    die('Это не похоже на почту. Ничего не создано, попробуй снова.')
  }

  if (seenEmails.has(email)) {
    die('Одна почта на два заведения не годится: по ней вход не различит их.')
  }

  seenEmails.add(email)

  const password = await askHidden('  Пароль (от 8 знаков): ')

  if (password.length < 8) {
    die('Пароль короче восьми знаков. Ничего не создано, попробуй снова.')
  }

  const again = await askHidden('  Ещё раз:              ')

  if (again !== password) {
    die('Второй раз набрано другое. Ничего не создано, попробуй снова.')
  }

  creds.push({ email, password })
  say('')
}

// ── Создание ─────────────────────────────────────────────────────────────────

const runtime = await loadApiRuntime()
const { prisma } = runtime

try {
  /** Настройки программы берутся из схемы контракта: свои цифры не выдумываем. */
  const settings = parseProgramConfig({})

  const created: Array<{ brand: string; email: string }> = []

  for (const [index, business] of businesses.entries()) {
    const tenantId = business.slug
    const staffId = `${business.slug}-owner`
    const cred = creds[index] ?? die('Внутренняя ошибка: не набрана учётка для заведения.')

    const passwordHash = await runtime.hashPin(cred.password)

    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: { brandName: business.brandName, vertical: business.vertical },
      create: {
        id: tenantId,
        brandName: business.brandName,
        vertical: business.vertical,
        // ACTIVE, а не TRIAL: это собственные заведения владельца платформы,
        // и пробный период с датой окончания им не нужен.
        status: 'ACTIVE',
        settings,
      },
    })

    // Владелец входит по почте и паролю; PIN и устройство ему не нужны —
    // это ключ кассира за планшетом.
    await prisma.staff.upsert({
      where: { id: staffId },
      update: { email: cred.email, passwordHash, pinHash: null, isActive: true },
      create: {
        id: staffId,
        tenantId,
        role: 'OWNER',
        displayName: 'Владелец',
        email: cred.email,
        passwordHash,
      },
    })

    created.push({ brand: business.brandName, email: cred.email })
  }

  say('Готово. Входить так:')
  say('')

  const width = Math.max(...created.map((c) => c.brand.length))

  for (const c of created) {
    say(`  ${c.brand.padEnd(width)}   почта:  ${c.email}`)
  }

  say('')
  say('  Пароль — тот, что ты сейчас задал. На экран он не выводится.')
  say('  Никому его не показывай — он и есть ключ ко всем деньгам заведения.')
  say('')
} finally {
  await runtime.close()
}
