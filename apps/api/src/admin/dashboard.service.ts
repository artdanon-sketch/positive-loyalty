import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminDashboard,
  DashboardAdvice,
  DashboardDay,
  DashboardHour,
  DashboardIncremental,
  DashboardPeriod,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'

/**
 * Дашборд заведения. docs/02, раздел 5.1 · docs/03, раздел 2.
 *
 * ПОЧЕМУ ЗДЕСЬ СЫРОЙ SQL, А НЕ ЗАПРОСЫ PRISMA. Дашборд — единственное место
 * в бэк-офисе, где нужны агрегаты по журналу: считать их значит либо звать
 * базу десяток раз, либо вытянуть весь журнал в память и группировать в JS.
 * У заведения за 90 дней это десятки тысяч строк ради шести чисел. Группировка
 * по дню и часу с переводом в местное время в SQL — одна строка плана запроса
 * вместо мегабайта трафика.
 *
 * Рубеж 1 при этом на месте: `tenantId` подставляется параметром в КАЖДЫЙ
 * запрос, ровно как явный фильтр в остальных методах бэк-офиса. Рубеж 2 (RLS)
 * работает и для сырых запросов — они идут внутри `forTenant`, где выставлена
 * `app.tenant_id`. Забыть обёртку не страшно: роль приложения без неё не видит
 * ни строки, и дашборд обнулится вместо утечки.
 *
 * ВРЕМЯ ВЕЗДЕ МЕСТНОЕ. «С 14 до 17 зал пустой» — это два часа дня по Пхукету,
 * а не по UTC. Все границы суток и часы считаются в `Tenant.timezone`.
 *
 * Отсюда двойной `AT TIME ZONE 'UTC' AT TIME ZONE ${zone}` во всех запросах,
 * и это не суеверие. Prisma объявляет `DateTime` как `timestamp(3)` БЕЗ зоны
 * и кладёт туда UTC. Одиночный `AT TIME ZONE ${zone}` над такой колонкой
 * делает обратное тому, что нужно: трактует хранимое значение как местное
 * время и переводит его в момент времени. Дальше сравнение `timestamp`
 * с `timestamptz` доигрывается по сессионной зоне соединения — и результат
 * начинает зависеть от настройки сервера, а не от заведения.
 *
 * Первый `AT TIME ZONE 'UTC'` объявляет: в колонке лежит UTC. Второй переводит
 * этот момент в часы заведения. Ошибка стоила ровно суток сдвига: визиты
 * сегодняшнего дня попадали во вчерашний столбец графика.
 *
 * `now()` дополнительного объявления не требует: он и так `timestamptz`.
 */

/** Длина периода в днях. Ключи — значения `DashboardPeriod`. */
const PERIOD_DAYS: Record<DashboardPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** Гость считается спящим, если не заходил больше месяца (docs/03, раздел 2). */
const SLEEPING_AFTER_DAYS = 30

/** Порог совета про спящих: меньше двадцати — не повод дёргать владельца. */
const SLEEPING_ADVICE_FROM = 20

/** Порог совета про ручной ввод, доля в процентах. */
const MANUAL_ENTRY_ADVICE_FROM = 40

/**
 * Минимальный размер контрольной группы для показа инкрементальности.
 * Требование ТЗ (docs/02, раздел 5.1): меньше — статистики нет.
 */
const INCREMENTAL_MIN_CONTROL = 30

/** Провалом считается час, где гостей меньше этой доли от среднего по дню. */
const QUIET_HOUR_SHARE = 0.5

/** Совет про тихие часы выдаём только для провала в три часа и длиннее. */
const QUIET_HOURS_MIN_RUN = 3

/** Постгрес отдаёт count/sum как bigint — Prisma превращает их в BigInt. */
const toNumber = (value: unknown): number =>
  typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : 0

interface SummaryRow {
  guestsNow: unknown
  guestsPrev: unknown
  newGuests: unknown
  everGuests: unknown
  liabilityNow: unknown
  liabilityDelta: unknown
  sleeping: unknown
  manualEarns: unknown
  totalEarns: unknown
}

interface SeriesRow {
  date: string
  newGuests: unknown
  returningGuests: unknown
}

interface HourRow {
  hour: unknown
  guests: unknown
}

