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
  PosConfig,
  PosGuest,
  PosVoidResult,
  PreviewResult,
  ReversalReason,
  SaleKind,
} from '@positive/contracts'
import { parseProgramConfig } from '@positive/contracts'

import { verifyGuestQrToken } from '../common/tenant/access-token'
import { getEnv } from '../common/config/env'
import { AccessTokenInvalidError } from '../common/tenant/tenant.errors'
import { TenantContext } from '../common/tenant/tenant-context'
import { AlreadyReversedError } from '../core/ledger.errors'
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

/** docs/02, раздел 3.5: окно отмены для кассира. Дальше — менеджер с комментарием. */
const VOID_WINDOW_MINUTES = 15

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name)

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

    return this.prisma.forTenant(tenantId, async (tx) => {
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

      return {
        guestId: visibleGuest.id,
        membershipId: membership.id,
        displayName: visibleGuest.displayName,
        isNew: membership.visitsTotal === 0,
        mode: visibleGuest.mode,
        points: membership.pointsBalance,
        visitsTotal: membership.visitsTotal,
        avgCheck:
          membership.visitsTotal > 0
            ? Math.round(membership.spentTotal / membership.visitsTotal)
            : null,
        isControlGroup: membership.isControlGroup,
      }
    })
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
        data: { committedAt: new Date() },
      })
    })

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
      newBalance: earnOutcome.entry.balanceAfter,
      replayed,
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
   * ЧЕГО ЗДЕСЬ НЕТ. Аннулирование ваучеров и снятие награды сотруднику — их
   * механик ещё нет (Срезы 3 и 5). Комментарий уходит в лог с requestId;
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

    return {
      requireReceiptNumber: cashierRules.requireReceiptNumber,
      maxManualAmount: cashierRules.maxManualAmount,
      allowManualEntry: cashierRules.allowManualEntry,
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

    return {
      // Тот же порядок, что и на прямом пути: идентификатором операции служит
      // первая созданная строка — списание, если оно было, иначе начисление.
      transactionId: redeem?.id ?? earn.id,
      // В журнале списание хранится со знаком минус, наружу отдаётся модуль.
      redeemed: redeem === undefined ? 0 : Math.abs(redeem.amount),
      earned: earn.amount,
      newBalance: earn.balanceAfter,
      replayed: true,
    }
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
