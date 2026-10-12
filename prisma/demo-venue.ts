/**
 * Демо-заведение «POSitive Demo» — то, на котором систему показывают людям.
 *
 * Запуск: `pnpm demo:venue` из корня репозитория. Работает и на локальной базе,
 * и на боевой — смотря куда смотрит `.env`.
 *
 * ЗАЧЕМ В БОЕВОЙ. Показывать надо настоящие экраны на настоящем сервере, но
 * не на данных настоящих заведений: гости и чеки Kefir чужому человеку не
 * показывают. Поэтому рядом с ними живёт одно выдуманное кафе со своими
 * выдуманными гостями. Состав данных и правила — в `demo-venue-data.ts`.
 *
 * ЧТО ТРОГАЕТ. Только демо-заведение и гостей, заведённых этим же
 * скриптом. Если под этим id вдруг окажется заведение с другим названием —
 * скрипт остановится, ничего не записав.
 *
 * НАВСЕГДА. Операции журнала в боевой базе не удаляются (prisma/README.md,
 * «Почему LedgerEntry append-only»). Демо-кафе можно выключить, но его
 * история останется — потому оно и отдельное заведение, а не гости Kefir.
 *
 * ПОВТОРНЫЙ ЗАПУСК безопасен и полезен:
 *   • история дописывается до сегодняшнего дня — старые дни журнал вернёт
 *     повтором по ключу, новых операций за них не будет;
 *   • настройки программы, акции, новости и награды возвращаются к демо-виду —
 *     удобно после показа, где их меняли на глазах у гостя.
 *
 * ВХОД ВЛАДЕЛЬЦА. Пароля в публичном репозитории быть не должно, поэтому
 * его задаёт владелец платформы сам, в терминале, скрыто — тем же вводом,
 * что у `setup:business`:
 *   pnpm demo:venue --owner
 * Без флага скрипт ни о чём не спрашивает и вход не меняет.
 */
import { loadApiRuntime } from './api-runtime.ts'
import { formatMinorUnits, heading, out } from './console-table.ts'
import { askHidden, askLine } from './prompt.ts'
import {
  buildDemoGuests,
  buildDemoNews,
  buildDemoOffers,
  buildGuestEvents,
  DEMO_AUTOMATIONS,
  DEMO_BRAND_NAME,
  DEMO_CASHIERS,
  DEMO_CATALOG,
  DEMO_CHANNELS,
  DEMO_SALE_KINDS,
  DEMO_SETTINGS,
  DEMO_TAGS,
  DEMO_TENANT_ID,
  demoUuid,
  guestJoinedAt,
  HISTORY_DAYS,
  SHOWCASE_GUEST_INDEXES,
  venueDay,
  type DemoEvent,
  type DemoGuest,
} from './demo-venue-data.ts'

// Новое заведение заводится владельцем базы: роль приложения под RLS видит
// только своё заведение, а у нового его ещё нет (prisma/provision.ts).
// Подменяется ДО загрузки рантайма: PrismaService читает адрес при создании пула.
const ownerUrl = process.env['DATABASE_URL_OWNER']?.trim()

if (ownerUrl !== undefined && ownerUrl !== '') {
  process.env['DATABASE_URL'] = ownerUrl
}

const tenantId = DEMO_TENANT_ID

interface OwnerLogin {
  readonly email: string
  readonly password: string
}

/**
 * Почта и пароль владельца демо-кафе — до загрузки рантайма и до первой записи:
 * передумал на втором вопросе — в базе ничего не изменилось.
 */
const askOwnerLogin = async (): Promise<OwnerLogin | null> => {
  if (!process.argv.includes('--owner')) {
    return null
  }

  out(heading(`Вход владельца «${DEMO_BRAND_NAME}»`))
  out('Почта — любая своя, но не та, что у настоящих заведений: по почте вход')
  out('понимает, куда пускать. Пароль от 8 знаков, скрыт звёздочками.')
  out('')

  const email = (await askLine('  Почта: ')).trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Это не похоже на почту. Ничего не записано, попробуйте снова.')
  }

  const password = await askHidden('  Пароль (от 8 знаков): ')

  if (password.length < 8) {
    throw new Error('Пароль короче восьми знаков. Ничего не записано, попробуйте снова.')
  }

  if ((await askHidden('  Ещё раз:              ')) !== password) {
    throw new Error('Второй раз набрано другое. Ничего не записано, попробуйте снова.')
  }

  return { email, password }
}

