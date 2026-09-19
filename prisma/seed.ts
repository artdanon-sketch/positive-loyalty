/**
 * Демо-полигон: наполнение локальной базы данными, на которых можно работать
 * и снимать скриншоты, не трогая ничего настоящего.
 *
 * Запуск: `pnpm db:seed` из корня репозитория.
 *
 * ─── ЧТО ЗДЕСЬ ЕСТЬ ──────────────────────────────────────────────────────────
 *
 *   • три тенанта из CLAUDE.md: ресторан Kata Beach Kitchen, спа Sabai Thai Massage,
 *     прокат Phuket Ride — с настоящим ProgramConfig (docs/01, раздел 4.3);
 *   • по 4 сотрудника на тенанта (CLAUDE.md): владелец, менеджер, два кассира —
 *     с PIN'ами и зарегистрированными устройствами, коды печатаются ниже;
 *   • 40 гостей в пропорции 60% туристы / 40% резиденты;
 *   • участия: каждый гость минимум в одной программе, каждый четвёртый — в двух;
 *   • контрольная группа: ровно 5% участий с `isControlGroup = true`;
 *   • короткая история покупок, проведённая через `LedgerService`.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ ─────────────────────────────────────────────────
 *
 * CLAUDE.md описывает полигон целиком: 200 гостей, по 4 сотрудника на тенанта,
 * 90 дней истории с сезонностью и провалом 14–17 числа, по 4 акции на тенанта,
 * один тенант с намеренно подозрительной активностью кассира. Большая часть этого
 * опирается на модели, которых в Задаче 2 ещё нет, и выдумывать их здесь нельзя —
 * seed обязан соответствовать схеме, а не опережать её.
 *
 *   ОТЛОЖЕНО              ПОЧЕМУ
 *   Location              модели нет в schema.prisma
 *   Offer, акции          нет модели Offer и нет движка правил
 *   Подозрительный        схема антифрода живёт в Staff, Device и AuditLog —
 *   кассир                без них «подозрительность» показывать не на чем
 *   GuestChannel,         моделей нет; каналы связи приедут с identity-модулем
 *   Consent, Device
 *   200 гостей            объём сознательно снижен до 40: полигон должен расти
 *                         вместе со схемой, а не ждать её в раздутом виде
 *   90 дней истории       `LedgerService` не принимает `createdAt`, и это правильно:
 *                         журнал задним числом не пишут. Записать даты в обход
 *                         сервиса — прямое нарушение железного правила 1, поэтому
 *                         история короткая и датирована моментом запуска
 *
 * ─── ЖЕЛЕЗНЫЕ ПРАВИЛА В ЭТОМ ФАЙЛЕ ───────────────────────────────────────────
 *
 * Правило 1 (баллы только через ledger) соблюдается буквально: во всём файле нет ни
 * одного обращения к `pointsBalance`. Начисления идут через `ledger.earn`, а `upsert`
 * участия не трогает кэш баланса даже в ветке обновления.
 *
 * Правило 3 (идемпотентность): ключи начислений детерминированы и зависят только от
 * участия и номера визита. Поэтому повторный `pnpm db:seed` не удваивает журнал —
 * `LedgerService` возвращает первые записи с `replayed = true`. Это не побочный
 * эффект, а способ проверки: во второй прогон число созданных операций обязано быть
 * нулём. Скрипт печатает обе цифры.
 *
 * Правило 4 (целые минорные единицы): суммы чеков в сатангах, в баты они
 * превращаются только в выводе.
 */
import { loadApiRuntime } from './api-runtime.ts'
import { formatMinorUnits, heading, out, renderTable, type TableColumn } from './console-table.ts'
import {
  AUTOMATIONS,
  buildGuests,
  buildMemberships,
  buildVisits,
  CATALOG_ITEMS,
  SALE_KINDS,
  SEED_VERSION,
  STAFF,
  TENANTS,
  type AutomationSeed,
  type CatalogItemSeed,
  type GuestSeed,
  type MembershipSeed,
  type SaleKindSeed,
  type TenantSeed,
  type VisitSeed,
} from './demo-data.ts'

