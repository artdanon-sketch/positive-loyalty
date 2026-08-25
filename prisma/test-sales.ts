/**
 * Демонстрация продаж: пять чеков, повтор ключа и отмена — на живом `LedgerService`.
 *
 * Запуск: `pnpm demo:sales` из корня репозитория (перед этим `pnpm db:seed`).
 *
 * Скрипт написан не для разработчика. Его задача — показать владельцу, что продажи
 * проходят, повтор не удваивает начисление, а отмена не правит историю. Поэтому вывод
 * на русском, суммы в батах, а таблицы можно скопировать в письмо.
 *
 * Что он делает по шагам:
 *
 *   1. берёт одного гостя из демо-полигона;
 *   2. проводит пять продаж с разными суммами чека, у каждой свой ключ идемпотентности;
 *   3. делает ШЕСТОЙ вызов с ключом пятой продажи и показывает, что новой операции
 *      не возникло: вернулась первая, число записей в журнале не изменилось;
 *   4. отменяет одну продажу и показывает компенсирующую запись REVERSAL со ссылкой
 *      на исходную — исходная строка при этом не тронута;
 *   5. печатает журнал операций и сверку «кэш баланса против суммы журнала».
 *
 * Скрипт повторяем: ключи идемпотентности фиксированы, поэтому второй запуск ничего
 * не удваивает — он покажет те же операции со статусом «повтор». Это не обход
 * проблемы, а ровно то поведение, которое обещано в docs/02, раздел 0.
 *
 * Суммы в коде — целые в сатангах (железное правило 4). В баты они превращаются
 * только в момент печати.
 */
import { loadApiRuntime } from './api-runtime.ts'
import {
  formatMinorUnits,
  formatMoment,
  formatSignedMinorUnits,
  heading,
  out,
  renderTable,
  type TableColumn,
} from './console-table.ts'
import { DEMO_MEMBERSHIP_ID, DEMO_TENANT_ID, findTenant } from './demo-data.ts'

/** Версия демо. Входит в ключи: сменили сценарий — сменили ключи. */
const DEMO_VERSION = 'v1'

const CURRENCY = 'THB'

interface SaleScript {
  readonly receiptId: string
  /** Сумма чека в сатангах. 69 000 сатангов = 690,00 ฿. */
  readonly basisAmountMinor: number
  readonly comment: string
}

/** Пять чеков разного размера: от кофе до семейного ужина. */
const SALES: readonly SaleScript[] = [
  { receiptId: 'DEMO-0001', basisAmountMinor: 69_000, comment: 'обед на двоих' },
  { receiptId: 'DEMO-0002', basisAmountMinor: 125_000, comment: 'ужин с морепродуктами' },
  { receiptId: 'DEMO-0003', basisAmountMinor: 45_500, comment: 'кофе и десерт' },
  { receiptId: 'DEMO-0004', basisAmountMinor: 320_000, comment: 'банкет на компанию' },
  { receiptId: 'DEMO-0005', basisAmountMinor: 89_500, comment: 'завтрак и сок' },
]

/** Какую из продаж отменяем. Третью — чтобы отмена оказалась в середине журнала. */
const SALE_TO_REVERSE = 2

const saleKey = (receiptId: string): string => `demo:sales:${DEMO_VERSION}:${receiptId}`
const reversalKey = (receiptId: string): string => `demo:reversal:${DEMO_VERSION}:${receiptId}`

/** Короткий вид идентификатора для таблицы: полный uuid в неё не влезает. */
const shortId = (id: string): string => `#${id.slice(-6)}`

/**
 * Маскирование телефона.
 *
 * Железное правило 5 — про логи, но вывод этого скрипта показывают людям и пересылают
 * в мессенджерах, а это ровно тот же риск. Номер целиком здесь не нужен никому.
 */
const maskPhone = (phone: string): string =>
  phone.length <= 6 ? '***' : `${phone.slice(0, phone.length - 4)}****`

const TYPE_LABELS: Readonly<Record<string, string>> = {
  EARN: 'начисление',
  REDEEM: 'списание',
  EXPIRE: 'сгорание',
  ADJUST: 'корректировка',
  REVERSAL: 'компенсация',
  GRANT: 'подарок',
}

const runtime = await loadApiRuntime()
const { prisma, ledger } = runtime

const tenantSeed = findTenant(DEMO_TENANT_ID)

if (tenantSeed === undefined) {
  throw new Error('Демо-тенант отсутствует в наборе демо-данных')
}

/** Ставка начисления берётся из ProgramConfig тенанта, а не выдумывается скриптом. */
const earnRatePercent = tenantSeed.settings.baseEarnRate

/** Округление вниз — та же формула, что в seed. Разойтись они не должны. */
const pointsForReceipt = (basisAmountMinor: number): number =>
  Math.floor((basisAmountMinor * earnRatePercent) / 100)