const ownerLogin = await askOwnerLogin().catch((error: unknown): never => {
  out(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
const runtime = await loadApiRuntime()
const { prisma, ledger, rules } = runtime
const now = new Date()

interface Tally {
  created: number
  replayed: number
  reviews: number
  skipped: number
}

const tally: Tally = { created: 0, replayed: 0, reviews: 0, skipped: 0 }

/** Остаток баллов после истёкших сроков может не дотянуть до награды — это не авария. */
const isInsufficientBalance = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'INSUFFICIENT_BALANCE'

const upsertTenant = async (): Promise<number> => {
  const existing = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { brandName: true },
  })

  if (existing !== null && existing.brandName !== DEMO_BRAND_NAME) {
    throw new Error(
      `Под id «${tenantId}» живёт заведение «${existing.brandName}», а не «${DEMO_BRAND_NAME}». ` +
        'Ничего не записано: чужое заведение демо-данными не наполняем.',
    )
  }

  const settings = DEMO_SETTINGS

  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      brandName: DEMO_BRAND_NAME,
      legalName: 'POSitive Demo Café',
      vertical: 'RESTAURANT',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      locale: 'ru',
      status: 'ACTIVE',
      plan: 'PRO',
      settings,
    },
    update: { settings },
    select: { createdAt: true },
  })

  // История начинается за 90 дней до появления заведения и с тех пор не двигается:
  // повторный запуск пройдёт те же дни и допишет только новые.
  return venueDay(tenant.createdAt) - HISTORY_DAYS + 1
}

const upsertDirectories = async (firstDay: number): Promise<void> => {
  for (const cashier of DEMO_CASHIERS) {
    // PIN не трогаем: если владелец дал кассиру вход в «Команде», он остаётся.
    await prisma.staff.upsert({
      where: { id: cashier.id },
      create: { id: cashier.id, tenantId, role: 'CASHIER', displayName: cashier.displayName },
      update: { displayName: cashier.displayName, isActive: true },
    })
  }

  for (const [sortOrder, kind] of DEMO_SALE_KINDS.entries()) {
    await prisma.saleKind.upsert({
      where: { id: kind.id },
      create: { id: kind.id, tenantId, name: kind.name, sortOrder },
      update: { name: kind.name, sortOrder, isActive: true },
    })
  }

  for (const [sortOrder, item] of DEMO_CATALOG.entries()) {
    const data = {
      name: item.name,
      description: item.description,
      priceMinor: item.priceMinor,
      pointsPrice: item.pointsPrice,
      sortOrder,
      isActive: true,
    }
    await prisma.catalogItem.upsert({
      where: { id: item.id },
      create: { id: item.id, tenantId, ...data },
      update: data,
    })
  }

  for (const channel of DEMO_CHANNELS) {
    await prisma.acquisitionChannel.upsert({
      where: { id: channel.id },
      create: { id: channel.id, tenantId, name: channel.name, code: channel.code },
      update: { name: channel.name, code: channel.code, isActive: true },
    })
  }

  for (const tag of DEMO_TAGS) {
    await prisma.tag.upsert({
      where: { id: tag.id },
      create: { id: tag.id, tenantId, name: tag.name, color: tag.color },
      update: { name: tag.name, color: tag.color },
    })
  }

  for (const rule of DEMO_AUTOMATIONS) {
    const data = { enabled: rule.enabled, threshold: rule.threshold, text: rule.text }
    await prisma.automationRule.upsert({
      where: { tenantId_kind: { tenantId, kind: rule.kind } },
      create: { tenantId, kind: rule.kind, ...data },
      update: data,
    })
  }

  for (const offer of buildDemoOffers(firstDay)) {
    const data = {
      type: offer.type,
      status: offer.status,
      priority: offer.priority,
      stackable: offer.stackable,
      visibility: 'VENUE_ONLY' as const,
      audience: offer.audience,
      schedule: offer.schedule,
      limits: offer.limits,
      reward: offer.reward,
      i18n: offer.i18n,
    }
    await prisma.offer.upsert({
      where: { id: offer.id },
      create: { id: offer.id, tenantId, ...data },
      update: data,
    })
  }

  for (const news of buildDemoNews(firstDay)) {
    const data = {
      title: news.title,
      body: news.body,
      isPublished: true,
      publishedAt: news.publishedAt,
    }
    await prisma.news.upsert({
      where: { id: news.id },
      create: { id: news.id, tenantId, ...data, createdAt: news.publishedAt },
      update: data,
    })
  }
}

/**
 * Гости и их участия.
 *
 * Ветка `update` у участия пустая, как в seed: баланс, визиты и траты — производные
 * журнала, их двигает только `LedgerService`.
 */
