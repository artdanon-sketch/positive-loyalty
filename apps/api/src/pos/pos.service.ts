import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CommitResult, PosGuest, PreviewResult } from '@positive/contracts'
import { parseProgramConfig } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { LedgerService } from '../core/ledger.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Касса: найти гостя, посчитать, провести.
 * docs/02, раздел 3.
 *
 * ГРАНИЦА ЭТОГО КУСКА. Предрасчёт считает только базовые ставки из настроек
 * заведения. Акции, ваучеры, штампы и награда сотруднику в расчёт не входят —
 * их механики ещё нет (Срезы 3 и 5). Поля `appliedOffers` и `skippedOffers`
 * из ТЗ не возвращаются пустыми, а отсутствуют: пустой список означал бы
 * «искали и не нашли», и кассир объяснял бы гостю несуществующее правило.
 */

/** docs/02, раздел 3.3: PREVIEW_EXPIRED — прошло больше десяти минут. */
const PREVIEW_TTL_MINUTES = 10

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Поиск гостя по телефону.
   *
   * ВАЖНОЕ СЛЕДСТВИЕ ИЗОЛЯЦИИ. Политика RLS показывает гостя только тому
   * заведению, где у него уже есть участие. Гость, который на этой кассе
   * впервые, отсюда НЕ виден — и это правильно: иначе по телефону перебиралась
   * бы клиентская база всего острова.
   *
   * Значит, оформление гостя, впервые пришедшего в это заведение, — отдельный
   * поток: гость регистрируется сам (OTP в гостевом приложении) и предъявляет
   * свой код. Этот поток ждёт выбора SMS-провайдера и здесь не реализован.
   * Ручной поиск по телефону работает для тех, кто уже участник.
   */
  async findGuestByPhone(phone: string): Promise<PosGuest> {
    const { tenantId } = TenantContext.getOrThrow()

    const config = await this.loadConfig(tenantId)

    if (!config.cashierRules.allowManualEntry) {
      // Запрет ручного ввода — антифрод-настройка: без неё кассир оформляет
      // гостей по чужим номерам и собирает награду за «новых» (docs/05, раздел 6.1).
      throw new BadRequestException({
        error: {
          code: 'MANUAL_ENTRY_DISABLED',
          message: 'Ручной ввод номера отключён в настройках программы',
        },
      })
    }

    const found = await this.prisma.forTenant(tenantId, async (tx) => {
      const guest = await tx.guest.findFirst({ where: { phoneE164: phone } })
      if (guest === null) {
        return null
      }

      const membership = await tx.membership.findFirst({
        where: { guestId: guest.id, tenantId },
      })
      if (membership === null) {
        return null
      }

      return { guest, membership }
    })

    if (found === null) {
      // 404 одинаково на «нет такого гостя» и «есть, но не ваш»: различие
      // превратило бы кассу в способ проверять чужую клиентскую базу.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    const { guest, membership } = found

    return {
      guestId: guest.id,
      membershipId: membership.id,
      displayName: guest.displayName,
      isNew: membership.visitsTotal === 0,
      mode: guest.mode,
      points: membership.pointsBalance,
      visitsTotal: membership.visitsTotal,
      avgCheck:
        membership.visitsTotal > 0
          ? Math.round(membership.spentTotal / membership.visitsTotal)
          : null,
      isControlGroup: membership.isControlGroup,
    }
  }

  /**
   * Предрасчёт: что произойдёт, если чек провести.
   *
   * Ничего не меняет. Записывает намерение, по которому потом проводят коммит.
   */
  async preview(input: {
    membershipId: string
    amount: number
    redeemRequested: number
    receiptNumber?: string | undefined
    locationId?: string | undefined
  }): Promise<PreviewResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()
    const config = await this.loadConfig(tenantId)

    if (config.cashierRules.requireReceiptNumber && input.receiptNumber === undefined) {
      throw new BadRequestException({
        error: {
          code: 'RECEIPT_REQUIRED',
          message: 'Введите номер чека — этого требуют настройки программы',
        },
      })
    }

    const cap = config.cashierRules.maxManualAmount
    if (cap !== null && input.amount > cap) {
      throw new BadRequestException({
        error: {
          code: 'AMOUNT_ABOVE_CAP',
          message: 'Сумма выше потолка для кассира — позовите менеджера',
        },
      })
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: input.membershipId, tenantId },
      })

      if (membership === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Участие не найдено' },
        })
      }

      // Потолок списания: доля чека из настроек, но не больше того, что есть.
      // Округление вниз: в пользу заведения, потому что баллы — обязательство.
      const rateCap = Math.floor((input.amount * config.baseRedeemRate) / 100)
      const maxRedeemable = Math.max(0, Math.min(rateCap, membership.pointsBalance))
      const redeem = Math.min(input.redeemRequested, maxRedeemable)
      const amountToPay = input.amount - redeem

      // Контрольная группа не получает баллы — на этом держится доказательство
      // эффекта программы (docs/01, раздел 4.2). Списывать ей тоже нечего.
      const pointsToEarn = membership.isControlGroup
        ? 0
        : // Начисляем от суммы, реально уплаченной деньгами: начислять на часть,
          // оплаченную баллами, значит платить проценты на собственный долг.
          Math.floor((amountToPay * config.baseEarnRate) / 100)

      const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000)

      const created = await tx.transactionPreview.create({
        data: {
          tenantId,
          membershipId: membership.id,
          guestId: membership.guestId,
          amount: input.amount,
          redeemRequested: input.redeemRequested,
          redeem,
          pointsToEarn,
          amountToPay,
          balanceAtPreview: membership.pointsBalance,
          receiptNumber: input.receiptNumber ?? null,
          locationId: input.locationId ?? null,
          staffId: actorId,
          expiresAt,
        },
      })

      return {
        previewId: created.id,
        expiresAt: expiresAt.toISOString(),
        amount: input.amount,
        maxRedeemable,
        redeem,
        amountToPay,
        pointsToEarn,
        balanceAtPreview: membership.pointsBalance,
      }
    })
  }

  /**
   * Проведение чека.
   *
   * ИДЕМПОТЕНТНОСТЬ ДЕРЖИТСЯ НА `receiptId`, А НЕ НА ЗАГОЛОВКЕ. Заголовок
   * `Idempotency-Key` защищает от повтора HTTP-запроса, но касса, потерявшая
   * связь, часто шлёт повтор с НОВЫМ ключом — а чек тот же. Ключом в журнале
   * становится идентификатор чека: он один и тот же у любых повторов
   * (docs/01, раздел 4.4, пункт 4).
   */
  async commit(input: {
    previewId: string
    receiptId: string
    paidBy?: string | undefined
  }): Promise<CommitResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()

    const preview = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.transactionPreview.findFirst({ where: { id: input.previewId, tenantId } }),
    )

    if (preview === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Предрасчёт не найден' },
      })
    }

    if (preview.expiresAt <= new Date()) {
      throw new BadRequestException({
        error: {
          code: 'PREVIEW_EXPIRED',
          message: 'Предрасчёт устарел — пересчитайте сумму',
        },
      })
    }

    // Баланс мог измениться: гость потратил баллы в соседнем заведении сети,
    // пока кассир пробивал чек. Списывать по устаревшему расчёту нельзя.
    const balanceNow = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: preview.membershipId, tenantId },
        select: { pointsBalance: true },
      })
      return membership?.pointsBalance ?? null
    })

    if (balanceNow === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Участие не найдено' },
      })
    }

    if (balanceNow !== preview.balanceAtPreview) {
      throw new BadRequestException({
        error: {
          code: 'BALANCE_CHANGED',
          message: 'Баланс гостя изменился, пересчитайте предрасчёт',
          details: { expected: preview.balanceAtPreview, actual: balanceNow },
        },
      })
    }

    const scope = { tenantId }
    const origin = {
      source: 'STAFF_MANUAL' as const,
      actorType: 'STAFF' as const,
      ...(actorId === null ? {} : { actorId }),
      ...(preview.locationId === null ? {} : { locationId: preview.locationId }),
    }

    let replayed = false
    let redeemed = 0
    let earned = 0
    let newBalance = balanceNow
    // Идентификатором операции служит первая созданная строка журнала:
    // выдумывать отдельный uuid, которого нет ни в одной таблице, значит
    // отдать кассе ссылку в никуда.
    let transactionId: string | null = null

    if (preview.redeem > 0) {
      const result = await this.ledger.redeem(
        {
          membershipId: preview.membershipId,
          amount: preview.redeem,
          basisAmount: preview.amount,
          idempotencyKey: `pos:redeem:${input.receiptId}`,
          // Операции чека связываются номером чека — так задано в docs/01,
          // раздел 4.4: refType принимает receipt | offer_grant | referral | promo.
          // Отдельная сущность «транзакция» не нужна: чек и есть транзакция,
          // а отмена находит обе строки по одному refId.
          refType: 'receipt',
          refId: input.receiptId,
          ...origin,
        },
        scope,
      )
      replayed = replayed || result.replayed
      redeemed = preview.redeem
      newBalance = result.entry.balanceAfter
      transactionId = result.entry.id
    }

    if (preview.pointsToEarn > 0) {
      const result = await this.ledger.earn(
        {
          membershipId: preview.membershipId,
          amount: preview.pointsToEarn,
          basisAmount: preview.amountToPay,
          idempotencyKey: `pos:earn:${input.receiptId}`,
          // Операции чека связываются номером чека — так задано в docs/01,
          // раздел 4.4: refType принимает receipt | offer_grant | referral | promo.
          // Отдельная сущность «транзакция» не нужна: чек и есть транзакция,
          // а отмена находит обе строки по одному refId.
          refType: 'receipt',
          refId: input.receiptId,
          ...origin,
        },
        scope,
      )
      replayed = replayed || result.replayed
      earned = preview.pointsToEarn
      newBalance = result.entry.balanceAfter
      transactionId = transactionId ?? result.entry.id
    }

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.transactionPreview.updateMany({
        where: { id: preview.id, tenantId, committedAt: null },
        data: { committedAt: new Date() },
      })
    })

    if (transactionId === null) {
      // Ни списания, ни начисления: гость в контрольной группе и баллов ему
      // не полагается, а тратить нечего.
      //
      // ОТКРЫТЫЙ ВОПРОС, НЕ РЕШЁННЫЙ ЗДЕСЬ. Визит такого гостя нигде не
      // фиксируется: visitsTotal растёт только вместе с записью в журнале.
      // Но контрольная группа существует ровно для сравнения — и сравнивать
      // не с чем, если её визиты не считаются (docs/01, раздел 4.2).
      // Напрашивается запись журнала с нулевой суммой: «визит был, баллов нет».
      // Это меняет смысл нулевой операции, поэтому решение за владельцем схемы.
      throw new BadRequestException({
        error: {
          code: 'NOTHING_TO_RECORD',
          message: 'Операция не создана: гость в контрольной группе, начислять и списывать нечего',
        },
      })
    }

    return { transactionId, redeemed, earned, newBalance, replayed }
  }

  private async loadConfig(tenantId: string): Promise<ReturnType<typeof parseProgramConfig>> {
    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return parseProgramConfig(tenant.settings)
  }
}
