import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { GuestMe, GuestQrToken, GuestWallet, WalletVoucher } from '@positive/contracts'
import { offerHowTo, offerTitle, ProgramConfig } from '@positive/contracts'

import { getEnv } from '../common/config/env'
import { maskPhone } from '../common/pii/mask-phone'
import { signGuestQrToken } from '../common/tenant/access-token'
import { BirthdayService } from '../core/birthday.service'
import { PrismaService } from '../core/prisma.service'
import { resolveTier, tierProgress } from '../core/tiers'
import { currentGuestId } from './current-guest'

/** Токен на кассу живёт пять минут: экран открыт у стойки, а не хранится. */
const QR_TTL_SECONDS = 300

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Сколько дней осталось до сгорания, с точки зрения СЕРВЕРА.
 *
 * Округление вверх: до полуночи послезавтра — это «два дня», а не «один
 * с хвостиком». Гость планирует днями, а не часами.
 *
 * Ноль означает «сегодня последний день». Ниже нуля не опускаемся: в кошелёк
 * просроченные не попадают, и отрицательное число означало бы ошибку выборки,
 * а не срочность.
 */
const daysUntil = (expiresAt: Date, now: Date): number =>
  Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))

@Injectable()
export class GuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly birthdays: BirthdayService,
  ) {}

  async me(): Promise<GuestMe> {
    const guestId = currentGuestId()

    const guest = await this.prisma.forGuest(guestId, async (tx) =>
      tx.guest.findFirst({ where: { id: guestId } }),
    )

    if (guest === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    return {
      id: guest.id,
      displayName: guest.displayName,
      mode: guest.mode,
      locale: guest.locale,
      phoneMasked: maskPhone(guest.phoneE164),
      birthday: guest.birthday === null ? null : guest.birthday.toISOString().slice(0, 10),
    }
  }

  /**
   * День рождения — один раз. docs/02, раздел 2.7.
   *
   * Запись условная, «где дня рождения ещё нет»: вторая попытка, даже одновременная,
   * ничего не меняет и получает отказ. Иначе подарок ко дню рождения можно было бы
   * получать каждый месяц, переставляя дату.
   */
  async setBirthday(date: string): Promise<GuestMe> {
    const guestId = currentGuestId()

    const updated = await this.prisma.forGuest(guestId, async (tx) =>
      tx.guest.updateMany({
        where: { id: guestId, birthday: null },
        data: { birthday: new Date(`${date}T00:00:00.000Z`) },
      }),
    )

    if (updated.count === 0) {
      throw new ConflictException({
        error: {
          code: 'BIRTHDAY_ALREADY_SET',
          message: 'День рождения уже указан — изменить его может только поддержка',
        },
      })
    }

    return this.me()
  }

  /**
   * Кошелёк — участия во всех заведениях. Гостевой контур RLS отдаёт ровно
   * свои строки: и участия, и витрины заведений (миграция 20260826230000).
   * Никакого перебора тенантов в коде: изоляцию держит база.
   */
  async wallet(): Promise<GuestWallet> {
    const guestId = currentGuestId()

    // Подарок ко дню рождения — до чтения кошелька: баллы и сертификат гость видит сразу.
    await this.birthdays.grantDue(guestId)

    const rows = await this.prisma.forGuest(guestId, async (tx) =>
      tx.membership.findMany({
        where: { guestId },
        include: { tenant: { select: { brandName: true, settings: true } } },
        orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      }),
    )

    const memberships = rows.map((row) => {
      // Статус — тем же расчётом, что у кассы. Рекомендации гостю не посчитать:
      // чужие участия гостевой контур не отдаёт, — поэтому ноль, и условие
      // по рекомендациям на карте не показывается.
      const program = ProgramConfig.safeParse(row.tenant.settings ?? {})
      const tiers = program.success ? program.data.tiers : []
      const referral = program.success ? program.data.referral : null
      const facts = {
        tierId: row.tierId,
        tierManual: row.tierManual,
        spentTotal: row.spentTotal,
        visitsTotal: row.visitsTotal,
        referrals: 0,
      }
      const tier = resolveTier(tiers, facts)
      const progress = tierProgress(tiers, tier, facts)

      return {
        tenantId: row.tenantId,
        brandName: row.tenant.brandName,
        points: row.pointsBalance,
        visitsTotal: row.visitsTotal,
        lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
        isControlGroup: row.isControlGroup,
        // Тем же правилом, что GET …/referral: группе сравнения баллов не положено.
        inviteReward:
          referral !== null && referral.enabled && referral.reward > 0 && !row.isControlGroup
            ? referral.reward
            : null,
        tier: tier === null ? null : { name: tier.name },
        nextTier:
          progress === null
            ? null
            : {
                name: progress.next.name,
                spentLeft: progress.spentLeft,
                visitsLeft: progress.visitsLeft,
              },
      }
    })

    return {
      totalPoints: memberships.reduce((sum, membership) => sum + membership.points, 0),
      memberships,
      vouchers: await this.vouchers(guestId),
    }
  }

  /**
   * Непотраченные промокоды гостя.
   *
   * ИЗОЛЯЦИЮ ДЕРЖИТ БАЗА, А НЕ ЭТОТ ЗАПРОС. Гостевой контур RLS отдаёт
   * промокоды по объявленному `app.guest_id` — и заодно акции, по которым
   * они выданы (миграция 20260909200000, политики `guest_grants`
   * и `guest_offers`). Поэтому здесь нет ни перебора заведений, ни фильтра
   * по тенанту: их отсутствие — не упущение, а следствие того, что границу
   * стережёт не код.
   *
   * ПОГАШЕННЫЕ И ПРОСРОЧЕННЫЕ НЕ ПОКАЗЫВАЕМ. Кошелёк отвечает на вопрос
   * «что я могу получить сейчас». Просроченный код в списке — это обещание,
   * которое не выполнят у стойки.
   */
  private async vouchers(guestId: string): Promise<WalletVoucher[]> {
    const now = new Date()

    // Язык гостя читается здесь, а не передаётся сверху: он нужен ТОЛЬКО
    // для текстов подарка, и тащить его через кошелёк значило бы связать
    // два независимых куска ради одного поля.
    const { rows, locale } = await this.prisma.forGuest(guestId, async (tx) => {
      const guest = await tx.guest.findFirst({ where: { id: guestId }, select: { locale: true } })

      const grants = await tx.offerGrant.findMany({
        where: { guestId, state: 'ISSUED', expiresAt: { gt: now } },
        select: {
          id: true,
          offerId: true,
          tenantId: true,
          code: true,
          expiresAt: true,
          offer: { select: { i18n: true } },
          tenant: { select: { brandName: true } },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      })

      return { rows: grants, locale: guest?.locale ?? 'ru' }
    })

    // Сгорающие первыми — сверху: гость должен успеть воспользоваться тем,
    // что истекает раньше, а не тем, что выдали позже.
    return rows.map((row) => ({
      grantId: row.id,
      offerId: row.offerId,
      tenantId: row.tenantId,
      venue: row.tenant.brandName,
      title: offerTitle(row.offer.i18n, locale),
      code: row.code,
      expiresAt: row.expiresAt.toISOString(),
      expiresInDays: daysUntil(row.expiresAt, now),
      howTo: [...offerHowTo(row.offer.i18n, locale)],
    }))
  }

  // Не async: подпись токена синхронная, а пустой async обещает ожидание,
  // которого нет. Promise в сигнатуре контроллера это не ломает.
  qrToken(): GuestQrToken {
    const guestId = currentGuestId()

    return {
      token: signGuestQrToken({ guestId }, getEnv().accessTokenSecret, QR_TTL_SECONDS),
      expiresIn: QR_TTL_SECONDS,
    }
  }
}
