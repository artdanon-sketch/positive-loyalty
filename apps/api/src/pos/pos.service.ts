import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import type {
  CommitResult,
  IssuedGrant,
  PosConfig,
  PosGuest,
  ProgramConfig,
  RedeemRewardInput,
  RedeemRewardResult,
  PosRewards,
  PosVoidResult,
  PreviewResult,
  RedeemGrantResult,
  ReversalReason,
  SaleKind,
  Tier,
} from '@positive/contracts'
import {
  ENGINE_OFFER_TYPES,
  OfferLimits,
  offerTitle,
  parseProgramConfig,
} from '@positive/contracts'
import { z } from 'zod'

import { verifyGuestQrToken } from '../common/tenant/access-token'
import { getEnv } from '../common/config/env'
import { AccessTokenInvalidError } from '../common/tenant/tenant.errors'
import { TenantContext } from '../common/tenant/tenant-context'
import { AlreadyReversedError, InsufficientBalanceError } from '../core/ledger.errors'
import { BirthdayService } from '../core/birthday.service'
import { LedgerService } from '../core/ledger.service'
import { MembershipRulesService } from '../core/membership-rules.service'
import { GrantRedeemError, OfferGrantService } from '../core/offer-grant.service'
import type { GrantView } from '../core/offer-grant.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { evaluateOffers } from '../rules/rules-engine'
import type { OfferCandidate, RulesOutcome } from '../rules/rules-engine'
import { checkout } from './checkout-math'

/**
 * Касса: найти гостя, посчитать, провести.
 * docs/02, раздел 3.
 *
 * АКЦИИ СЧИТАЕТ ДВИЖОК ПРАВИЛ (rules/rules-engine.ts): кэшбэк сверх базовой
 * ставки и промокод за чек. Предрасчёт запоминает применённые акции, проведение
 * выдаёт по ним промокоды, отмена чека аннулирует невостребованные.
 *
 * СКИДКА В САМОМ ЧЕКЕ — ТОЛЬКО РЕЖИМ ПРОГРАММЫ «СКИДКА ВМЕСТО БАЛЛОВ»
 * (checkout-math.ts). Скидочных акций и штампов в расчёте нет — их механик
 * ещё нет (Э1, Срез 5). Отложенный чек из
 * очереди планшета считается на момент отправки, а не продажи: акция «до 17:00»
 * для чека, пробитого в 16:50 и дошедшего в 17:10, не применится.
 */

/** docs/02, раздел 3.3: PREVIEW_EXPIRED — прошло больше десяти минут. */
const PREVIEW_TTL_MINUTES = 10

/** docs/02, раздел 3.5: окно отмены для кассира. Дальше — менеджер с комментарием. */
const VOID_WINDOW_MINUTES = 15

type Tx = Prisma.TransactionClient

/** Столько запущенных акций касса разбирает на чеке. Больше у малого заведения не бывает. */
const OFFER_CANDIDATES_LIMIT = 50

const NO_OFFERS: RulesOutcome = { applied: [], skipped: [], earnDelta: 0 }

/**
 * Снимок применённых акций в предрасчёте. Пишет его только этот сервис, но
 * читается он через схему: колонка JSON не обещает формы, а промокод, выданный
 * по кривому снимку, — это подарок, которого никто не обещал.
 */
const StoredOffers = z.array(
  z
    .object({
      offerId: z.uuid(),
      title: z.string().nullable(),
      earnDelta: z.number().int(),
      grantValidityDays: z.number().int().positive().nullable(),
    })
    .strict(),
)

/** Ключ промокода за чек: заведение, чек, акция. Повтор проведения попадает в тот же ключ. */
const grantKeyPrefix = (tenantId: string, receiptId: string): string =>
  `pos:grant:${tenantId}:${receiptId}:`

/** Запущенные акции заведения с числом уже выданных промокодов — всего и этому гостю. */
const loadOfferCandidates = async (
  tx: Tx,
  tenantId: string,
  guestId: string,
): Promise<OfferCandidate[]> => {
  const offers = await tx.offer.findMany({
    where: { tenantId, status: 'LIVE', type: { in: [...ENGINE_OFFER_TYPES] } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: OFFER_CANDIDATES_LIMIT,
    select: {
      id: true,
      type: true,
      priority: true,
      stackable: true,
      audience: true,
      schedule: true,
      limits: true,
      reward: true,
      i18n: true,
    },
  })

  if (offers.length === 0) {
    return []
  }

  const ids = offers.map((offer) => offer.id)
  // Последовательно, а не Promise.all: запросы одной интерактивной транзакции
  // Prisma всё равно выстраивает в очередь.
  const total = await tx.offerGrant.groupBy({
    by: ['offerId'],
    where: { tenantId, offerId: { in: ids } },
    _count: { _all: true },
  })
  const toGuest = await tx.offerGrant.groupBy({
    by: ['offerId'],
    where: { tenantId, offerId: { in: ids }, guestId },
    _count: { _all: true },
  })
  const count = (rows: typeof total, offerId: string): number =>
    rows.find((row) => row.offerId === offerId)?._count._all ?? 0

  return offers.map((offer) => ({
    id: offer.id,
    type: offer.type,
    priority: offer.priority,
    stackable: offer.stackable,
    title: offerTitle(offer.i18n, 'ru'),
    audience: offer.audience,
    schedule: offer.schedule,
    limits: offer.limits,
    reward: offer.reward,
    issued: { total: count(total, offer.id), toGuest: count(toGuest, offer.id) },
  }))
}

const tenantTimezone = async (tx: Tx, tenantId: string): Promise<string> => {
  const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } })
  return tenant?.timezone ?? 'Asia/Bangkok'
}

