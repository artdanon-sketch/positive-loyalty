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

// ── PIN ──────────────────────────────────────────────────────────────────────

say('')
say('═══════════════════════════════════════════════════════════════')
say('  Создание заведений')
say('═══════════════════════════════════════════════════════════════')
say('')

for (const b of businesses) {
  say(`  • ${b.brandName}  (${b.vertical})`)
}

say('')
say('Придумай PIN для входа — от 4 до 8 цифр. Он будет один на все заведения.')
say('Запиши его: восстановить PIN нельзя, только задать новый.')
say('Вместо цифр будут звёздочки.')
say('')

const pin = await askHidden('PIN: ')

if (!/^\d{4,8}$/.test(pin)) {
  die('PIN должен состоять только из цифр, от 4 до 8 штук.')
}

const again = await askHidden('Ещё раз:  ')

if (again !== pin) {
  die('Второй раз набрано другое. Ничего не создано, попробуй снова.')
}

say('')

// ── Создание ─────────────────────────────────────────────────────────────────

const runtime = await loadApiRuntime()
const { prisma } = runtime

try {
  const pinHash = await runtime.hashPin(pin)

  /** Настройки программы берутся из схемы контракта: свои цифры не выдумываем. */
  const settings = parseProgramConfig({})

  const created: Array<{ brand: string; deviceId: string }> = []

  for (const business of businesses) {
    const tenantId = business.slug
    const staffId = `${business.slug}-owner`
    const deviceId = `owner-${business.slug}`

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

    await prisma.staff.upsert({
      where: { id: staffId },
      update: { pinHash, isActive: true },
      create: {
        id: staffId,
        tenantId,
        role: 'OWNER',
        displayName: 'Владелец',
        pinHash,
      },
    })

    await prisma.staffDevice.upsert({
      where: { deviceId },
      update: { staffId, tenantId, isActive: true, revokedAt: null },
      create: {
        tenantId,
        staffId,
        deviceId,
        label: 'Устройство владельца',
      },
    })

    created.push({ brand: business.brandName, deviceId })
  }

  say('Готово. Входить так:')
  say('')

  const width = Math.max(...created.map((c) => c.brand.length))

  for (const c of created) {
    say(`  ${c.brand.padEnd(width)}   код устройства:  ${c.deviceId}`)
  }

  say('')
  say('  PIN — тот, что ты сейчас задал. На экран он не выводится.')
  say('')
  say('  Код устройства секретом не является: без PIN он бесполезен.')
  say('  А вот PIN никому не показывай — он и есть ключ.')
  say('')
} finally {
  await runtime.close()
}