/** Валюта полигона. Пхукет — Таиланд, минорная единица — сатанг. */
const CURRENCY = 'THB'

const TIMEZONE = 'Asia/Bangkok'

const runtime = await loadApiRuntime()
const { prisma, ledger } = runtime

/** Счётчики прогона: что создано, что вернулось повтором. */
interface LedgerTally {
  created: number
  replayed: number
  points: number
  revenue: number
}

const upsertTenants = async (tenants: readonly TenantSeed[]): Promise<void> => {
  for (const tenant of tenants) {
    await prisma.tenant.upsert({
      where: { id: tenant.id },
      create: {
        id: tenant.id,
        brandName: tenant.brandName,
        legalName: tenant.legalName,
        vertical: tenant.vertical,
        currency: CURRENCY,
        timezone: TIMEZONE,
        locale: tenant.locale,
        status: tenant.status,
        plan: tenant.plan,
        seasonMode: tenant.seasonMode,
        settings: tenant.settings,
      },
      update: {
        brandName: tenant.brandName,
        legalName: tenant.legalName,
        vertical: tenant.vertical,
        locale: tenant.locale,
        status: tenant.status,
        plan: tenant.plan,
        seasonMode: tenant.seasonMode,
        settings: tenant.settings,
      },
    })
  }
}

/**
 * Справочник видов продаж.
 *
 * Upsert по id, а не создание: seed должен быть перезапускаемым, а два
 * одноимённых вида в одном заведении база и так не пустит.
 */
const upsertSaleKinds = async (kinds: readonly SaleKindSeed[]): Promise<void> => {
  for (const kind of kinds) {
    await prisma.saleKind.upsert({
      where: { id: kind.id },
      create: {
        id: kind.id,
        tenantId: kind.tenantId,
        name: kind.name,
        sortOrder: kind.sortOrder,
      },
      update: { name: kind.name, sortOrder: kind.sortOrder },
    })
  }
}

/**
 * Связь каждого заведения с его же заведением в кассе.
 *
 * Ключ подписи ВЫВОДИТСЯ из идентификатора заведения, а не записан строкой.
 * Причина простая: строковый секрет в репозитории — это секрет в репозитории,
 * даже когда он «ненастоящий». Через месяц его скопируют в боевую настройку,
 * потому что он «уже был». Выведенное значение скопировать некуда.
 *
 * Ценность связи для демо: по ней можно послать вебхук на локальный API
 * и увидеть, как чек из кассы начисляет баллы сам. Команда — в README.
 */
const demoWebhookSecret = (tenantId: string): string => `whsec-local-demo-${tenantId.slice(-12)}`

const upsertPosLinks = async (tenants: readonly TenantSeed[]): Promise<void> => {
  for (const tenant of tenants) {
    const posMerchantId = `pm-demo-${tenant.id.slice(-8)}`

    await prisma.posLink.upsert({
      where: { posMerchantId },
      create: {
        tenantId: tenant.id,
        posMerchantId,
        webhookSecret: demoWebhookSecret(tenant.id),
        // Адрес обратного вызова берём из окружения: у демо-кассы его нет,
        // и без адреса исходящие просто не создаются. Задать его локально —
        // способ увидеть, как касса узнаёт об изменении баланса.
        callbackUrl: process.env['DEMO_POS_CALLBACK_URL'] ?? null,
      },
      // Ключ переписываем: он выводится из идентификатора и меняться не должен,
      // но если формула изменилась, seed обязан привести базу к новой.
      update: {
        webhookSecret: demoWebhookSecret(tenant.id),
        callbackUrl: process.env['DEMO_POS_CALLBACK_URL'] ?? null,
        isActive: true,
        revokedAt: null,
        // Момент подключения двигаем на СЕЙЧАС при каждом пересеве.
        //
        // Исходящие события не отправляются про операции старше подключения.
        // Оставь мы здесь прежнюю дату — повторный seed заново выгрузил бы
        // кассе всю историю, накопленную с прошлого раза.
        linkedAt: new Date(),
      },
    })
  }
}

