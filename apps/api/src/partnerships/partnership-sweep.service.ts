import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../core/prisma.service'

import { PartnershipTriggerService } from './partnership-trigger.service'

/**
 * Разгребатель партнёрских триггеров: находит в журнале операции, которые
 * ещё не разобраны на условия, и зовёт слушателя.
 *
 * ─── ПОЧЕМУ НЕ ЗОВ ИЗ КАССОВОГО ПУТИ ────────────────────────────────────────
 *
 * Очевидный ход — позвать слушателя сразу после того, как касса пробила чек.
 * Он даёт мгновенную награду и ложную гарантию: между записью в журнал
 * и выдачей промокода процесс может умереть, и подарок пропадёт МОЛЧА.
 * Узнать о нём будет неоткуда — нигде не записано, что он был должен.
 *
 * Здесь тот же приём, которым уже решены исходящие события к кассе
 * (WebhookOutboxService): СОБЫТИЕ ВЫВОДИТСЯ ИЗ ЖУРНАЛА, А НЕ ПИШЕТСЯ РЯДОМ
 * С НИМ. Журнал append-only и долговечен, поэтому «операция есть, а награда
 * не выдана» — состояние, из которого всегда можно доехать.
 *
 * Побочная выгода важнее удобства: ядро не узнаёт про партнёрства вовсе.
 * Зов из LedgerService означал бы, что журнал зависит от прикладного модуля,
 * а такую зависимость потом не разорвать.
 *
 * ─── ПОРЯДОК: СНАЧАЛА ВЫДАТЬ, ПОТОМ ОТМЕТИТЬ ───────────────────────────────
 *
 * Падение между выдачей и отметкой приводит к повторному разбору, а он
 * безвреден: промокод выдаётся по ключу идемпотентности и второй раз
 * не родится. Обратный порядок — отметить, потом выдать — терял бы награду
 * тихо и невоспроизводимо.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ ────────────────────────────────────────────────────────
 *
 * Догона после долгого простоя: окно в сутки задано в самой функции выборки.
 * Разгребатель, простоявший дольше, пропущенное не разбирает — выдать
 * вчерашний подарок гостю, который уже ушёл, хуже, чем не выдать. Такой
 * простой разбирает человек, а не цикл.
 */

/** Операция журнала, ещё не разобранная на условия. Из функции поверх границ. */
interface AwaitingEntry {
  id: string
  tenantId: string
  guestId: string
  refType: string | null
  saleKindId: string | null
  basisAmount: number | null
  visitsTotal: number | null
  membershipCreated: boolean
  occurredAt: Date | null
  createdAt: Date
}

/** Сколько операций разбираем за проход. Больше — дольше держим соединение. */
const BATCH_SIZE = 20

@Injectable()
export class PartnershipSweepService {
  private readonly logger = new Logger(PartnershipSweepService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly triggers: PartnershipTriggerService,
  ) {}

  /**
   * Один проход.
   *
   * `now` приходит снаружи, чтобы момент решения был одним на весь проход
   * и чтобы тест мог задать его сам, не подменяя часы процесса.
   */
  async tick(now: Date = new Date()): Promise<{ scanned: number; issued: number }> {
    const rows = await this.prisma.$queryRaw<AwaitingEntry[]>`
      SELECT * FROM ledger_entries_awaiting_partnership(${BATCH_SIZE}::int, ${now}::timestamptz)
    `

    let issued = 0

    for (const row of rows) {
      const grants = await this.triggers.handle({
        tenantId: row.tenantId,
        guestId: row.guestId,
        sourceEntryId: row.id,
        refType: row.refType,
        saleKindId: row.saleKindId,
        basisAmount: row.basisAmount,
        visitsTotal: row.visitsTotal,
        membershipCreated: row.membershipCreated,
        occurredAt: row.occurredAt ?? row.createdAt,
      })

      // Считаем только НОВЫЕ выдачи: повтор разбора не должен выглядеть
      // в журнале работы так, будто гостям раздали ещё порцию подарков.
      const fresh = grants.filter((grant) => !grant.replayed).length

      issued += fresh

      try {
        await this.prisma.forTenant(row.tenantId, async (tx) =>
          tx.partnershipTriggerRun.create({
            data: { tenantId: row.tenantId, ledgerEntryId: row.id, grantsIssued: fresh },
          }),
        )
      } catch (error) {
        // Отметку мог поставить параллельный проход — UNIQUE для того и стоит.
        // Награды при этом уже выданы и не задвоены: за это отвечает ключ
        // идемпотентности, а не эта строка.
        this.logger.debug(
          `Отметка о разборе ${row.id} не поставлена: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    return { scanned: rows.length, issued }
  }
}
