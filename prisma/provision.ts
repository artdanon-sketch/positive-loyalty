import { randomUUID } from 'node:crypto'

import { parseProgramConfig } from '@positive/contracts'

import { loadApiRuntime } from './api-runtime.ts'
import { askHidden, askLine } from './prompt.ts'

/**
 * Заводит боевое заведение: само заведение и вход его владельца по почте.
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
 *
 * ИДЕНТИФИКАТОРЫ — UUID. Раньше заведение получало id из названия («kefir»),
 * а владелец — «kefir-owner». Остальная система считает оба UUID: гость такого
 * заведения не мог вступить в программу, журнал отказывал в начислении
 * (миграция 20261012120000_tenant_ids_to_uuid перевела уже заведённые).
 * Повторный запуск находит заведение по названию, без учёта регистра.
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

// ── Разбор аргументов ────────────────────────────────────────────────────────

interface BusinessInput {
  readonly brandName: string
  readonly vertical: Vertical
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

    const key = brandName.toLowerCase()

    if (seen.has(key)) {
      die(`«${brandName}» указано дважды. Названия должны различаться.`)
    }
    seen.add(key)

    return { brandName, vertical: vertical as Vertical }
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
    const cred = creds[index] ?? die('Внутренняя ошибка: не набрана учётка для заведения.')

    // Уже заведённое находим по названию: id у него теперь UUID, а не слово.
    const same = await prisma.tenant.findMany({
      where: { brandName: { equals: business.brandName, mode: 'insensitive' } },
      select: { id: true },
    })

    if (same.length > 1) {
      die(`Заведений с названием «${business.brandName}» несколько — какое менять, не понять.`)
    }

    const tenantId = same[0]?.id ?? randomUUID()

    const owner = await prisma.staff.findFirst({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    const staffId = owner?.id ?? randomUUID()

    const taken = await prisma.staff.findFirst({
      where: { email: cred.email, NOT: { id: staffId } },
      select: { id: true },
    })

    if (taken !== null) {
      die(`Почта ${cred.email} уже входит в другое заведение. Ничего не изменено.`)
    }

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