const upsertGuests = async (guests: readonly GuestSeed[]): Promise<void> => {
  for (const guest of guests) {
    await prisma.guest.upsert({
      where: { id: guest.id },
      create: {
        id: guest.id,
        phoneE164: guest.phoneE164,
        displayName: guest.displayName,
        locale: guest.locale,
        mode: guest.mode,
        modeLockedBy: 'auto',
        createdAt: guest.createdAt,
        lastSeenAt: guest.lastSeenAt,
      },
      // createdAt не обновляем: дата появления гостя в системе не переписывается
      // повторным прогоном seed.
      update: {
        displayName: guest.displayName,
        locale: guest.locale,
        mode: guest.mode,
        lastSeenAt: guest.lastSeenAt,
      },
    })
  }
}

/**
 * Участия.
 *
 * Ветка `update` пустая, и это осознанно. `pointsBalance`, `visitsTotal`, `spentTotal`,
 * `firstVisitAt` и `lastVisitAt` — производные от журнала, их двигает только
 * `LedgerService`. Обновлять их отсюда нельзя, а обновлять «всё остальное» — значит
 * однажды дописать в этот объект лишнюю строку и нарушить железное правило 1.
 * Состав участия задаётся при создании и дальше живёт своей жизнью.
 */
const upsertMemberships = async (memberships: readonly MembershipSeed[]): Promise<void> => {
  for (const membership of memberships) {
    await prisma.membership.upsert({
      where: { id: membership.id },
      create: {
        id: membership.id,
        guestId: membership.guestId,
        tenantId: membership.tenantId,
        source: membership.source,
        isControlGroup: membership.isControlGroup,
      },
      update: {},
    })
  }
}

/**
 * История покупок — единственное место в seed, где меняются баллы.
 *
 * `source: 'POS_SYNC'` честно говорит, откуда операция: это не живой вебхук кассы и не
 * подписанный QR, а загрузка истории. Антифрод обязан отличать их друг от друга
 * (docs/05, раздел 6), и подписывать демо-данные как `SIGNED_QR` было бы враньём
 * в собственной базе.
 */
const replayVisits = async (visits: readonly VisitSeed[]): Promise<LedgerTally> => {
  const tally: LedgerTally = { created: 0, replayed: 0, points: 0, revenue: 0 }

  for (const visit of visits) {
    const result = await ledger.earn(
      {
        membershipId: visit.membershipId,
        amount: visit.pointsAmount,
        idempotencyKey: visit.idempotencyKey,
        basisAmount: visit.basisAmountMinor,
        currency: CURRENCY,
        refType: 'receipt',
        refId: visit.receiptId,
        // Время СОБЫТИЯ. Без него вся история легла бы моментом запуска seed,
        // и график «Гости по дням» превратился бы в один столбец.
        occurredAt: visit.occurredAt.toISOString(),
        source: 'POS_SYNC',
        actorType: 'SYSTEM',
      },
      // tenantId приходит отдельным аргументом, а не в теле (железное правило 2).
      // В сервере его подставит TenantContext из JWT; здесь — сам seed, который
      // по определению знает, чьи данные создаёт.
      { tenantId: visit.tenantId },
    )

    if (result.replayed) {
      tally.replayed += 1
    } else {
      tally.created += 1
    }

    tally.points += result.entry.amount
    tally.revenue += result.entry.basisAmount ?? 0
  }

  return tally
}

/**
 * Сверка кэша баланса с журналом по всем участиям.
 *
 * docs/05, раздел 5, правило 5. Для seed это дешёвая страховка: если полигон
 * разъехался сразу после наполнения, чинить надо не отчёты, а ledger.
 */
const reconcileAll = async (
  memberships: readonly MembershipSeed[],
): Promise<{ checked: number; drifted: string[] }> => {
  const drifted: string[] = []

  for (const membership of memberships) {
    const report = await ledger.reconcile(membership.id, { tenantId: membership.tenantId })

    if (!report.consistent) {
      drifted.push(membership.id)
    }
  }

  return { checked: memberships.length, drifted }
}