const upsertGuests = async (
  guests: readonly DemoGuest[],
  eventsOf: ReadonlyMap<number, readonly DemoEvent[]>,
  firstDay: number,
): Promise<void> => {
  for (const guest of guests) {
    const events = eventsOf.get(guest.index) ?? []
    const joinedAt = guestJoinedAt(guest, events, firstDay, now)
    const lastSeenAt = events.at(-1)?.occurredAt ?? joinedAt

    await prisma.guest.upsert({
      where: { id: guest.guestId },
      create: {
        id: guest.guestId,
        phoneE164: guest.phoneE164,
        displayName: guest.displayName,
        locale: guest.locale,
        mode: guest.mode,
        modeLockedBy: 'auto',
        createdAt: joinedAt,
        lastSeenAt,
        birthday: guest.birthday,
      },
      update: {
        displayName: guest.displayName,
        locale: guest.locale,
        mode: guest.mode,
        lastSeenAt,
        birthday: guest.birthday,
      },
    })

    await prisma.membership.upsert({
      where: { id: guest.membershipId },
      create: {
        id: guest.membershipId,
        guestId: guest.guestId,
        tenantId,
        source: guest.source,
        channelId: guest.channelId,
        isControlGroup: guest.isControlGroup,
        createdAt: joinedAt,
      },
      update: {},
    })
  }

  // Пригласивший проставляется вторым проходом: в первом его участия может ещё не быть.
  const membershipOf = new Map(guests.map((guest) => [guest.index, guest.membershipId]))

  for (const guest of guests) {
    const referredById =
      guest.referrerIndex === null ? null : (membershipOf.get(guest.referrerIndex) ?? null)

    if (referredById !== null) {
      await prisma.membership.update({
        where: { id: guest.membershipId },
        data: { referredById },
      })
    }
  }

  await prisma.guestTag.createMany({
    data: guests.flatMap((guest) =>
      guest.tagIds.map((tagId) => ({ tenantId, membershipId: guest.membershipId, tagId })),
    ),
    skipDuplicates: true,
  })
}

/**
 * История гостя — через журнал, по одной операции, по порядку времени.
 *
 * Подписаны операции так же, как их подписывают настоящие пути: чек с кассы —
 * вебхук (`POS_WEBHOOK`, `SYSTEM`), ручной ввод в приложении кассира —
 * `STAFF_MANUAL` от имени кассира. В демо-кафе изображается работа кассы,
 * а не загрузка истории.
 */
const replayGuest = async (guest: DemoGuest, events: readonly DemoEvent[]): Promise<void> => {
  for (const event of events) {
    const origin =
      event.via === 'POS'
        ? {
            occurredAt: event.occurredAt.toISOString(),
            source: 'POS_WEBHOOK' as const,
            actorType: 'SYSTEM' as const,
          }
        : {
            occurredAt: event.occurredAt.toISOString(),
            source: 'STAFF_MANUAL' as const,
            actorType: 'STAFF' as const,
            actorId: event.cashierId,
          }

    if (event.kind === 'REDEEM') {
      try {
        const result = await ledger.redeem(
          {
            membershipId: event.membershipId,
            amount: event.amount,
            idempotencyKey: event.key,
            currency: 'THB',
            refType: event.refType,
            refId: event.refId,
            ...origin,
          },
          { tenantId },
        )
        tally[result.replayed ? 'replayed' : 'created'] += 1
      } catch (error) {
        if (!isInsufficientBalance(error)) throw error
        tally.skipped += 1
      }
      continue
    }

    const result = await ledger.earn(
      {
        membershipId: event.membershipId,
        amount: event.amount,
        idempotencyKey: event.key,
        basisAmount: event.basisAmount,
        currency: 'THB',
        saleKindId: event.saleKindId,
        refType: 'receipt',
        refId: event.receiptId,
        ...origin,
      },
      { tenantId },
    )
    tally[result.replayed ? 'replayed' : 'created'] += 1

    const review = event.review
    if (review === null) continue

    await prisma.review.upsert({
      where: { id: review.id },
      create: {
        id: review.id,
        tenantId,
        guestId: guest.guestId,
        ledgerEntryId: result.entry.id,
        staffId: event.cashierId,
        rating: review.rating,
        tags: [...review.tags],
        comment: review.comment,
        reply: review.reply,
        repliedAt: review.reply === null ? null : review.createdAt,
        autoReply: review.reply !== null,
        createdAt: review.createdAt,
      },
      update: {},
    })
    tally.reviews += 1
  }
}

/**
 * Гости — по одному. Параллельные записи в журнал одного заведения сталкиваются
 * на сериализации (проверено: при четырёх потоках `earn` исчерпывал повторы),
 * а выигрыш в минуту на скрипте, который запускают раз в неделю, того не стоит.
 */