const SALE_COLUMNS: readonly TableColumn[] = [
  { title: '№', align: 'right' },
  { title: 'Чек', align: 'left' },
  { title: 'Что купили', align: 'left' },
  { title: 'Сумма чека', align: 'right' },
  { title: 'Начислено', align: 'right' },
  { title: 'Баланс после', align: 'right' },
  { title: 'Ключ идемпотентности', align: 'left' },
  { title: 'Результат', align: 'left' },
]

const JOURNAL_COLUMNS: readonly TableColumn[] = [
  { title: '№', align: 'right' },
  { title: 'Когда', align: 'left' },
  { title: 'Операция', align: 'left' },
  { title: 'Изменение баллов', align: 'right' },
  { title: 'Баланс после', align: 'right' },
  { title: 'Сумма чека', align: 'right' },
  { title: 'Чек', align: 'left' },
  { title: 'Ключ идемпотентности', align: 'left' },
  { title: 'Отменяет', align: 'left' },
]

const loadMembership = async () => {
  const membership = await prisma.membership.findFirst({
    where: { id: DEMO_MEMBERSHIP_ID, tenantId: DEMO_TENANT_ID },
    include: { guest: true, tenant: true },
  })

  if (membership === null) {
    throw new Error(
      'Демо-участие не найдено. Похоже, полигон ещё не наполнен: ' +
        'выполните «pnpm db:seed» и повторите запуск.',
    )
  }

  return membership
}

const printJournal = async (): Promise<void> => {
  const entries = await prisma.ledgerEntry.findMany({
    where: { membershipId: DEMO_MEMBERSHIP_ID, tenantId: DEMO_TENANT_ID },
    orderBy: { createdAt: 'asc' },
  })

  const rows = entries.map((entry, index) => [
    String(index + 1),
    formatMoment(entry.createdAt),
    TYPE_LABELS[entry.type] ?? entry.type,
    formatSignedMinorUnits(entry.amount),
    formatMinorUnits(entry.balanceAfter),
    entry.basisAmount === null ? '—' : formatMinorUnits(entry.basisAmount),
    entry.refId ?? '—',
    entry.idempotencyKey,
    entry.reversalOfId === null ? '—' : shortId(entry.reversalOfId),
  ])

  out(heading('Журнал операций гостя'))
  out(renderTable(JOURNAL_COLUMNS, rows))
  out(
    '\nЖурнал только пополняется. Отмена — отдельная строка «компенсация» со ссылкой ' +
      'на отменяемую операцию;\nисходная строка остаётся нетронутой, потому что UPDATE ' +
      'и DELETE на журнале запрещены самой базой.',
  )
}