const TENANT_COLUMNS: readonly TableColumn[] = [
  { title: 'Тенант', align: 'left' },
  { title: 'Вертикаль', align: 'left' },
  { title: 'Гостей', align: 'right' },
  { title: 'Участий', align: 'right' },
  { title: 'Контрольная группа', align: 'right' },
  { title: 'Визитов', align: 'right' },
  { title: 'Оборот', align: 'right' },
  { title: 'Начислено', align: 'right' },
]

const VERTICAL_LABELS: Readonly<Record<TenantSeed['vertical'], string>> = {
  RESTAURANT: 'ресторан',
  SPA: 'спа',
  RENTAL: 'прокат',
}

const renderTenantSummary = (
  memberships: readonly MembershipSeed[],
  visits: readonly VisitSeed[],
): string => {
  const rows = TENANTS.map((tenant) => {
    const own = memberships.filter((membership) => membership.tenantId === tenant.id)
    const ownVisits = visits.filter((visit) => visit.tenantId === tenant.id)
    const guests = new Set(own.map((membership) => membership.guestId))

    const revenue = ownVisits.reduce((sum, visit) => sum + visit.basisAmountMinor, 0)
    const points = ownVisits.reduce((sum, visit) => sum + visit.pointsAmount, 0)

    return [
      tenant.brandName,
      VERTICAL_LABELS[tenant.vertical],
      String(guests.size),
      String(own.length),
      String(own.filter((membership) => membership.isControlGroup).length),
      String(ownVisits.length),
      formatMinorUnits(revenue),
      formatMinorUnits(points),
    ]
  })

  return renderTable(TENANT_COLUMNS, rows)
}

/**
 * Сотрудники и их устройства.
 *
 * PIN хешируется тем же scrypt из apps/api/dist, которым API проверяет вход, —
 * второй реализации хеширования в репозитории быть не должно. Хеш пересчитывается
 * на каждом запуске (соль случайная), сам PIN при этом одинаков от запуска к запуску.
 */
const upsertStaff = async (): Promise<void> => {
  for (const member of STAFF) {
    const pinHash = await runtime.hashPin(member.pin)
    // Пароль хешируется тем же scrypt, что и PIN: staffEmailLogin проверяет его
    // через verifyPin. Кассиру пароль не заводим — у него нет почты.
    const passwordHash = member.password === null ? null : await runtime.hashPin(member.password)

    await runtime.prisma.staff.upsert({
      where: { id: member.id },
      create: {
        id: member.id,
        tenantId: member.tenantId,
        role: member.role,
        displayName: member.displayName,
        pinHash,
        email: member.email,
        passwordHash,
      },
      update: {
        role: member.role,
        displayName: member.displayName,
        pinHash,
        email: member.email,
        passwordHash,
        isActive: true,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    })

    await runtime.prisma.staffDevice.upsert({
      where: { deviceId: member.deviceId },
      create: {
        tenantId: member.tenantId,
        staffId: member.id,
        deviceId: member.deviceId,
        label: member.deviceLabel,
      },
      update: { staffId: member.id, label: member.deviceLabel, isActive: true, revokedAt: null },
    })
  }
}

const STAFF_COLUMNS: readonly TableColumn[] = [
  { title: 'Заведение', align: 'left' },
  { title: 'Роль', align: 'left' },
  { title: 'Вход (почта / устройство)', align: 'left' },
  { title: 'Пароль / PIN', align: 'left' },
]

const ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: 'владелец',
  MANAGER: 'менеджер',
  CASHIER: 'кассир',
}

const renderStaffLogins = (): string => {
  const brandById = new Map(TENANTS.map((tenant) => [tenant.id, tenant.brandName]))

  // Владелец и менеджер входят по почте и паролю, кассир — по устройству и PIN.
  // В одной колонке показываем то, чем человек действительно входит.
  const rows = STAFF.map((member) => [
    brandById.get(member.tenantId) ?? member.tenantId,
    ROLE_LABELS[member.role] ?? member.role,
    member.email ?? member.deviceId,
    member.password ?? member.pin,
  ])

  return renderTable(STAFF_COLUMNS, rows)
}

/**
 * Витрина «что взять за баллы».
 *
 * Upsert по id: seed перезапускаемый, а поменянная цена должна доезжать
 * до полигона, а не оставаться от прошлого запуска.
 */