interface IncrementalRow {
  programAvg: unknown
  controlAvg: unknown
  controlSize: unknown
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(period: DashboardPeriod): Promise<AdminDashboard> {
    const { tenantId } = TenantContext.getOrThrow()
    const days = PERIOD_DAYS[period]

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true, createdAt: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    const zone = tenant.timezone

    const [summary, series, hourly, incremental] = await Promise.all([
      this.loadSummary(tenantId, zone, days),
      this.loadSeries(tenantId, zone, days),
      this.loadHourly(tenantId, zone, days),
      this.loadIncremental(tenantId, zone, days),
    ])

    const guestsNow = toNumber(summary.guestsNow)
    const guestsPrev = toNumber(summary.guestsPrev)
    const liabilityNow = toNumber(summary.liabilityNow)
    const totalEarns = toNumber(summary.totalEarns)
    const manualShare = totalEarns === 0 ? 0 : (toNumber(summary.manualEarns) / totalEarns) * 100

    // Заведение моложе периода: дельту показывать не с чем, и график
    // подписывается «данных пока мало» (docs/03, раздел 2).
    const ageMs = Date.now() - tenant.createdAt.getTime()
    const isPartialPeriod = ageMs < days * 24 * 60 * 60 * 1000

    return {
      period,
      guestsViaProgram: {
        value: guestsNow,
        prev: guestsPrev,
        changePct: guestsPrev === 0 ? null : round1(((guestsNow - guestsPrev) / guestsPrev) * 100),
        newGuests: toNumber(summary.newGuests),
      },
      pointsLiability: {
        value: liabilityNow,
        // Баланс на начало периода — это текущий баланс минус всё, что журнал
        // насчитал за период. Считается из самого журнала, а не из отдельного
        // снимка: снимок пришлось бы поддерживать, а журнал уже неизменяем.
        prev: liabilityNow - toNumber(summary.liabilityDelta),
      },
      series,
      hourly,
      ...(incremental === null ? {} : { incremental }),
      advice: buildAdvice({
        sleeping: toNumber(summary.sleeping),
        manualShare,
        hourly,
      }),
      isPartialPeriod,
      // «Пусто, ПЕРВЫЙ ДЕНЬ» (docs/03, раздел 2) — про заведение, где гостя
      // не оформляли ни разу. Тишина за последние два периода этим состоянием
      // не является: советовать «напечатайте табличку и оформите первого
      // гостя» тому, у кого гости были, — значит показать, что мы их не видим.
      isEmpty: toNumber(summary.everGuests) === 0,
    }
  }

  /**
   * Числа для плиток одним запросом.
   *
   * Гости считаются по УЧАСТИЯМ с чеком за период, а не по строкам журнала:
   * гость, зашедший трижды, — это один гость, а не три.
   */
  private async loadSummary(tenantId: string, zone: string, days: number): Promise<SummaryRow> {
    const rows = await this.prisma.forTenant(
      tenantId,
      async (tx) =>
        tx.$queryRaw<SummaryRow[]>`
        WITH bounds AS (
          SELECT
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int - 1)                    AS cur_start,
            date_trunc('day', now() AT TIME ZONE ${zone})
              + interval '1 day'                                          AS cur_end,
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int * 2 - 1)                AS prev_start,
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int - 1)                    AS prev_end
        ),
        receipts AS (
          SELECT
            l."membershipId",
            l.amount,
            l.source,
            (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) AS local_at
          FROM "LedgerEntry" l
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
        ),
        moves AS (
          SELECT l.amount, (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) AS local_at
          FROM "LedgerEntry" l
          WHERE l."tenantId" = ${tenantId}::text
        )
        SELECT
          (SELECT count(DISTINCT r."membershipId") FROM receipts r, bounds b
            WHERE r.local_at >= b.cur_start AND r.local_at < b.cur_end)      AS "guestsNow",
          (SELECT count(DISTINCT r."membershipId") FROM receipts r, bounds b
            WHERE r.local_at >= b.prev_start AND r.local_at < b.prev_end)    AS "guestsPrev",
          (SELECT count(*) FROM "Membership" m, bounds b
            WHERE m."tenantId" = ${tenantId}::text
              AND m."firstVisitAt" IS NOT NULL
              AND (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
              AND (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end)       AS "newGuests",
          (SELECT coalesce(sum(m."pointsBalance"), 0) FROM "Membership" m
            WHERE m."tenantId" = ${tenantId}::text)                          AS "liabilityNow",
          (SELECT coalesce(sum(mv.amount), 0) FROM moves mv, bounds b
            WHERE mv.local_at >= b.cur_start AND mv.local_at < b.cur_end)    AS "liabilityDelta",
          (SELECT count(*) FROM "Membership" m
            WHERE m."tenantId" = ${tenantId}::text
              AND m."firstVisitAt" IS NOT NULL)                               AS "everGuests",
          (SELECT count(*) FROM "Membership" m
            WHERE m."tenantId" = ${tenantId}::text
              AND m."lastVisitAt" IS NOT NULL
              AND (m."lastVisitAt" AT TIME ZONE 'UTC') < now() - make_interval(days => ${SLEEPING_AFTER_DAYS}::int))
                                                                             AS "sleeping",
          (SELECT count(*) FROM receipts r, bounds b
            WHERE r.local_at >= b.cur_start AND r.local_at < b.cur_end
              AND r.source = 'STAFF_MANUAL')                                 AS "manualEarns",
          (SELECT count(*) FROM receipts r, bounds b
            WHERE r.local_at >= b.cur_start AND r.local_at < b.cur_end)      AS "totalEarns"
      `,
    )

    return (
      rows[0] ?? {
        guestsNow: 0,
        guestsPrev: 0,
        newGuests: 0,
        everGuests: 0,
        liabilityNow: 0,
        liabilityDelta: 0,
        sleeping: 0,
        manualEarns: 0,
        totalEarns: 0,
      }
    )
  }

