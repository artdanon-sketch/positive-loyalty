import { Injectable, Logger } from '@nestjs/common'
import { CertificateOfferReward, ProgramConfig } from '@positive/contracts'

import { localDay } from '../common/time/local-day'
import { birthdayYearInWindow } from './birthday'
import { IdempotencyKeyReusedError } from './ledger.errors'
import { LedgerService } from './ledger.service'
import { OfferGrantService } from './offer-grant.service'
import { PrismaService } from './prisma.service'

/**
 * Подарок ко дню рождения. docs/02, раздел 2.7 · docs/11, У9.
 *
 * ЛЕНИВО, А НЕ ПО РАСПИСАНИЮ. Фонового воркера пока нет (docs/09, Э3), а подарок
 * нужен ровно тогда, когда гость на него посмотрит: при открытии кошелька или
 * у кассы. Так гость с днём рождения завтра открывает кошелёк и видит подарок.
 *
 * ОДИН ПОДАРОК НА ДЕНЬ РОЖДЕНИЯ. Ключ — `birthday:{участие}:{год}`: баллы ложатся
 * в журнал с этим ключом, сертификат — промокодом с этим nonce. Повторное открытие
 * кошелька, вторая вкладка и касса вслед за кошельком упираются в один ключ.
 *
 * ПОДАРОК НЕ РОНЯЕТ КОШЕЛЁК. Сбой выдачи пишется в лог, а кошелёк открывается:
 * гость у стойки должен увидеть свой код даже в день, когда подарок не выдался.
 *
 * Контрольной группе не положено: у неё нет бонусов программы вовсе (docs/01, 4.2).
 */

interface BirthdayTarget {
  readonly tenantId: string
  readonly guestId: string
  readonly membershipId: string
  readonly isControlGroup: boolean
  readonly birthday: Date
  readonly settings: unknown
  readonly timezone: string
}

@Injectable()
export class BirthdayService {
  private readonly logger = new Logger(BirthdayService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly grants: OfferGrantService,
  ) {}

  /** Кошелёк: подарки во всех заведениях гостя, где они сейчас положены. */
  async grantDue(guestId: string, now: Date = new Date()): Promise<void> {
    const data = await this.prisma.forGuest(guestId, async (tx) => {
      const guest = await tx.guest.findFirst({
        where: { id: guestId },
        select: { birthday: true },
      })

      if (guest === null || guest.birthday === null) {
        return null
      }

      const memberships = await tx.membership.findMany({
        where: { guestId },
        select: {
          id: true,
          tenantId: true,
          isControlGroup: true,
          tenant: { select: { settings: true, timezone: true } },
        },
      })

      return { birthday: guest.birthday, memberships }
    })

    if (data === null) {
      return
    }

    for (const membership of data.memberships) {
      await this.grant(
        {
          tenantId: membership.tenantId,
          guestId,
          membershipId: membership.id,
          isControlGroup: membership.isControlGroup,
          birthday: data.birthday,
          settings: membership.tenant.settings,
          timezone: membership.tenant.timezone,
        },
        now,
      )
    }
  }

  /** Касса: подарок в этом заведении. Возвращает баланс после баллов или null. */
  async grantDueAt(
    tenantId: string,
    guestId: string,
    now: Date = new Date(),
  ): Promise<number | null> {
    const membership = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.findFirst({
        where: { tenantId, guestId },
        select: {
          id: true,
          isControlGroup: true,
          guest: { select: { birthday: true } },
          tenant: { select: { settings: true, timezone: true } },
        },
      }),
    )

    if (membership === null || membership.guest.birthday === null) {
      return null
    }

    return this.grant(
      {
        tenantId,
        guestId,
        membershipId: membership.id,
        isControlGroup: membership.isControlGroup,
        birthday: membership.guest.birthday,
        settings: membership.tenant.settings,
        timezone: membership.tenant.timezone,
      },
      now,
    )
  }

  private async grant(target: BirthdayTarget, now: Date): Promise<number | null> {
    const program = ProgramConfig.safeParse(target.settings ?? {})

    if (!program.success || !program.data.birthday.enabled || target.isControlGroup) {
      return null
    }

    const config = program.data.birthday
    const year = birthdayYearInWindow(
      target.birthday,
      localDay(target.timezone, now),
      config.daysBefore,
      config.daysAfter,
    )

    if (year === null) {
      return null
    }

    const idempotencyKey = `birthday:${target.membershipId}:${String(year)}`

    try {
      if (config.reward.kind === 'POINTS') {
        // Подарок уже у гостя — проверяем заранее, как у приветственных баллов:
        // если владелец с тех пор поменял сумму, повтор журнал счёл бы чужой операцией.
        const already = await this.prisma.forTenant(target.tenantId, async (tx) =>
          tx.ledgerEntry.findUnique({ where: { idempotencyKey }, select: { id: true } }),
        )

        if (already !== null) {
          return null
        }

        const result = await this.ledger.grant(
          {
            membershipId: target.membershipId,
            amount: config.reward.amount,
            idempotencyKey,
            source: 'SYSTEM',
            actorType: 'SYSTEM',
          },
          { tenantId: target.tenantId },
        )

        return result.entry.balanceAfter
      }

      const certificateId = config.reward.certificateId
      const template = await this.prisma.forTenant(target.tenantId, async (tx) =>
        tx.offer.findFirst({
          where: {
            id: certificateId,
            tenantId: target.tenantId,
            type: 'GIFT_CARD',
            status: 'LIVE',
          },
          select: { reward: true },
        }),
      )
      const reward = template === null ? null : CertificateOfferReward.safeParse(template.reward)

      if (reward === null || !reward.success) {
        this.logger.warn(
          `Сертификат ко дню рождения ${certificateId} в заведении ${target.tenantId} не найден или выключен`,
        )
        return null
      }

      await this.grants.issue({
        offerId: certificateId,
        guestId: target.guestId,
        tenantId: target.tenantId,
        validityDays: reward.data.validityDays,
        idempotencyKey,
        now,
      })

      return null
    } catch (error) {
      if (error instanceof IdempotencyKeyReusedError) {
        return null
      }

      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Подарок ко дню рождения участия ${target.membershipId} не выдан: ${message}`,
      )
      return null
    }
  }
}
