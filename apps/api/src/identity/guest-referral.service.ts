import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import type { AcceptReferralResult, GuestReferral, ReferralConfig } from '@positive/contracts'
import { NO_REFERRAL_LEVELS, ProgramConfig, REFERRAL_CODE_LENGTH } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'
import { REFERRAL_REWARD_KEY_PREFIX } from '../core/referral-shares'
import { isUniqueViolation, randomCode } from '../core/random-code'
import { currentGuestId } from './current-guest'

/**
 * «Пригласить друга» в приложении гостя. docs/02, раздел 2.5 · docs/11, У6.
 *
 * ДВА КОНТУРА RLS, И ЭТО НАМЕРЕННО. Своё участие гость читает гостевым контуром:
 * так он не узнает код заведения, где ни разу не был. Счётчики друзей и запись
 * нового участия — тенантным: гостевой контур чужих участий не отдаёт и писать
 * их не даёт. Заведение из адреса проверяется самой базой — нет участия или кода
 * в этом заведении, нет и ответа.
 *
 * ВСТУПЛЕНИЕ ПО ССЫЛКЕ — ЭТО ТОЛЬКО ПОМЕТКА. Друг становится гостем заведения
 * с источником «по приглашению» и ссылкой на пригласившего. Баллы пригласивший
 * получит, когда друг купит (core/membership-rules.service.ts).
 */

const INVITE_NOT_FOUND = {
  error: {
    code: 'INVITE_NOT_FOUND',
    message: 'Приглашение не найдено или больше не действует',
  },
}

/** Попыток выдать уникальный код. На алфавите из 31 знака совпадение — редкость. */
const CODE_ATTEMPTS = 5

const referralOf = (settings: unknown): ReferralConfig | null => {
  const program = ProgramConfig.safeParse(settings ?? {})
  return program.success ? program.data.referral : null
}

@Injectable()
export class GuestReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async referral(tenantId: string): Promise<GuestReferral> {
    const guestId = currentGuestId()

    const own = await this.prisma.forGuest(guestId, async (tx) =>
      tx.membership.findFirst({
        where: { guestId, tenantId },
        select: {
          id: true,
          referralCode: true,
          isControlGroup: true,
          tenant: { select: { brandName: true, settings: true } },
        },
      }),
    )

    if (own === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Вы ещё не гость этого заведения' },
      })
    }

    const referral = referralOf(own.tenant.settings)
    // Контрольной группе баллов не положено — ссылка, которая ничего не принесёт,
    // хуже отсутствующей.
    // Приглашать есть смысл, если программа хоть что-то даёт: разовую награду
    // или процент с покупок друзей.
    const program =
      referral !== null &&
      referral.enabled &&
      (referral.reward > 0 || referral.levels.some((pct) => pct > 0)) &&
      !own.isControlGroup
        ? referral
        : null

    const code =
      program === null ? null : (own.referralCode ?? (await this.issueCode(tenantId, own.id)))

    const [invited, rewarded] = await this.prisma.forTenant(tenantId, async (tx) =>
      Promise.all([
        tx.membership.count({ where: { tenantId, referredById: own.id } }),
        tx.ledgerEntry.count({
          where: {
            tenantId,
            membershipId: own.id,
            type: 'GRANT',
            refType: 'referral',
            idempotencyKey: { startsWith: REFERRAL_REWARD_KEY_PREFIX },
          },
        }),
      ]),
    )

    return {
      tenantId,
      brandName: own.tenant.brandName,
      enabled: program !== null,
      code,
      reward: program?.reward ?? 0,
      limit: program?.limit ?? 0,
      levels: program?.levels ?? [...NO_REFERRAL_LEVELS],
      invited,
      rewarded,
    }
  }

  /**
   * Друг открыл ссылку и вошёл. Повторное нажатие и гонка двух вкладок безопасны:
   * второе вступление упирается в «участие уже есть».
   */
  async accept(tenantId: string, code: string): Promise<AcceptReferralResult> {
    const guestId = currentGuestId()

    try {
      return await this.join(tenantId, guestId, code)
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }

      // Вторая вкладка успела первой — теперь участие есть, и ответ «уже гость».
      return this.join(tenantId, guestId, code)
    }
  }

  private async join(
    tenantId: string,
    guestId: string,
    code: string,
  ): Promise<AcceptReferralResult> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const inviter = await tx.membership.findFirst({
        where: { tenantId, referralCode: code },
        select: {
          id: true,
          guestId: true,
          tenant: { select: { brandName: true, settings: true } },
        },
      })

      const referral = inviter === null ? null : referralOf(inviter.tenant.settings)

      if (inviter === null || referral === null || !referral.enabled) {
        throw new NotFoundException(INVITE_NOT_FOUND)
      }

      if (inviter.guestId === guestId) {
        throw new ConflictException({
          error: {
            code: 'SELF_REFERRAL',
            message: 'Свою ссылку можно только отправить друзьям',
          },
        })
      }

      const brandName = inviter.tenant.brandName

      const existing = await tx.membership.findFirst({
        where: { tenantId, guestId },
        select: { id: true },
      })

      // Уже гость заведения — пригласившим его не назначить: пришёл он не по ссылке.
      if (existing !== null) {
        return { tenantId, brandName, joined: false }
      }

      await tx.membership.create({
        data: { guestId, tenantId, source: 'REFERRAL', referredById: inviter.id },
      })

      return { tenantId, brandName, joined: true }
    })
  }

  /**
   * Код появляется при первом открытии «Пригласить друга», а не при вступлении:
   * большинству гостей он так и не понадобится.
   *
   * Запись условная: два одновременных открытия не выдадут гостю два кода — второе
   * прочитает код первого. Совпадение с чужим кодом того же заведения упирается
   * в уникальность, и код выбирается заново.
   */
  private async issueCode(tenantId: string, membershipId: string): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const candidate = randomCode(REFERRAL_CODE_LENGTH)

      try {
        const code = await this.prisma.forTenant(tenantId, async (tx) => {
          await tx.membership.updateMany({
            where: { id: membershipId, tenantId, referralCode: null },
            data: { referralCode: candidate },
          })

          const row = await tx.membership.findFirst({
            where: { id: membershipId, tenantId },
            select: { referralCode: true },
          })

          return row?.referralCode ?? null
        })

        if (code !== null) {
          return code
        }
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error
        }
      }
    }

    throw new InternalServerErrorException({
      error: {
        code: 'REFERRAL_CODE_UNAVAILABLE',
        message: 'Не получилось выдать код приглашения — попробуйте ещё раз',
      },
    })
  }
}