const upsertCatalog = async (items: readonly CatalogItemSeed[]): Promise<void> => {
  for (const item of items) {
    await prisma.catalogItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        tenantId: item.tenantId,
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        pointsPrice: item.pointsPrice,
        sortOrder: item.sortOrder,
      },
      update: {
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        pointsPrice: item.pointsPrice,
        sortOrder: item.sortOrder,
      },
    })
  }
}

/** Автосценарии рассылок: у каждого заведения свой набор. */
const upsertAutomations = async (rules: readonly AutomationSeed[]): Promise<void> => {
  for (const rule of rules) {
    await prisma.automationRule.upsert({
      where: { tenantId_kind: { tenantId: rule.tenantId, kind: rule.kind } },
      create: {
        tenantId: rule.tenantId,
        kind: rule.kind,
        enabled: rule.enabled,
        threshold: rule.threshold,
        text: rule.text,
      },
      update: { enabled: rule.enabled, threshold: rule.threshold, text: rule.text },
    })
  }
}

const seed = async (): Promise<void> => {
  const guests = buildGuests()
  const memberships = buildMemberships(guests)
  const visits = buildVisits(memberships, guests)

  out(heading(`POSitive Loyalty — наполнение демо-полигона (набор ${SEED_VERSION})`))
  out('Данные синтетические: телефоны из свободного диапазона, имена придуманы.')

  await upsertTenants(TENANTS)
  out(`\nТенантов записано: ${TENANTS.length}`)

  await upsertGuests(guests)
  out(`Гостей записано: ${guests.length}`)

  await upsertMemberships(memberships)
  out(`Участий записано: ${memberships.length}`)

  await upsertSaleKinds(SALE_KINDS)
  out(`Видов продаж записано: ${SALE_KINDS.length}`)

  await upsertCatalog(CATALOG_ITEMS)
  out(`Позиций в витринах: ${CATALOG_ITEMS.length}`)

  await upsertAutomations(AUTOMATIONS)
  out(`Автосценариев записано: ${AUTOMATIONS.length}`)

  await upsertStaff()
  out(`Сотрудников записано: ${STAFF.length}, устройств: ${STAFF.length}`)

  const tally = await replayVisits(visits)
  out(
    `Операций в журнале: создано ${tally.created}, ` +
      `повторов по ключу идемпотентности ${tally.replayed}`,
  )

  // Связь с кассой заводится ПОСЛЕ истории — так же, как в жизни: кассу
  // подключают к работающему заведению. Порядок здесь не косметика: исходящие
  // события не отправляются про операции старше подключения, и заведи мы связь
  // раньше, демо-касса получила бы всю историю разом — ровно это и случилось
  // на первом живом прогоне.
  await upsertPosLinks(TENANTS)

  out(heading('Полигон по тенантам'))
  out(renderTenantSummary(memberships, visits))
  out(
    `\nИтого оборот ${formatMinorUnits(tally.revenue)}, ` +
      `начислено ${formatMinorUnits(tally.points)}.`,
  )
  out('Баллы показаны в батах: в режиме CASHBACK один балл равен одному сатангу.')

  const { checked, drifted } = await reconcileAll(memberships)

  out(heading('Сверка кэша баланса с журналом'))

  if (drifted.length === 0) {
    out(`Проверено участий: ${checked}. Расхождений нет — кэш сходится с журналом.`)
  } else {
    out(`Проверено участий: ${checked}. РАСХОЖДЕНИЙ: ${drifted.length}.`)
    out(`Участия с расхождением: ${drifted.join(', ')}`)
    throw new Error('Кэш баланса разошёлся с журналом сразу после наполнения полигона')
  }

  out(heading('Входы для демо: бэк-офис и касса'))
  out('Бэк-офис — менеджер или владелец; касса — кассир. Вход: код устройства + PIN.')
  out(renderStaffLogins())

  out('\nГотово. Демонстрация продаж: pnpm demo:sales')
}

try {
  await seed()
} catch (error) {
  process.exitCode = 1
  out(`\nSeed не выполнен: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await runtime.close()
}
