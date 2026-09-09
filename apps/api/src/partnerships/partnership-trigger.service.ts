import { createHash } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'
import { PartnershipLimits, PartnershipTrigger } from '@positive/contracts'

import { OfferGrantService } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Сердце партнёрств: событие у одного заведения → промокод от другого.
 *
 * Студия танцев продала абонемент — гостю прилетает подарок от ресторана.
 * Всё остальное в модуле обслуживает этот один переход.
 *
 * ─── ПОЧЕМУ СВОЁ СОБЫТИЕ, А НЕ LedgerEventsService ──────────────────────────
 *
 * docs/07 раздел 4.1 обещает, что триггеры «вычисляются из доменных событий,
 * которые уже эмитит ledger». В коде такого нет: LedgerEventsService — это
 * ЛЕНТА ДЛЯ ЭКРАНА в зале, а не шина событий. Она
 *
 *   пропускает только EARN с refType = 'receipt' — то есть покупка абонемента
 *     (refType = 'package') до неё не долетает вовсе, а это ровно тот триггер,
 *     с которого начинается пример из ТЗ;
 *   маскирует имя гостя — правильно для экрана, бесполезно для механики;
 *   живёт в памяти процесса — при перезапуске событие исчезает.
 *
 * Поэтому слушатель принимает СВОЙ, доменный факт: что произошло, у кого,
 * с каким гостем и на какую сумму. Кто его доставит — отдельный вопрос,
 * см. «чего здесь нет».
 *
 * ─── ИДЕМПОТЕНТНОСТЬ — ГЛАВНОЕ СВОЙСТВО ────────────────────────────────────
 *
 * Одно и то же событие приходит дважды регулярно: повторная доставка,
 * перезапуск обработчика, ретрай после таймаута. Гость не должен получить
 * два подарка за одну покупку, а заведение-донор — платить дважды.
 *
 * Ключ строится из тройки (условие, гость, запись журнала) и ложится в колонку
 * nonce промокода, у которой есть UNIQUE. Гарантию даёт БАЗА, а не проверка
 * в коде: два одновременных события прошли бы проверку оба.
 *
 * ─── ЧЕГО ЗДЕСЬ НЕТ, И ЭТО НАДО ЗНАТЬ ──────────────────────────────────────
 *
 * Долговечной доставки. Сейчас слушателя зовут напрямую, и если процесс упадёт
 * между записью в журнал и выдачей промокода, награда потеряется молча.
 * docs/07 раздел 8 требует очередь `partnership-triggers` — её здесь нет.
 *
 * Это названо, а не спрятано: в репозитории уже есть образец надёжной доставки
 * (WebhookEvent и WebhookDelivery), и слушатель сядет на него следующим шагом.
 * До тех пор партнёрские награды выдаются «обычно», а не «гарантированно».
 */

/** Доменный факт, по которому могут сработать условия. */
export interface TriggerEvent {
  /** Где произошло. */
  readonly tenantId: string
  readonly guestId: string
  /** Запись журнала, породившая событие. Часть ключа идемпотентности. */
  readonly sourceEntryId: string
  /** Происхождение записи: receipt | package | offer_grant | referral | promo. */
  readonly refType: string | null
  /** Сумма чека в минорных единицах. */
  readonly basisAmount: number | null
  /** Каким по счёту стал этот визит гостя в это заведение. */
  readonly visitsTotal: number | null
  /** Участие создано этим же событием — гость впервые пришёл. */
  readonly membershipCreated: boolean
  readonly occurredAt: Date
}

/** Что выдали по одному условию. */
export interface TriggeredGrant {
  readonly termId: string
  readonly grantId: string
  readonly code: string
  readonly rewardTenantId: string
  /** Повтор события: промокод не новый, а тот же самый. */
  readonly replayed: boolean
}

/** Какой лимит закрыл выдачу. Уходит в лог, наружу не показывается. */
type SkipReason = 'ЛИМИТ_НА_ГОСТЯ' | 'ЛИМИТ_ЗА_СУТКИ' | 'ЛИМИТ_ВСЕГО'

@Injectable()
export class PartnershipTriggerService {
  private readonly logger = new Logger(PartnershipTriggerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: OfferGrantService,
  ) {}