const demo = async (): Promise<void> => {
  const membership = await loadMembership()
  const scope = { tenantId: membership.tenantId }

  out(heading('POSitive Loyalty — демонстрация продаж'))
  out(`Заведение:   ${membership.tenant.brandName}`)
  out(`Гость:       ${membership.guest.displayName ?? 'без имени'}`)
  out(`Телефон:     ${maskPhone(membership.guest.phoneE164)}`)
  out(`Ставка:      ${earnRatePercent}% от чека баллами`)
  out(`Баланс до:   ${formatMinorUnits(membership.pointsBalance)}`)

  // ── Шаг 1. Пять продаж ────────────────────────────────────────────────────
  const saleRows: string[][] = []
  const entryIds: string[] = []

  for (const [index, sale] of SALES.entries()) {
    const result = await ledger.earn(
      {
        membershipId: membership.id,
        amount: pointsForReceipt(sale.basisAmountMinor),
        idempotencyKey: saleKey(sale.receiptId),
        basisAmount: sale.basisAmountMinor,
        currency: CURRENCY,
        refType: 'receipt',
        refId: sale.receiptId,
        source: 'POS_WEBHOOK',
        actorType: 'SYSTEM',
      },
      scope,
    )

    entryIds.push(result.entry.id)

    saleRows.push([
      String(index + 1),
      sale.receiptId,
      sale.comment,
      formatMinorUnits(sale.basisAmountMinor),
      formatSignedMinorUnits(result.entry.amount),
      formatMinorUnits(result.entry.balanceAfter),
      result.entry.idempotencyKey,
      result.replayed ? 'повтор, операция уже была' : 'новая операция',
    ])
  }

  out(heading('Шаг 1. Пять продаж'))
  out(renderTable(SALE_COLUMNS, saleRows))

  // ── Шаг 2. Повтор ключа последней продажи ─────────────────────────────────
  const lastSale = SALES.at(-1)
  const lastEntryId = entryIds.at(-1)

  if (lastSale === undefined || lastEntryId === undefined) {
    throw new Error('Список продаж пуст — демонстрировать нечего')
  }

  const countBefore = await prisma.ledgerEntry.count({
    where: { membershipId: membership.id, tenantId: membership.tenantId },
  })

  const repeat = await ledger.earn(
    {
      membershipId: membership.id,
      amount: pointsForReceipt(lastSale.basisAmountMinor),
      idempotencyKey: saleKey(lastSale.receiptId),
      basisAmount: lastSale.basisAmountMinor,
      currency: CURRENCY,
      refType: 'receipt',
      refId: lastSale.receiptId,
      source: 'POS_WEBHOOK',
      actorType: 'SYSTEM',
    },
    scope,
  )

  const countAfter = await prisma.ledgerEntry.count({
    where: { membershipId: membership.id, tenantId: membership.tenantId },
  })

  out(heading('Шаг 2. Шестой вызов — тот же ключ, что у пятой продажи'))
  out('Так ведёт себя касса, у которой пропал интернет и она отправила чек повторно.')
  out('')
  out(`Ключ:                         ${repeat.entry.idempotencyKey}`)
  out(`Записей в журнале до вызова:  ${countBefore}`)
  out(`Записей в журнале после:      ${countAfter}`)
  out(`Вернулась операция:           ${shortId(repeat.entry.id)}`)
  out(`Это та же операция, что №5:   ${repeat.entry.id === lastEntryId ? 'да' : 'НЕТ'}`)
  out(`Признак повтора (replayed):   ${repeat.replayed ? 'да' : 'НЕТ'}`)
  out(`Баланс не изменился:          ${formatMinorUnits(repeat.entry.balanceAfter)}`)

  if (countAfter !== countBefore || !repeat.replayed || repeat.entry.id !== lastEntryId) {
    throw new Error('Идемпотентность нарушена: повтор ключа создал новую операцию')
  }

  out('\nВторой операции не возникло. Гость получил баллы один раз.')

  // ── Шаг 3. Отмена одной продажи ───────────────────────────────────────────
  const reversedSale = SALES[SALE_TO_REVERSE]
  const reversedEntryId = entryIds[SALE_TO_REVERSE]

  if (reversedSale === undefined || reversedEntryId === undefined) {
    throw new Error('Продажа для отмены не найдена')
  }

  const reversal = await ledger.reverse(
    {
      entryId: reversedEntryId,
      idempotencyKey: reversalKey(reversedSale.receiptId),
      reason: 'REFUND',
      comment: 'Возврат по чеку: гость вернул десерт',
      source: 'STAFF_MANUAL',
      actorType: 'OWNER',
    },
    scope,
  )

  out(heading('Шаг 3. Отмена третьей продажи'))
  out(
    `Отменяем чек ${reversedSale.receiptId} на ${formatMinorUnits(reversedSale.basisAmountMinor)}.`,
  )
  out('')
  out(`Компенсирующая запись:        ${shortId(reversal.entry.id)}`)
  out(`Тип записи:                   ${TYPE_LABELS[reversal.entry.type] ?? reversal.entry.type}`)
  out(`Ссылается на операцию:        ${shortId(reversal.entry.reversalOfId ?? '')}`)
  out(`Изменение баллов:             ${formatSignedMinorUnits(reversal.entry.amount)}`)
  out(`Баланс после отмены:          ${formatMinorUnits(reversal.entry.balanceAfter)}`)
  out(`Признак повтора (replayed):   ${reversal.replayed ? 'да' : 'нет'}`)
  out('\nИсходная запись не изменилась — отмена добавлена отдельной строкой.')

  // ── Шаг 4. Журнал целиком ─────────────────────────────────────────────────
  await printJournal()

  // ── Шаг 5. Сверка кэша с журналом ─────────────────────────────────────────
  const report = await ledger.reconcile(membership.id, scope)

  out(heading('Сверка: кэш баланса против суммы журнала'))
  out(`Кэш Membership.pointsBalance: ${formatMinorUnits(report.cachedBalance)}`)
  out(`Сумма журнала SUM(amount):    ${formatMinorUnits(report.ledgerSum)}`)
  out(`Записей в журнале:            ${report.entryCount}`)
  out(`Расхождение:                  ${formatMinorUnits(report.drift)}`)
  out(`Итог:                         ${report.consistent ? 'сходится' : 'РАСХОЖДЕНИЕ'}`)

  if (!report.consistent) {
    throw new Error('Кэш баланса разошёлся с журналом — это инцидент, а не погрешность')
  }

  out(
    '\nБаллы показаны в батах: в режиме CASHBACK один балл равен одному сатангу.\n' +
      'Хранятся и считаются они целыми числами в минорных единицах — без дробей ' +
      'и без округлений по дороге.',
  )
}

try {
  await demo()
} catch (error) {
  process.exitCode = 1
  out(`\nДемонстрация прервана: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await runtime.close()
}