  /**
   * График «Гости по дням»: столбцы с накоплением, впервые и повторно.
   *
   * Дни без визитов ОБЯЗАНЫ быть в ряду нулями, иначе на графике пропадает
   * провал — а провал и есть то, ради чего владелец открыл экран. Поэтому
   * ряд строится от `generate_series`, а визиты к нему присоединяются.
   */
  private async loadSeries(tenantId: string, zone: string, days: number): Promise<DashboardDay[]> {
    const rows = await this.prisma.forTenant(
      tenantId,
      async (tx) =>
        tx.$queryRaw<SeriesRow[]>`
        WITH bounds AS (
          SELECT
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int - 1) AS cur_start,
            date_trunc('day', now() AT TIME ZONE ${zone}) AS today
        ),
        calendar AS (
          SELECT generate_series(b.cur_start, b.today, interval '1 day')::date AS day
          FROM bounds b
        ),
        visits AS (
          SELECT DISTINCT
            l."membershipId",
            (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS day,
            (m."firstVisitAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS first_day
          FROM "LedgerEntry" l
          JOIN "Membership" m ON m.id = l."membershipId" AND m."tenantId" = ${tenantId}::text
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
        )
        SELECT
          to_char(c.day, 'YYYY-MM-DD') AS "date",
          count(v."membershipId") FILTER (WHERE v.first_day = c.day)  AS "newGuests",
          count(v."membershipId") FILTER (WHERE v.first_day <> c.day
                                             OR v.first_day IS NULL)  AS "returningGuests"
        FROM calendar c
        LEFT JOIN visits v ON v.day = c.day
        GROUP BY c.day
        ORDER BY c.day
      `,
    )

    return rows.map((row) => ({
      date: row.date,
      new: toNumber(row.newGuests),
      returning: toNumber(row.returningGuests),
    }))
  }

  /**
   * График «Загрузка по часам»: средний БУДНИЙ день (docs/03, раздел 2).
   *
   * Выходные исключены намеренно: у пляжного кафе суббота ломает картину
   * будней, а совет про тихие часы адресован именно будням. Среднее делится
   * на число будних дней в периоде, а не на число дней с визитами, — иначе
   * час с одним визитом за месяц выглядел бы как стабильная загрузка.
   *
   * Часы без визитов возвращаются нулями: без них провал не виден.
   */
  private async loadHourly(tenantId: string, zone: string, days: number): Promise<DashboardHour[]> {
    const rows = await this.prisma.forTenant(
      tenantId,
      async (tx) =>
        tx.$queryRaw<HourRow[]>`
        WITH bounds AS (
          SELECT
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int - 1) AS cur_start,
            date_trunc('day', now() AT TIME ZONE ${zone})
              + interval '1 day'                        AS cur_end
        ),
        weekdays AS (
          SELECT count(*)::numeric AS n
          FROM bounds b, generate_series(b.cur_start, b.cur_end - interval '1 day',
                                         interval '1 day') AS d
          WHERE extract(isodow FROM d) < 6
        ),
        visits AS (
          SELECT extract(hour FROM (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}))::int AS hour
          FROM "LedgerEntry" l, bounds b
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
            AND (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
            AND (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
            AND extract(isodow FROM (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})) < 6
        )
        SELECT
          h.hour AS "hour",
          CASE WHEN w.n = 0 THEN 0
               ELSE round(count(v.hour)::numeric / w.n, 2)
          END AS "guests"
        FROM generate_series(0, 23) AS h(hour)
        CROSS JOIN weekdays w
        LEFT JOIN visits v ON v.hour = h.hour
        GROUP BY h.hour, w.n
        ORDER BY h.hour
      `,
    )

    return rows.map((row) => ({ hour: toNumber(row.hour), guests: Number(row.guests ?? 0) }))
  }