  /**
   * Обработать событие: найти сработавшие условия и выдать по ним промокоды.
   *
   * Возвращает выданное. Пустой список — норма: у большинства заведений
   * партнёрств нет вовсе.
   */
  async handle(event: TriggerEvent): Promise<TriggeredGrant[]> {
    // Условия читаем ПОД ЗАВЕДЕНИЕМ-ИСТОЧНИКОМ: это его событие, и политика
    // партнёрства отдаст ему строку, где он triggerTenant.
    const terms = await this.prisma.forTenant(event.tenantId, async (tx) =>
      tx.partnershipTerm.findMany({
        where: { triggerTenantId: event.tenantId, status: 'ACTIVE', offerId: { not: null } },
        select: {
          id: true,
          offerId: true,
          rewardTenantId: true,
          trigger: true,
          limits: true,
          validityDays: true,
        },
      }),
    )

    const issued: TriggeredGrant[] = []

    for (const term of terms) {
      if (term.offerId === null) {
        // Условие принято, но акция ещё не создана: активации не было.
        this.logger.debug(`Условие ${term.id} не сработало: НЕТ_АКЦИИ`)
        continue
      }

      const trigger = PartnershipTrigger.safeParse(term.trigger)

      if (!trigger.success || !matches(trigger.data, event)) {
        this.logger.debug(`Условие ${term.id} не сработало: ТРИГГЕР_НЕ_СОВПАЛ`)
        continue
      }

      const key = idempotencyKey(term.id, event.guestId, event.sourceEntryId)

      // ИДЕМПОТЕНТНОСТЬ ПРОВЕРЯЕТСЯ РАНЬШЕ ЛИМИТОВ, И ЭТО НЕ ПОРЯДОК УДОБСТВА.
      //
      // Лимит на гостя обычно равен единице. На повторе события гость уже
      // держит выданный промокод — и лимит упирается в него самого. Проверь
      // мы лимиты первыми, повтор возвращал бы ПУСТО, то есть «ничего не
      // выдано» вместо «выдано вот это». Касса или очередь, переспросившая
      // после таймаута, решила бы, что награды нет, и сказала бы гостю «нет».
      //
      // Поймано интеграционным тестом на повтор, а не рассуждением.
      const already = await this.grants.findByIdempotencyKey(term.rewardTenantId, key)

      if (already !== null) {
        issued.push({
          termId: term.id,
          grantId: already.id,
          code: already.code,
          rewardTenantId: term.rewardTenantId,
          replayed: true,
        })
        continue
      }

      const limits = PartnershipLimits.safeParse(term.limits)
      // Разбитые лимиты трактуем как самые строгие из разумных, а не как
      // «ограничений нет»: ошибка в данных не должна открывать кран.
      const bounds = limits.success
        ? limits.data
        : { totalGrants: null, perGuest: 1, dailyCap: null }

      const skip = await this.checkLimits(term.offerId, term.rewardTenantId, bounds, event)

      if (skip !== null) {
        this.logger.debug(`Условие ${term.id} не сработало: ${skip}`)
        continue
      }

      // ВЫДАЁТ ЗАВЕДЕНИЕ-ДОНОР, А НЕ ИСТОЧНИК. Акция принадлежит ему, промокод
      // тоже: подарок оплачивает тот, кто его даёт. Поэтому и тенант здесь его.
      const grant = await this.grants.issue({
        offerId: term.offerId,
        guestId: event.guestId,
        tenantId: term.rewardTenantId,
        validityDays: term.validityDays,
        idempotencyKey: key,
        now: event.occurredAt,
      })

      // Счётчик поднимаем только на НОВОЙ выдаче. Проверка выше ловит повтор
      // в спокойном случае, а эта — гонку: два одинаковых события пришли
      // одновременно, оба не нашли строки, и одно упёрлось в UNIQUE.
      if (!grant.replayed) {
        await this.prisma.forTenant(term.rewardTenantId, async (tx) =>
          tx.partnershipTerm.update({
            where: { id: term.id },
            data: { grantsIssued: { increment: 1 } },
          }),
        )
      }

      issued.push({
        termId: term.id,
        grantId: grant.id,
        code: grant.code,
        rewardTenantId: term.rewardTenantId,
        replayed: grant.replayed,
      })
    }

    return issued
  }

  private async checkLimits(
    offerId: string,
    rewardTenantId: string,
    limits: PartnershipLimits,
    event: TriggerEvent,
  ): Promise<SkipReason | null> {
    return this.prisma.forTenant(rewardTenantId, async (tx) => {
      const perGuest = await tx.offerGrant.count({
        where: { offerId, guestId: event.guestId },
      })

      if (perGuest >= limits.perGuest) {
        return 'ЛИМИТ_НА_ГОСТЯ'
      }

      if (limits.dailyCap !== null) {
        const dayStart = new Date(event.occurredAt)
        dayStart.setUTCHours(0, 0, 0, 0)

        const today = await tx.offerGrant.count({
          where: { offerId, issuedAt: { gte: dayStart } },
        })

        if (today >= limits.dailyCap) {
          return 'ЛИМИТ_ЗА_СУТКИ'
        }
      }

      if (limits.totalGrants !== null) {
        const total = await tx.offerGrant.count({ where: { offerId } })

        if (total >= limits.totalGrants) {
          return 'ЛИМИТ_ВСЕГО'
        }
      }

      return null
    })
  }
}

/**
 * Совпал ли триггер с событием.
 *
 * Чистая функция без базы: её можно прогнать по всем видам триггеров
 * юнит-тестом, не поднимая ничего.
 */
export const matches = (trigger: PartnershipTrigger, event: TriggerEvent): boolean => {
  switch (trigger.type) {
    case 'ON_PURCHASE':
      // Любая покупка по чеку. Абонемент сюда НЕ входит: у него своё условие,
      // и смешивать их значило бы выдавать подарок дважды за одну продажу.
      return event.refType === 'receipt' && (event.basisAmount ?? 0) >= trigger.minAmount

    case 'ON_PACKAGE_PURCHASE':
      return event.refType === 'package' && (event.basisAmount ?? 0) >= trigger.minAmount

    case 'ON_FIRST_VISIT':
      return event.visitsTotal === 1

    case 'ON_NTH_VISIT':
      return event.visitsTotal === trigger.n

    case 'ON_MEMBERSHIP':
      return event.membershipCreated

    case 'ON_STAMP_COMPLETE':
    case 'ON_TIER_REACHED':
      // Штампов и статусов в системе пока нет: ни таблиц, ни событий.
      // Возвращаем «не совпало», а не бросаем: условие с таким триггером
      // согласовать можно, оно просто не сработает, пока механики нет.
      // Молча делать вид, что сработало, было бы хуже всего.
      return false
  }
}

/**
 * Ключ идемпотентности: условие + гость + запись журнала.
 *
 * Именно тройка, а не пара. Без записи журнала гость получил бы подарок
 * один раз за всю жизнь партнёрства; без гостя — один раз на всех.
 */
export const idempotencyKey = (termId: string, guestId: string, sourceEntryId: string): string =>
  createHash('sha256').update(`${termId}|${guestId}|${sourceEntryId}`).digest('hex')