const guestMode = async (tx: Tx, guestId: string): Promise<'TOURIST' | 'RESIDENT'> => {
  const guest = await tx.guest.findFirst({ where: { id: guestId }, select: { mode: true } })
  return guest?.mode ?? 'TOURIST'
}

/**
 * Скидка проведённого чека. Отдельной колонки у предрасчёта нет, и она не нужна:
 * «к оплате» — это чек минус скидка минус баллы, значит скидка выводится обратно
 * без остатка. У чеков до режима скидки выходит ровно ноль.
 */
const discountOf = (preview: { amount: number; redeem: number; amountToPay: number }): number =>
  preview.amount - preview.redeem - preview.amountToPay

/** Статус на кассе: название и ставки, по которым считается этот чек. */
const tierBadge = (tier: Tier | null): PosGuest['tier'] =>
  tier === null
    ? null
    : { id: tier.id, name: tier.name, earnRate: tier.earnRate, redeemRate: tier.redeemRate }

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly grants: OfferGrantService,
    private readonly rules: MembershipRulesService,
    private readonly birthdays: BirthdayService,
  ) {}

  /**
   * Теги гостя для экрана кассы. docs/03, раздел 4.
   *
   * ПУСТОЙ СПИСОК, ПОКА ВЛАДЕЛЕЦ НЕ РАЗРЕШИЛ. Теги заводятся для бэк-офиса,
   * и среди них бывают «жалобщик» и «не давать скидку»: экран кассы гость
   * читает через плечо, и такой тег стоит дороже, чем помогает.
   */
  private async tagsFor(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    config: ProgramConfig,
  ): Promise<PosGuest['tags']> {
    if (!config.cashierRules.showGuestTags) {
      return []
    }

    const rows = await tx.guestTag.findMany({
      where: { tenantId, membershipId },
      orderBy: { createdAt: 'asc' },
      select: { tag: { select: { id: true, name: true, color: true } } },
    })

    return rows.map((row) => ({ id: row.tag.id, name: row.tag.name, color: row.tag.color }))
  }

  /**
   * Повесить гостю тег с кассы. docs/02, раздел 3.7.
   *
   * ТОЛЬКО ИЗ СПРАВОЧНИКА ЗАВЕДЕНИЯ: заводить новые теги отсюда нельзя, иначе
   * через месяц в справочнике будет «постоянный», «Постоянный!» и «пост».
   *
   * ПОВТОР — НЕ ОШИБКА: кассир нажал дважды, гость от этого не изменился.
   */
  async addTag(membershipId: string, tagId: string): Promise<PosGuest['tags']> {
    const { tenantId } = TenantContext.getOrThrow()
    const config = await this.loadConfig(tenantId)

    if (!config.cashierRules.showGuestTags || !config.cashierRules.allowTagging) {
      throw new ForbiddenException({
        error: { code: 'FORBIDDEN', message: 'Теги на кассе выключены в настройках' },
      })
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: { id: true },
      })

      if (membership === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Гость не найден' },
        })
      }

      const tag = await tx.tag.findFirst({ where: { id: tagId, tenantId }, select: { id: true } })

      if (tag === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Такого тега нет в справочнике' },
        })
      }

      await tx.guestTag.upsert({
        where: { membershipId_tagId: { membershipId, tagId } },
        create: { tenantId, membershipId, tagId },
        update: {},
      })

      return this.tagsFor(tx, tenantId, membershipId, config)
    })
  }

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

      const { tier } = await this.rules.tierFor(tx, tenantId, config, membership)
      const tags = await this.tagsFor(tx, tenantId, membership.id, config)

      return { guest, membership, tier, tags }
    })

    if (found === null) {
      // 404 одинаково на «нет такого гостя» и «есть, но не ваш»: различие
      // превратило бы кассу в способ проверять чужую клиентскую базу.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Гость не найден' },
      })
    }

    const { guest, membership, tier, tags } = found

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
      tier: tierBadge(tier),
      tags,
    }
  }

  /**
   * Поиск гостя по токену с его экрана. docs/02, раздел 3.1.
   *
   * Токен вида guest-qr, живёт пять минут; подпись проверяется тем же
   * секретом, что и всё остальное. Гость, впервые пришедший в ЭТО заведение,
   * оформляется прямо здесь: участие создаётся при первом сканировании —
   * гость уже согласился, показав код. Ровно этот случай ручной поиск по
   * телефону закрыть не может: RLS показывает только своих.
   */
  async findGuestByQrToken(token: string): Promise<PosGuest> {
    const { tenantId } = TenantContext.getOrThrow()

    let guestId: string
    try {
      guestId = verifyGuestQrToken(token, getEnv().accessTokenSecret).guestId
    } catch (error) {
      if (!(error instanceof AccessTokenInvalidError)) {
        throw error
      }
      // Просрочен или подделан — для кассы это одно и то же: код не читается,
      // гость обновит экран. Различать причины наружу нельзя.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Код не читается — попросите гостя обновить экран' },
      })
    }

    const config = await this.loadConfig(tenantId)

    const found = await this.prisma.forTenant(tenantId, async (tx) => {
      const guest = await tx.guest.findFirst({ where: { id: guestId } })

      const membership =
        (await tx.membership.findFirst({ where: { guestId, tenantId } })) ??
        (await tx.membership.create({
          data: { guestId, tenantId, source: 'ORGANIC' },
        }))

      // Гость может быть ещё не виден тенантному контуру (участие создано
      // этой же транзакцией — политика Guest смотрит на участия). Читаем
      // повторно уже после создания участия.
      const visibleGuest = guest ?? (await tx.guest.findFirst({ where: { id: guestId } }))

      if (visibleGuest === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Гость не найден' },
        })
      }

      const { tier } = await this.rules.tierFor(tx, tenantId, config, membership)
      const tags = await this.tagsFor(tx, tenantId, membership.id, config)

      return { guest: visibleGuest, membership, tier, tags }
    })

    const { guest, membership, tier, tags } = found

    // Приветственные баллы «при вступлении» — после транзакции: журнал пишет своей
    // транзакцией и участия, созданного в чужой незавершённой, не увидел бы.
    // Условие «визитов ещё нет» и один ключ на участие делают вызов безопасным
    // на каждом сканировании.
    const welcomed = await this.rules.grantWelcome(tenantId, membership, config, 'JOIN')
    // И подарок ко дню рождения, если окно открыто: баланс после него — последний.
    const celebrated = await this.birthdays.grantDueAt(tenantId, guestId)

    return {
      guestId: guest.id,
      membershipId: membership.id,
      displayName: guest.displayName,
      isNew: membership.visitsTotal === 0,
      mode: guest.mode,
      points: celebrated ?? welcomed ?? membership.pointsBalance,
      visitsTotal: membership.visitsTotal,
      avgCheck:
        membership.visitsTotal > 0
          ? Math.round(membership.spentTotal / membership.visitsTotal)
          : null,
      isControlGroup: membership.isControlGroup,
      tier: tierBadge(tier),
      tags,
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
    withoutDiscount?: boolean | undefined
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

      // Статус гостя заменяет базовые ставки — и в скидке, и в потолке оплаты
      // баллами, и в начислении. Сама арифметика — в checkout-math.ts.
      const { rates } = await this.rules.tierFor(tx, tenantId, config, membership)
      const { discount, maxRedeemable, redeem, amountToPay, basePoints } = checkout({
        amount: input.amount,
        redeemRequested: input.redeemRequested,
        balance: membership.pointsBalance,
        earnRate: rates.earnRate,
        redeemRate: rates.redeemRate,
        mode: config.mode,
        isControlGroup: membership.isControlGroup,
        withoutDiscount: input.withoutDiscount === true,
      })

      const now = new Date()
      const candidates = await loadOfferCandidates(tx, tenantId, membership.guestId)
      const outcome =
        candidates.length === 0
          ? NO_OFFERS
          : evaluateOffers(candidates, {
              amount: input.amount,
              amountToPay,
              at: now,
              timezone: await tenantTimezone(tx, tenantId),
              guest: {
                isNew: membership.visitsTotal === 0,
                mode: await guestMode(tx, membership.guestId),
                lastVisitAt: membership.lastVisitAt,
                isControlGroup: membership.isControlGroup,
              },
            })

      // Контрольная группа не получает баллы — на этом держится доказательство
      // эффекта программы (docs/01, раздел 4.2). Списывать ей тоже нечего.
      //
      // Кэшбэк акций — сверху и в режиме скидки тоже: акцию «+5 % баллами»
      // владелец заводит нарочно, и режим её не отменяет.
      const pointsToEarn = membership.isControlGroup ? 0 : basePoints + outcome.earnDelta

      const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MINUTES * 60_000)

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
          offers: outcome.applied.map((offer) => ({
            offerId: offer.offerId,
            title: offer.title,
            earnDelta: offer.earnDelta,
            grantValidityDays: offer.grantValidityDays,
          })),
        },
      })

      return {
        previewId: created.id,
        expiresAt: expiresAt.toISOString(),
        amount: input.amount,
        discount,
        maxRedeemable,
        redeem,
        amountToPay,
        pointsToEarn,
        balanceAtPreview: membership.pointsBalance,
        appliedOffers: outcome.applied.map((offer) => ({
          offerId: offer.offerId,
          title: offer.title,
          earnDelta: offer.earnDelta,
          discountDelta: offer.discountDelta,
          grantAfterPayment: offer.grantAfterPayment,
        })),
        skippedOffers: outcome.skipped,
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
   *
   * ПОВТОР ПРОВЕРЯЕТСЯ ПЕРВЫМ, ДО ЕДИНОЙ ПРОВЕРКИ СОСТОЯНИЯ. Иначе выходит
   * так: касса потеряла связь уже после того, как сервер провёл чек, и шлёт
   * повтор. Баланс к этому моменту изменился — самим же этим чеком, — и
   * проверка `BALANCE_CHANGED` отвергала повтор с требованием пересчитать
   * предрасчёт. Кассир при госте пересчитывал уже начисленное. То же самое
   * с `PREVIEW_EXPIRED`: чек проведён, а повтор через одиннадцать минут
   * получал отказ по устаревшему предрасчёту.
   *
   * Общее правило, из которого это следует: путь повтора не имеет права
   * заново проверять состояние, которое изменил первый вызов. Железное
   * правило 3 (CLAUDE.md) требует вернуть ПЕРВЫЙ ОТВЕТ, а не пересогласовать
   * операцию заново.
   */
  async commit(input: {
    previewId: string
    receiptId: string
    paidBy?: string | undefined
    saleKindId?: string | undefined
  }): Promise<CommitResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()

    const alreadyCommitted = await this.findCommittedReceipt(tenantId, input.receiptId)

    if (alreadyCommitted !== null) {
      return alreadyCommitted
    }

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

    await this.assertSaleKindBelongsHere(tenantId, input.saleKindId)

    // Баланс мог измениться: гость потратил баллы в соседнем заведении сети,
    // пока кассир пробивал чек. Списывать по устаревшему расчёту нельзя.
    const current = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.membership.findFirst({
        where: { id: preview.membershipId, tenantId },
        select: {
          id: true,
          pointsBalance: true,
          visitsTotal: true,
          isControlGroup: true,
          referredById: true,
        },
      }),
    )

    if (current === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Участие не найдено' },
      })
    }

    const balanceNow = current.pointsBalance

    // Настройки — до первой записи в журнал: сбой их чтения посреди чека оставил бы
    // списание без начисления.
    const config = await this.loadConfig(tenantId)

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
          ...(input.saleKindId === undefined ? {} : { saleKindId: input.saleKindId }),
          ...origin,
        },
        scope,
      )
      replayed = replayed || result.replayed
      redeemed = preview.redeem
      transactionId = result.entry.id
    }

    // Приветственные баллы за первую покупку — ДО начисления: снимок баланса в строке
    // начисления тогда уже включает подарок, и повтор чека вернёт тот же баланс,
    // что и первый ответ. Ключ подарка один на участие: «первый чек» после отмены
    // первого подарка не повторит.
    await this.rules.grantWelcome(tenantId, current, config, 'FIRST_PURCHASE')

    // Награда пригласившему — за первую покупку друга и тем же порядком: до начисления,
    // один ключ на участие друга (docs/05, раздел 6.2).
    await this.rules.grantReferral(tenantId, current, config)

    // Начисление пишется ВСЕГДА, даже нулевое. Ноль — это визит гостя из
    // контрольной группы: баллов не положено, но сам визит обязан попасть
    // в журнал, иначе группе не с чем сравнивать основную массу гостей —
    // а ради этого сравнения она и существует (docs/01, раздел 4.2).
    // Заодно у каждого чека гарантированно есть запись: transactionId не пуст,
    // счётчик визитов растёт ровно один раз, отмена чека возвращает и его.
    const earnOutcome = await (async () => {
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
          ...(input.saleKindId === undefined ? {} : { saleKindId: input.saleKindId }),
          ...origin,
        },
        scope,
      )
      replayed = replayed || result.replayed
      transactionId = transactionId ?? result.entry.id
      return result
    })()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.transactionPreview.updateMany({
        where: { id: preview.id, tenantId, committedAt: null },
        // Номер чека — чтобы повтор проведения нашёл этот предрасчёт и досоздал промокоды.
        data: { committedAt: new Date(), committedReceiptId: input.receiptId },
      })
    })

    // Статус — после чека: следующий чек гость пробивает уже по новым ставкам.
    await this.rules.refreshTier(tenantId, preview.membershipId, config)
    // Друг купил впервые — у пригласившего стало на одну рекомендацию больше.
    await this.rules.refreshInviterTier(tenantId, current, config)

    const grantsIssued = await this.issueCheckGrants(tenantId, preview, input.receiptId)

    if (transactionId === null) {
      // Недостижимо: запись начисления создаётся всегда, включая нулевую.
      // Ветка оставлена как страховка от будущего рефакторинга.
      throw new Error('Чек проведён без единой записи журнала — это ошибка логики')
    }

    // Начисление есть у каждого чека, поэтому итоговый баланс — его снимок,
    // а сумма начисления — ровно из предрасчёта, который и проводили.
    return {
      transactionId,
      redeemed,
      earned: preview.pointsToEarn,
      discount: discountOf(preview),
      newBalance: earnOutcome.entry.balanceAfter,
      replayed,
      grantsIssued,
    }
  }

  /**
   * Отмена проведённого чека. docs/02, раздел 3.5.
   *
   * `transactionId` — идентификатор ЛЮБОЙ записи чека (commit возвращает первую):
   * по нему находится номер чека, а по номеру — все его записи. Компенсируется
   * каждая, в порядке создания; списание и начисление отменяются парой.
   *
   * ОКНО И РОЛИ. Кассиру — 15 минут с момента операции, дальше только менеджер
   * или владелец, и только с комментарием. Комментарий менеджера обязателен
   * ВСЕГДА, не только после окна: его отмена не ограничена ничем, и без
   * объяснения неотличима от заметания следов.
   *
   * ПРОМОКОДЫ ЗА ЧЕК АННУЛИРУЮТСЯ ВМЕСТЕ С НИМ — невостребованные. Иначе «провести
   * и отменить» раздавало бы подарки без покупки.
   *
   * ЧЕГО ЗДЕСЬ НЕТ. Снятие награды сотруднику — механики ещё нет (Срез 5).
   * Комментарий уходит в лог с requestId;
   * постоянное хранилище — AuditLog — приедет со Срезом 5. Это учтённый долг,
   * а не забытая строчка.
   */
  async voidTransaction(
    transactionId: string,
    reason: ReversalReason,
    comment: string | undefined,
  ): Promise<PosVoidResult> {
    const { tenantId, role, actorId, requestId } = TenantContext.getOrThrow()

    const anchor = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findFirst({ where: { id: transactionId, tenantId } }),
    )

    if (anchor === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Операция не найдена' },
      })
    }

    if (anchor.refType !== 'receipt' || anchor.refId === null) {
      throw new BadRequestException({
        error: {
          code: 'NOT_A_RECEIPT',
          message: 'Отменять можно только операции, проведённые чеком',
        },
      })
    }

    const legs = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          tenantId,
          membershipId: anchor.membershipId,
          refType: 'receipt',
          refId: anchor.refId,
          type: { in: ['EARN', 'REDEEM'] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    )

    if (legs.length === 0) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Операция не найдена' },
      })
    }

    // ПОВТОР ОТМЕНЫ — ДО ПРОВЕРОК ПРАВ И ОКНА, по той же причине, что и в commit:
    // путь повтора не переспрашивает состояние, которое изменил первый вызов.
    // Кассир отменил чек на четырнадцатой минуте, связь оборвалась, планшет
    // повторил на шестнадцатой — и получал `VOID_WINDOW_EXPIRED` за работу,
    // которая уже сделана. Отмена целиком проведена, значит повтор обязан
    // вернуть её результат.
    const alreadyVoided = await this.findCompletedReversal(tenantId, transactionId, legs)

    if (alreadyVoided !== null) {
      // Первый вызов мог оборваться после компенсаций, но до промокодов.
      await this.voidCheckGrants(tenantId, anchor.refId)
      return alreadyVoided
    }

    const ageMs = Date.now() - (legs[0]?.createdAt.getTime() ?? 0)
    const isCashier = role === 'CASHIER'

    if (isCashier && ageMs > VOID_WINDOW_MINUTES * 60_000) {
      // 403, а не 404: операция своя и существует, не хватает именно прав.
      throw new ForbiddenException({
        error: {
          code: 'VOID_WINDOW_EXPIRED',
          message: 'Окно отмены кассира истекло — позовите менеджера',
        },
      })
    }

    if (!isCashier && (comment === undefined || comment.trim().length === 0)) {
      throw new BadRequestException({
        error: {
          code: 'COMMENT_REQUIRED',
          message: 'Отмена менеджером или владельцем — только с комментарием',
        },
      })
    }

    if (comment !== undefined) {
      // PII здесь нет: причина, номер чека и сквозной requestId.
      this.logger.log(
        `Отмена чека ${anchor.refId}: причина ${reason}, комментарий «${comment}», requestId ${requestId}`,
      )
    }

    const scope = { tenantId }
    const origin = {
      source: 'STAFF_MANUAL' as const,
      actorType: 'STAFF' as const,
      ...(actorId === null ? {} : { actorId }),
    }

    await this.voidCheckGrants(tenantId, anchor.refId)

    const reversals: Array<{ entryId: string; reversalId: string; amount: number }> = []
    let replayed = true

    for (const leg of legs) {
      try {
        const result = await this.ledger.reverse(
          {
            entryId: leg.id,
            // Ключ выводится из ключа исходной записи: повтор отмены того же
            // чека при любом числе ретраев попадает в те же ключи и получает
            // прежние компенсации, а не вторые.
            idempotencyKey: `pos:void:${leg.idempotencyKey}`,
            reason,
            ...(comment === undefined ? {} : { comment }),
            ...origin,
          },
          scope,
        )
        replayed = replayed && result.replayed
        reversals.push({
          entryId: leg.id,
          reversalId: result.entry.id,
          amount: result.entry.amount,
        })
      } catch (error) {
        if (!(error instanceof AlreadyReversedError)) {
          throw error
        }
        // Запись уже компенсирована другим путём (вручную из бэк-офиса).
        // Для кассы исход тот же — «чек отменён»: находим существующую
        // компенсацию и отвечаем как при повторе, а не пятисотим.
        const existing = await this.prisma.forTenant(tenantId, async (tx) =>
          tx.ledgerEntry.findFirst({ where: { tenantId, reversalOfId: leg.id } }),
        )
        if (existing === null) {
          throw error
        }
        reversals.push({ entryId: leg.id, reversalId: existing.id, amount: existing.amount })
      }
    }

    // Баланс читаем после всех компенсаций: порядок записей чека не обязан
    // совпадать с порядком компенсаций, «последняя строка цикла» — не истина.
    const balanceNow = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: anchor.membershipId, tenantId },
        select: { pointsBalance: true },
      })
      return membership?.pointsBalance ?? 0
    })

    return { transactionId, reversals, newBalance: balanceNow, replayed }
  }

  /**
   * Отмена, доведённая до конца: у каждой ноги чека уже есть своя компенсация.
   *
   * Частичной отмены здесь быть не должно — все ноги гасятся в одном проходе, —
   * но если первый вызов оборвался посередине, отмена не считается завершённой
   * и повтор идёт обычным путём, дописывая недостающие компенсации.
   */
  /**
   * Правила кассы этого заведения.
   *
   * Экран кассы обязан знать их до ввода: иначе поле номера чека подписано
   * «необязательно», кассир его пропускает, а сервер отвечает отказом —
   * при госте, который стоит у стойки.
   *
   * Наружу уходят ТОЛЬКО правила кассира. Ставки начисления, лестница статусов
   * и мотивация персонала остаются в бэк-офисе: касса ими не распоряжается,
   * а лишние поля в ответе — лишняя поверхность.
   */
  async config(): Promise<PosConfig> {
    const { tenantId } = TenantContext.getOrThrow()
    const { cashierRules } = await this.loadConfig(tenantId)

    // Справочник тегов едет на кассу только когда ими разрешено пользоваться:
    // иначе список тегов заведения читался бы кассиром без всякого повода.
    const tags =
      cashierRules.showGuestTags && cashierRules.allowTagging
        ? await this.prisma.forTenant(tenantId, async (tx) =>
            tx.tag.findMany({
              where: { tenantId },
              orderBy: { name: 'asc' },
              select: { id: true, name: true, color: true },
            }),
          )
        : []

    return {
      requireReceiptNumber: cashierRules.requireReceiptNumber,
      maxManualAmount: cashierRules.maxManualAmount,
      allowManualEntry: cashierRules.allowManualEntry,
      tags,
      // Что кассиру открыто на его экране — решает владелец в настройках.
      // Касса узнаёт это здесь, до того как нарисует вкладки: вкладка, ведущая
      // в отказ, хуже отсутствующей.
      showOwnHistory: cashierRules.showOwnHistory,
      showOwnStats: cashierRules.showOwnStats,
      allowInvite: cashierRules.allowInvite,
    }
  }

  /**
   * Что кассир может выбрать при проведении чека.
   *
   * ТОЛЬКО ВКЛЮЧЁННЫЕ. Выключенный вид остаётся в журнале ради истории, но
   * предлагать его к выбору значило бы, что выключатель работает только
   * в бэк-офисе, а на кассе — нет.
   *
   * Пустой список — норма, а не ошибка: справочник ведут не все заведения,
   * и до его появления не вёл никто. Касса в этом случае просто не показывает
   * выбор, а чек проводится как раньше.
   */
  async saleKinds(): Promise<SaleKind[]> {
    const { tenantId } = TenantContext.getOrThrow()

    const rows = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.saleKind.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sortOrder: true, isActive: true },
      }),
    )

    return rows
  }

  /**
   * Погашение промокода на кассе. docs/02, раздел 3.4.
   *
   * ПОЧЕМУ ЗДЕСЬ ТОНКО, А ВСЯ РАБОТА В OfferGrantService. Железное правило 6
   * (CLAUDE.md) требует, чтобы партнёрские награды гасились через тот же
   * сервис, что и обычные промокоды, без «отдельных партнёрских кодов».
   * Значит этот метод — дверь снаружи, а не вторая реализация погашения:
   * атомарность, порядок проверок и коды ошибок живут в одном месте.
   *
   * КОДЫ ОШИБОК ДОХОДЯТ ДО КАССЫ КАК ЕСТЬ. Кассир должен понимать, что
   * сказать гостю: «код уже погашен», «срок истёк» и «не то время суток» —
   * три разных разговора. Это сознательно иначе, чем во входе в панель
   * платформы, где все причины отказа слиты в одну: там ответ читает тот,
   * кто подбирает, здесь — тот, кто обслуживает.
   */
  /**
   * Выдать награду из каталога за баллы. docs/02, раздел 3.8.
   *
   * ДОСТАТОЧНОСТЬ ПРОВЕРЯЕТ ЖУРНАЛ, А НЕ ЭТОТ КОД. Проверка «хватает ли»
   * снаружи транзакции обгоняется параллельным списанием на второй кассе;
   * `ledger.redeem` делает её внутри и отказывает честно.
   *
   * ПОВТОР БЕЗОПАСЕН: ключ идемпотентности строится из `redemptionId`, который
   * придумывает касса. Планшет, отправивший запрос дважды из-за сети, спишет
   * баллы один раз.
   */
  /**
   * Награды за баллы, которые кассир может выдать этому гостю. docs/02, раздел 3.8.
   *
   * Чужое участие — 404, как и несуществующее: по ответу не узнать, что гость
   * где-то есть. «Хватает» — по балансу сейчас; окончательно решает журнал при
   * выдаче, потому что вторая касса может успеть списать раньше.
   */
  async rewards(membershipId: string): Promise<PosRewards> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: { pointsBalance: true },
      })

      if (membership === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Участие не найдено' },
        })
      }

      const items = await tx.catalogItem.findMany({
        where: { tenantId, isActive: true, pointsPrice: { not: null } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, pointsPrice: true, imageUrl: true },
      })

      return {
        balance: membership.pointsBalance,
        items: items.flatMap((item) =>
          item.pointsPrice === null
            ? []
            : [
                {
                  id: item.id,
                  name: item.name,
                  pointsPrice: item.pointsPrice,
                  imageUrl: item.imageUrl,
                  affordable: membership.pointsBalance >= item.pointsPrice,
                },
              ],
        ),
      }
    })
  }

  async redeemReward(input: RedeemRewardInput): Promise<RedeemRewardResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()

    const item = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.catalogItem.findFirst({
        where: { id: input.itemId, tenantId, isActive: true },
        select: { name: true, pointsPrice: true },
      }),
    )

    if (item === null || item.pointsPrice === null) {
      // Снятая с витрины позиция и позиция без цены в баллах — для кассы одно
      // и то же: выдавать нечего.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Такой награды нет на витрине' },
      })
    }

    try {
      const result = await this.ledger.redeem(
        {
          membershipId: input.membershipId,
          amount: item.pointsPrice,
          idempotencyKey: `pos:reward:${input.redemptionId}`,
          refType: 'catalog_item',
          refId: input.itemId,
          source: 'STAFF_MANUAL',
          actorType: 'STAFF',
          actorId: actorId ?? undefined,
        },
        { tenantId },
      )

      return {
        itemName: item.name,
        pointsSpent: item.pointsPrice,
        balanceAfter: result.entry.balanceAfter,
      }
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        throw new BadRequestException({
          error: { code: 'INSUFFICIENT_BALANCE', message: 'У гостя не хватает баллов' },
        })
      }

      throw error
    }
  }

  async redeemGrant(input: {
    code: string
    receiptId?: string | undefined
  }): Promise<RedeemGrantResult> {
    const { tenantId, actorId } = TenantContext.getOrThrow()
    const now = new Date()

    let grant
    try {
      grant = await this.grants.redeem({
        code: input.code,
        tenantId,
        redeemedBy: actorId,
        receiptId: input.receiptId ?? null,
        now,
      })
    } catch (error) {
      if (!(error instanceof GrantRedeemError)) {
        throw error
      }

      throw new BadRequestException({ error: { code: error.code, message: error.message } })
    }

    // Название читаем ОТДЕЛЬНЫМ запросом, а не внутри погашения: погашение
    // обязано быть коротким и атомарным, а название — украшение ответа.
    // Его отсутствие не повод откатывать уже погашенный код.
    const offer = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offer.findFirst({ where: { id: grant.offerId, tenantId }, select: { i18n: true } }),
    )

    return {
      grantId: grant.id,
      code: grant.code,
      offerId: grant.offerId,
      title: offer === null ? null : offerTitle(offer.i18n, 'ru'),
      redeemedAt: now.toISOString(),
      replayed: grant.replayed,
    }
  }

  private async findCompletedReversal(
    tenantId: string,
    transactionId: string,
    legs: readonly { id: string; membershipId: string }[],
  ): Promise<PosVoidResult | null> {
    const reversalEntries = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: { tenantId, reversalOfId: { in: legs.map((leg) => leg.id) } },
        select: { id: true, amount: true, reversalOfId: true },
      }),
    )

    const first = legs[0]

    // Пустой список сюда не приходит — выше он уже отсеян, — но проверяем
    // явно: `undefined` в `where` у Prisma значит «фильтр не применять», и
    // поиск участия ниже вернул бы ПРОИЗВОЛЬНОЕ участие заведения вместе
    // с чужим балансом. Ошибка молчаливая, поэтому дверь закрыта заранее.
    if (first === undefined || reversalEntries.length < legs.length) {
      return null
    }

    const byLeg = new Map(reversalEntries.map((entry) => [entry.reversalOfId, entry]))
    const reversals: Array<{ entryId: string; reversalId: string; amount: number }> = []

    for (const leg of legs) {
      const reversal = byLeg.get(leg.id)

      if (reversal === undefined) {
        return null
      }

      reversals.push({ entryId: leg.id, reversalId: reversal.id, amount: reversal.amount })
    }

    const balanceNow = await this.prisma.forTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: first.membershipId, tenantId },
        select: { pointsBalance: true },
      })
      return membership?.pointsBalance ?? 0
    })

    // `transactionId` отдаём тот же, что пришёл в запросе, — ровно как на
    // прямом пути: касса повторяет свой запрос и должна узнать свой ответ.
    return { transactionId, reversals, newBalance: balanceNow, replayed: true }
  }

  /**
   * Ищет уже проведённый чек и восстанавливает ответ, отданный в первый раз.
   *
   * Источник истины — сам журнал, а не предрасчёт: повтор может приехать
   * с другим `previewId` (касса пересчитала и отправила заново), и тогда суммы
   * из свежего предрасчёта разошлись бы с тем, что реально записано.
   *
   * Отмены (`REVERSAL`) намеренно не учитываются: у них тот же `refId`, но
   * отменённый чек — это по-прежнему проведённый чек, и повтор его проведения
   * обязан вернуть тот самый первый ответ. Отмена — отдельная операция со
   * своим ответом.
   */
  /**
   * Вид продажи обязан принадлежать этому заведению и быть включённым.
   *
   * ПРОВЕРКА НУЖНА ИМЕННО ЗДЕСЬ, А НЕ В БАЗЕ. Внешний ключ есть, но он
   * проверяет только существование строки — и делает это в обход политик RLS,
   * потому что проверка ссылочной целостности идёт от имени системы. То есть
   * кассир, подставивший в запрос идентификатор ЧУЖОГО вида продажи, получил бы
   * успешную запись: журнал заведения ссылался бы на справочник соседа.
   *
   * Выключенный вид отвергается по другой причине: заведение выключило его,
   * чтобы им перестали пользоваться. Разрешать выбирать его через API значило
   * бы, что выключатель работает только в интерфейсе.
   */
  private async assertSaleKindBelongsHere(
    tenantId: string,
    saleKindId: string | undefined,
  ): Promise<void> {
    if (saleKindId === undefined) {
      return
    }

    const kind = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.saleKind.findFirst({
        where: { id: saleKindId, tenantId, isActive: true },
        select: { id: true },
      }),
    )

    if (kind === null) {
      throw new BadRequestException({
        error: {
          code: 'SALE_KIND_NOT_FOUND',
          message: 'Вид продажи не найден или выключен',
        },
      })
    }
  }

  private async findCommittedReceipt(
    tenantId: string,
    receiptId: string,
  ): Promise<CommitResult | null> {
    const entries = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.ledgerEntry.findMany({
        where: {
          tenantId,
          refType: 'receipt',
          refId: receiptId,
          type: { in: ['EARN', 'REDEEM'] },
        },
        select: { id: true, type: true, amount: true, balanceAfter: true },
      }),
    )

    const earn = entries.find((entry) => entry.type === 'EARN')

    if (earn === undefined) {
      // Записей нет вовсе — чек новый. Либо есть списание без начисления:
      // первый вызов оборвался между двумя ногами чека. Второе — не повтор
      // завершённого чека, а недоведённый чек, и отдавать по нему готовый
      // ответ нельзя: начисление так и осталось бы ненаписанным. Пропускаем
      // на обычный путь — он допишет начисление, а списание там повторно
      // не создастся, ключ идемпотентности у него тот же.
      return null
    }

    const redeem = entries.find((entry) => entry.type === 'REDEEM')

    // Промокоды за чек: повтор возвращает выданные и досоздаёт недовыданные —
    // первый вызов мог оборваться между начислением и выдачей.
    const committed = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.transactionPreview.findFirst({
        where: { tenantId, committedReceiptId: receiptId },
        orderBy: [{ committedAt: 'desc' }, { id: 'asc' }],
        select: { guestId: true, offers: true, amount: true, redeem: true, amountToPay: true },
      }),
    )
    const grantsIssued =
      committed === null ? [] : await this.issueCheckGrants(tenantId, committed, receiptId)

    return {
      // Тот же порядок, что и на прямом пути: идентификатором операции служит
      // первая созданная строка — списание, если оно было, иначе начисление.
      transactionId: redeem?.id ?? earn.id,
      // В журнале списание хранится со знаком минус, наружу отдаётся модуль.
      redeemed: redeem === undefined ? 0 : Math.abs(redeem.amount),
      earned: earn.amount,
      discount: committed === null ? 0 : discountOf(committed),
      newBalance: earn.balanceAfter,
      replayed: true,
      grantsIssued,
    }
  }

  /**
   * Промокоды за чек — по акциям, применённым в предрасчёте. docs/03, раздел 4:
   * «генерируется по факту оплаты, не заранее».
   *
   * КЛЮЧ — ЗАВЕДЕНИЕ, ЧЕК И АКЦИЯ. Повтор проведения возвращает те же коды
   * и досоздаёт недовыданные: касса, потерявшая связь посреди выдачи, повторит
   * чек, и гость получит ровно один код за акцию.
   *
   * ЛИМИТЫ ПРОВЕРЯЮТСЯ ЕЩЁ РАЗ. Между предрасчётом и оплатой последний промокод
   * мог уйти другому гостю, а владелец — поставить акцию на паузу. Предрасчёт
   * обещал, проведение сверяет: не хватило — кода нет, и кассир видит это
   * на экране результата, а не гость в пустом кошельке.
   */
  private async issueCheckGrants(
    tenantId: string,
    preview: { guestId: string; offers: Prisma.JsonValue },
    receiptId: string,
  ): Promise<IssuedGrant[]> {
    const stored = StoredOffers.safeParse(preview.offers)

    if (!stored.success) {
      // Снимок пишет только предрасчёт этого же сервиса: не разобрался — значит
      // поломка кода, и молчать о ней нельзя. Баллы при этом уже начислены.
      this.logger.error(`Акции предрасчёта не разбираются: промокоды за чек ${receiptId} не выданы`)
      return []
    }

    const issued: IssuedGrant[] = []

    for (const offer of stored.data) {
      if (offer.grantValidityDays === null) {
        continue
      }

      const key = `${grantKeyPrefix(tenantId, receiptId)}${offer.offerId}`
      const grant =
        (await this.grants.findByIdempotencyKey(tenantId, key)) ??
        (await this.issueWithinLimits(
          tenantId,
          preview.guestId,
          offer.offerId,
          offer.grantValidityDays,
          key,
        ))

      if (grant !== null) {
        issued.push({
          grantId: grant.id,
          offerId: grant.offerId,
          title: offer.title,
          codeTail: grant.code.slice(-4),
          expiresAt: grant.expiresAt.toISOString(),
        })
      }
    }

    return issued
  }

  private async issueWithinLimits(
    tenantId: string,
    guestId: string,
    offerId: string,
    validityDays: number,
    key: string,
  ): Promise<GrantView | null> {
    const allowed = await this.prisma.forTenant(tenantId, async (tx) => {
      const offer = await tx.offer.findFirst({
        where: { id: offerId, tenantId },
        select: { status: true, limits: true },
      })

      if (offer === null || offer.status !== 'LIVE') {
        return false
      }

      const limits = OfferLimits.safeParse(offer.limits)
      const perGuest = limits.success ? limits.data.perGuestQty : null
      const total = limits.success ? limits.data.totalQty : null

      if (
        typeof perGuest === 'number' &&
        (await tx.offerGrant.count({ where: { offerId, guestId } })) >= perGuest
      ) {
        return false
      }

      if (
        typeof total === 'number' &&
        (await tx.offerGrant.count({ where: { offerId } })) >= total
      ) {
        return false
      }

      return true
    })

    return allowed
      ? this.grants.issue({
          offerId,
          guestId,
          tenantId,
          validityDays,
          idempotencyKey: key,
          now: new Date(),
        })
      : null
  }

  /**
   * Аннулировать невостребованные промокоды за чек. Погашенные остаются
   * погашенными: подарок уже отдан, и забрать его может разговор, а не кнопка.
   */
  private async voidCheckGrants(tenantId: string, receiptId: string | null): Promise<void> {
    if (receiptId === null) {
      return
    }

    await this.prisma.forTenant(tenantId, async (tx) =>
      tx.offerGrant.updateMany({
        where: {
          tenantId,
          state: 'ISSUED',
          nonce: { startsWith: grantKeyPrefix(tenantId, receiptId) },
        },
        data: { state: 'VOID' },
      }),
    )
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

    try {
      return parseProgramConfig(tenant.settings)
    } catch (error) {
      // Настройки заведения не разбираются схемой. Это не вина кассира и не
      // ошибка запроса: в базе лежит конфигурация, которую приложение прочитать
      // не может. Без этой ветки ZodError уходил в обработчик Nest по умолчанию
      // и превращался в «Internal server error» без кода и без подробностей —
      // касса вставала, а причина была видна только в логе сервера.
      //
      // Подробности пишем в лог (там их прочитает поддержка), наружу отдаём код,
      // по которому видно, куда идти чинить. Сами настройки в ответ не кладём:
      // это конфигурация заведения, а отвечаем мы устройству кассы.
      this.logger.error(
        `Настройки заведения ${tenantId} не проходят проверку контракта`,
        error instanceof Error ? error.stack : String(error),
      )

      throw new InternalServerErrorException({
        error: {
          code: 'TENANT_MISCONFIGURED',
          message: 'Настройки программы лояльности заведения повреждены. Обратитесь в поддержку.',
        },
      })
    }
  }
}