const replayAll = async (
  guests: readonly DemoGuest[],
  eventsOf: ReadonlyMap<number, readonly DemoEvent[]>,
): Promise<void> => {
  for (const guest of guests) {
    await replayGuest(guest, eventsOf.get(guest.index) ?? [])
  }
}

/**
 * Владелец входит по почте и паролю, как у `provision.ts`: PIN и устройство
 * ему не нужны — это ключ кассира за планшетом.
 */
const upsertOwner = async (login: OwnerLogin): Promise<void> => {
  const id = demoUuid('staff:owner')
  const passwordHash = await runtime.hashPin(login.password)
  const taken = await prisma.staff.findFirst({
    where: { email: login.email, NOT: { id } },
    select: { id: true },
  })

  if (taken !== null) {
    throw new Error('Эта почта уже входит в другое заведение. Возьмите другую.')
  }

  await prisma.staff.upsert({
    where: { id },
    create: {
      id,
      tenantId,
      role: 'OWNER',
      displayName: 'Владелец',
      email: login.email,
      passwordHash,
    },
    update: { email: login.email, passwordHash, pinHash: null, isActive: true },
  })
}

const reconcile = async (guests: readonly DemoGuest[]): Promise<string[]> => {
  const drifted: string[] = []

  for (const guest of guests) {
    const report = await ledger.reconcile(guest.membershipId, { tenantId })
    if (!report.consistent) drifted.push(guest.membershipId)
  }

  return drifted
}

const printShowcase = async (guests: readonly DemoGuest[]): Promise<void> => {
  out(heading('Гости для показа на кассе — телефон вбивается вместо QR'))

  for (const index of SHOWCASE_GUEST_INDEXES) {
    const guest = guests[index]
    if (guest === undefined) continue

    const membership = await prisma.membership.findUnique({
      where: { id: guest.membershipId },
      select: { pointsBalance: true, visitsTotal: true },
    })

    out(
      `  ${guest.displayName.padEnd(12)} ${guest.phoneE164}   ` +
        `${formatMinorUnits(membership?.pointsBalance ?? 0)} баллами, визитов: ${String(membership?.visitsTotal ?? 0)}`,
    )
  }

  out(heading('Вступить в демо-кафе гостем'))
  for (const channel of DEMO_CHANNELS) {
    out(`  ${channel.name}: <адрес карты гостя>/?venue=${tenantId}&src=${channel.code}`)
  }

  const owner = await prisma.staff.findFirst({
    where: { tenantId, role: 'OWNER', isActive: true, passwordHash: { not: null } },
    select: { id: true },
  })

  out(heading('Вход владельца в бэк-офис'))
  out(
    owner === null
      ? '  Не задан. Задайте почту и пароль (скрыто):  pnpm demo:venue --owner'
      : '  Задан — почтой и паролем, которые выбрали при pnpm demo:venue --owner.',
  )
}

const run = async (): Promise<void> => {
  out(heading(`POSitive Loyalty — демо-заведение «${DEMO_BRAND_NAME}»`))
  out('Данные выдуманы: телефоны из диапазона Ofcom для вымысла, имена придуманы.')

  const firstDay = await upsertTenant()

  if (ownerLogin !== null) {
    await upsertOwner(ownerLogin)
    out('Вход владельца записан.')
  }

  await upsertDirectories(firstDay)

  const guests = buildDemoGuests()
  const eventsOf = new Map(
    guests.map((guest) => [guest.index, buildGuestEvents(guest, firstDay, now)]),
  )

  await upsertGuests(guests, eventsOf, firstDay)
  out(`Гостей: ${String(guests.length)}`)

  await replayAll(guests, eventsOf)
  out(
    `Операций в журнале: создано ${String(tally.created)}, повторов по ключу ${String(tally.replayed)}` +
      (tally.skipped === 0 ? '' : `, пропущено списаний без баллов ${String(tally.skipped)}`),
  )
  out(`Отзывов: ${String(tally.reviews)}`)

  const moved = await rules.refreshTenantTiers(tenantId, DEMO_SETTINGS)
  out(`Статусов гостей пересчитано: ${String(moved)}`)

  const drifted = await reconcile(guests)

  if (drifted.length > 0) {
    throw new Error(`Кэш баланса разошёлся с журналом у ${String(drifted.length)} гостей`)
  }

  out(`Сверка баланса с журналом: ${String(guests.length)} гостей, расхождений нет.`)

  await printShowcase(guests)
  out('\nГотово.')
}

try {
  await run()
} catch (error) {
  process.exitCode = 1
  out(`\nДемо-заведение не наполнено: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await runtime.close()
}