  /**
   * Инкрементальность: средний чек участника против контрольной группы.
   *
   * Контрольная группа — те 5% гостей, которым баллы не начисляются (docs/01,
   * раздел 4.2). Разница средних чеков и есть доказательство, что программа
   * работает, — единственное честное, какое можно предъявить владельцу.
   *
   * Возвращает `null`, когда контрольная группа меньше тридцати человек.
   */
  private async loadIncremental(
    tenantId: string,
    zone: string,
    days: number,
  ): Promise<DashboardIncremental | null> {
    const rows = await this.prisma.forTenant(
      tenantId,
      async (tx) =>
        tx.$queryRaw<IncrementalRow[]>`
        WITH bounds AS (
          SELECT
            date_trunc('day', now() AT TIME ZONE ${zone})
              - make_interval(days => ${days}::int - 1) AS cur_start,
            date_trunc('day', now() AT TIME ZONE ${zone})
              + interval '1 day'                        AS cur_end
        ),
        checks AS (
          SELECT m."isControlGroup", l."basisAmount"
          FROM "LedgerEntry" l
          JOIN "Membership" m ON m.id = l."membershipId" AND m."tenantId" = ${tenantId}::text
          , bounds b
          WHERE l."tenantId" = ${tenantId}::text
            AND l."refType" = 'receipt'
            AND l.type = 'EARN'
            AND l."basisAmount" IS NOT NULL
            AND (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) >= b.cur_start
            AND (l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone}) < b.cur_end
        )
        SELECT
          coalesce(round(avg("basisAmount") FILTER (WHERE NOT "isControlGroup")), 0) AS "programAvg",
          coalesce(round(avg("basisAmount") FILTER (WHERE "isControlGroup")), 0)     AS "controlAvg",
          (SELECT count(*) FROM "Membership" m
            WHERE m."tenantId" = ${tenantId}::text AND m."isControlGroup")           AS "controlSize"
        FROM checks
      `,
    )

    const row = rows[0]

    if (row === undefined) {
      return null
    }

    const controlSize = toNumber(row.controlSize)

    if (controlSize < INCREMENTAL_MIN_CONTROL) {
      return null
    }

    const programAvgCheck = Math.round(Number(row.programAvg ?? 0))
    const controlAvgCheck = Math.round(Number(row.controlAvg ?? 0))

    return {
      programAvgCheck,
      controlAvgCheck,
      upliftPct:
        controlAvgCheck === 0
          ? 0
          : round1(((programAvgCheck - controlAvgCheck) / controlAvgCheck) * 100),
      controlSize,
    }
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * Блок «Что стоит сделать сегодня»: максимум три карточки по приоритету.
 *
 * Порядок приоритета — порядок таблицы в docs/03, раздел 2. Если советов нет,
 * возвращается пустой список: ТЗ требует СКРЫТЬ блок целиком, а не показывать
 * «всё хорошо» — похвала вместо задачи обесценивает блок, и владелец перестаёт
 * туда смотреть.
 */
function buildAdvice(input: {
  sleeping: number
  manualShare: number
  hourly: readonly DashboardHour[]
}): DashboardAdvice[] {
  const advice: DashboardAdvice[] = []

  if (input.sleeping >= SLEEPING_ADVICE_FROM) {
    advice.push({ kind: 'SLEEPING_GUESTS', guests: input.sleeping })
  }

  const quiet = findQuietRun(input.hourly)

  if (quiet !== null) {
    advice.push({ kind: 'QUIET_HOURS', fromHour: quiet.from, toHour: quiet.to })
  }

  if (input.manualShare > MANUAL_ENTRY_ADVICE_FROM) {
    advice.push({ kind: 'MANUAL_ENTRY', sharePct: round1(input.manualShare) })
  }

  return advice.slice(0, 3)
}

/**
 * Самый длинный провал загрузки внутри рабочего дня.
 *
 * Считаем только часы, когда заведение вообще работает: закрытая с полуночи
 * до восьми кофейня иначе получила бы совет «с 0 до 7 зал пустой». Рабочими
 * считаются часы от первого до последнего, где за период был хоть один гость.
 */
function findQuietRun(hourly: readonly DashboardHour[]): { from: number; to: number } | null {
  const active = hourly.filter((point) => point.guests > 0)

  if (active.length === 0) {
    return null
  }

  const openFrom = Math.min(...active.map((point) => point.hour))
  const openTo = Math.max(...active.map((point) => point.hour))
  const workday = hourly.filter((point) => point.hour >= openFrom && point.hour <= openTo)
  const average = workday.reduce((sum, point) => sum + point.guests, 0) / workday.length
  const threshold = average * QUIET_HOUR_SHARE

  let best: { from: number; to: number } | null = null
  let runStart: number | null = null

  for (const point of [...workday, null]) {
    const isQuiet = point !== null && point.guests < threshold

    if (isQuiet && runStart === null) {
      runStart = point.hour
      continue
    }

    if (!isQuiet && runStart !== null) {
      const runEnd = (point?.hour ?? openTo + 1) - 1
      const length = runEnd - runStart + 1

      if (length >= QUIET_HOURS_MIN_RUN && (best === null || length > best.to - best.from + 1)) {
        best = { from: runStart, to: runEnd }
      }

      runStart = null
    }
  }

  return best
}
