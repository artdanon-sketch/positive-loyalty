import { EventEmitter } from 'node:events'

import { Injectable, Logger } from '@nestjs/common'
import type { LiveFeedEvent } from '@positive/contracts'

import type { LedgerEntry } from '../generated/prisma/client'

import { PrismaService } from './prisma.service'

/**
 * Издатель событий журнала для живой ленты бэк-офиса (docs/03, раздел 2).
 *
 * ВНУТРИПРОЦЕССНЫЙ, И ЭТО ОСОЗНАННАЯ ГРАНИЦА. Подписчик получает событие
 * только от того экземпляра API, который записал операцию. Пока API работает
 * одним процессом (Railway, один сервис), это верно всегда. Как только
 * экземпляров станет больше одного, лента начнёт показывать часть чеков —
 * те, что прошли через «свой» процесс.
 *
 * Путь наружу из этого ограничения известен и дёшев: Redis pub/sub (он уже
 * заложен в docs/01, раздел 6 под очереди). Менять придётся только этот файл:
 * `publish` уйдёт в канал, `subscribe` подпишется на канал. Ни `LedgerService`,
 * ни контроллер об этом не узнают — ради этого издатель и вынесен отдельно,
 * а не написан прямо в сервисе журнала.
 *
 * ЛЕНТА НЕ ДОЛЖНА ЛОМАТЬ НАЧИСЛЕНИЕ. Публикация идёт после успешной
 * транзакции, ничего не ждёт и глотает свои ошибки: экран в зале — приятная
 * мелочь, а чек — деньги. Порядок важности здесь ровно такой.
 */

/** Канал в эмиттере — свой на каждое заведение: чужие чеки на чужой экран не попадут. */
const channel = (tenantId: string): string => `ledger.earned:${tenantId}`

/**
 * Имя до первой буквы: «Анна» → «А***».
 *
 * Маскирование живёт ЗДЕСЬ, до отправки, а не в вёрстке ленты. Полное имя,
 * доехавшее до браузера, лежит в разметке и в инструментах разработчика —
 * маскирование на клиенте было бы украшением, а не защитой.
 */
export const maskName = (displayName: string | null): string => {
  const trimmed = displayName?.trim() ?? ''

  if (trimmed === '') {
    return ''
  }

  return `${[...trimmed][0] ?? ''}***`
}

@Injectable()
export class LedgerEventsService {
  private readonly logger = new Logger(LedgerEventsService.name)

  /**
   * Потолок слушателей поднят: подписчик — это открытая вкладка бэк-офиса,
   * и десять по умолчанию упираются в трёх сотрудников с двумя вкладками.
   * Предупреждение об утечке при этом остаётся полезным — просто на другом
   * числе.
   */
  private readonly emitter = new EventEmitter().setMaxListeners(200)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Сообщает ленте о новом начислении.
   *
   * Ничего не возвращает и ничего не ждёт: вызывающий — `LedgerService`,
   * и задерживать ответ кассе ради экрана в зале нельзя.
   */
  publishEarned(row: LedgerEntry): void {
    // Лента показывает продажи. Компенсации, сгорания и ручные правки на экран
    // в зале не выводим: они требуют объяснения, а объяснить их там некому.
    if (row.type !== 'EARN' || row.refType !== 'receipt') {
      return
    }

    void this.buildEvent(row)
      .then((event) => {
        this.emitter.emit(channel(row.tenantId), event)
      })
      .catch((error: unknown) => {
        // Имя PII, поэтому в лог уходит только идентификатор записи.
        this.logger.warn(
          `Не удалось опубликовать событие ленты для записи ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })
  }

  /**
   * Подписка на события своего заведения. Возвращает отписку.
   *
   * `tenantId` приходит из проверенного токена и никогда снаружи: подписка
   * на чужой канал — это чужие чеки на своём экране.
   */
  subscribe(tenantId: string, handler: (event: LiveFeedEvent) => void): () => void {
    const name = channel(tenantId)
    this.emitter.on(name, handler)

    return () => {
      this.emitter.off(name, handler)
    }
  }

  private async buildEvent(row: LedgerEntry): Promise<LiveFeedEvent> {
    const guest = await this.prisma.forTenant(row.tenantId, async (tx) =>
      tx.guest.findFirst({ where: { id: row.guestId }, select: { displayName: true } }),
    )

    return {
      id: row.id,
      kind: 'ledger.earned',
      masked: maskName(guest?.displayName ?? null),
      amount: row.amount,
      basis: row.basisAmount,
      // Время СОБЫТИЯ: чек, приехавший вебхуком с опозданием, показывается
      // тем временем, когда он случился, а не когда о нём узнали.
      at: (row.occurredAt ?? row.createdAt).toISOString(),
    }
  }
}
