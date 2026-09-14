import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { VenueVertical } from '@positive/contracts'
import type {
  CreateInviteInput,
  CreateInviteResult,
  InviteQuotaView,
  NetworkVenue,
  PartnerCatalog,
  PartnershipDetail,
  PartnershipList,
  PartnershipMessageView,
  PartnershipStatus,
  PartnershipSummary,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'
import { localDay } from './invite-day'

/**
 * Договориться: каталог сети, приглашение, ответ, расторжение, переписка.
 * docs/07, разделы 5, 6, 9.
 *
 * ─── ОДНА ПАРА — ОДНО ПАРТНЁРСТВО, В ОБЕ СТОРОНЫ ────────────────────────────
 *
 * Уникальность в базе стоит на паре (инициатор, партнёр) — то есть в одну
 * сторону: приглашения А→Б и Б→А она пропустила бы обе. Выражением-индексом
 * по «меньший, больший» это не закрыть: Prisma не умеет его описать, и первая
 * же следующая миграция предложила бы его удалить.
 *
 * Поэтому пару держит код — под транзакционной блокировкой на пару. Два
 * встречных приглашения, отправленных в одну секунду, выстраиваются в очередь,
 * и второе видит первое.
 *
 * ─── ЧТО ОСТАВЛЕНО НА ПОТОМ, И ЭТО НАДО ЗНАТЬ ──────────────────────────────
 *
 * Платных приглашений сверх квоты нет: биллинга заведений ещё нет, и 402
 * отвечает «на сегодня всё». Автоохлаждения за три отказа за неделю нет (П6).
 * Перевода переписки нет (П7): сообщение хранится с языком оригинала,
 * и переводчик сядет на это поле, ничего не меняя в схеме.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Повторное приглашение после отказа — не раньше (docs/07, раздел 6.2). */
const DECLINE_COOLDOWN_DAYS = 30

/** Сколько последних сообщений отдаётся с партнёрством. */
const MESSAGES_LIMIT = 100

/** Если админ платформы прайс не заводил — умолчания из docs/07, раздел 6. */
const DEFAULT_PRICING = { freeInvitesPerDay: 3, extraInvitePrice: 0, maxActivePartnerships: 20 }

/** Разговор идёт или условия действуют. */
const ALIVE: readonly PartnershipStatus[] = ['PROPOSED', 'NEGOTIATING', 'ACTIVE', 'PAUSED']

/** Приглашение принято, и ещё не завершено: можно писать и можно расторгнуть. */
const ENGAGED: readonly PartnershipStatus[] = ['NEGOTIATING', 'ACTIVE', 'PAUSED']

type Tx = Prisma.TransactionClient

interface VenueRow {
  id: string
  brandName: string
  vertical: string
  isOpen: boolean
  guestsApprox: number
}

const PARTNERSHIP_SELECT = {
  id: true,
  status: true,
  initiatorTenantId: true,
  partnerTenantId: true,
  proposedAt: true,
  acceptedAt: true,
  endsAt: true,
  endReason: true,
  terms: { where: { status: 'ACTIVE' }, select: { rewardTenantId: true } },
} satisfies Prisma.PartnershipSelect

type PartnershipRow = Prisma.PartnershipGetPayload<{ select: typeof PARTNERSHIP_SELECT }>

const MESSAGE_SELECT = {
  id: true,
  kind: true,
  fromTenantId: true,
  text: true,
  sourceLang: true,
  createdAt: true,
} satisfies Prisma.PartnershipMessageSelect

type MessageRow = Prisma.PartnershipMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

interface OfferToEnd {
  readonly offerId: string
  readonly tenantId: string
}

@Injectable()
export class PartnershipsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Каталог сети: с кем можно договориться.
   *
   * Сначала — дополняющие: ресторану проще договориться со спа и прокатом,
   * чем с соседним рестораном (docs/07, раздел 6.3). Заблокированные нами
   * заведения не показываются: владелец уже сказал, что не хочет их видеть.
   */
  async catalog(): Promise<PartnerCatalog> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const me = await selfOf(tx, tenantId)
      const venues = await tx.$queryRaw<VenueRow[]>`SELECT * FROM network_venues()`
      const rows = await tx.partnership.findMany({
        where: sidesOf(tenantId),
        select: { id: true, status: true, initiatorTenantId: true, partnerTenantId: true },
      })
      const blocks = await tx.inviteBlock.findMany({
        where: { blockerTenantId: tenantId },
        select: { blockedTenantId: true },
      })

      const blocked = new Set(blocks.map((block) => block.blockedTenantId))

      // Если у пары есть и завершённое, и живое партнёрство — показываем живое.
      const current = new Map<string, { id: string; status: PartnershipStatus }>()
      for (const row of rows) {
        const other = otherSide(row, tenantId)
        const known = current.get(other)

        if (known === undefined || (!ALIVE.includes(known.status) && ALIVE.includes(row.status))) {
          current.set(other, { id: row.id, status: row.status })
        }
      }

      const items: NetworkVenue[] = venues
        .filter((venue) => venue.isOpen && !blocked.has(venue.id))
        .map((venue) => ({
          tenantId: venue.id,
          brandName: venue.brandName,
          vertical: toVertical(venue.vertical),
          guestsApprox: venue.guestsApprox,
          partnership: current.get(venue.id) ?? null,
        }))
        .sort(
          (a, b) =>
            Number(a.vertical === me.vertical) - Number(b.vertical === me.vertical) ||
            a.brandName.localeCompare(b.brandName, 'ru'),
        )

      return { items }
    })
  }

  async quota(): Promise<InviteQuotaView> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const me = await selfOf(tx, tenantId)
      const pricing = await pricingFor(tx, me.vertical)
      const row = await tx.inviteQuota.findFirst({
        where: { tenantId, date: localDay(me.timezone, now) },
        select: { freeUsed: true },
      })

      return quotaView(pricing.freeInvitesPerDay, row?.freeUsed ?? 0)
    })
  }

  /**
   * Пригласить заведение к партнёрству.
   *
   * Проверки идут от дешёвых и понятных к дорогим, а квота списывается
   * ПОСЛЕДНЕЙ и в той же транзакции: приглашение, отбитое по любой причине,
   * бесплатного приглашения не съедает.
   */
  async invite(input: CreateInviteInput): Promise<CreateInviteResult> {
    const { tenantId } = TenantContext.getOrThrow()
    const partnerId = input.partnerTenantId
    const now = new Date()

    if (partnerId === tenantId) {
      throw new BadRequestException({
        error: { code: 'SELF_INVITE', message: 'Пригласить к партнёрству самих себя нельзя' },
      })
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      const [low, high] = [tenantId, partnerId].sort()
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partnership:${low ?? ''}:${high ?? ''}`}))`

      const [venue] = await tx.$queryRaw<VenueRow[]>`
        SELECT * FROM network_venues() WHERE id = ${partnerId}
      `

      if (venue === undefined || !venue.isOpen) {
        throw new NotFoundException({
          error: { code: 'PARTNER_NOT_FOUND', message: 'Такого заведения в сети нет' },
        })
      }

      const [check] = await tx.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT invite_blocked(${partnerId}) AS blocked
      `

      if (check?.blocked === true) {
        throw new ForbiddenException({
          error: {
            code: 'BLOCKED_BY_RECIPIENT',
            message: 'Это заведение не принимает приглашения от вас',
          },
        })
      }

      const existing = await tx.partnership.findMany({
        where: {
          OR: [
            { initiatorTenantId: tenantId, partnerTenantId: partnerId },
            { initiatorTenantId: partnerId, partnerTenantId: tenantId },
          ],
        },
        select: { id: true, status: true, initiatorTenantId: true, declinedAt: true },
        orderBy: [{ proposedAt: 'desc' }, { id: 'asc' }],
      })

      const alive = existing.find((row) => ALIVE.includes(row.status))

      if (alive !== undefined) {
        throw new ConflictException({
          error: {
            code: 'PARTNERSHIP_EXISTS',
            message: 'С этим заведением уже идёт разговор',
            details: { partnershipId: alive.id },
          },
        })
      }

      // Остывание — только когда отказали НАМ. Если это мы когда-то отказали
      // им, а теперь передумали, ждать месяц незачем.
      const refusal = existing.find(
        (row) =>
          row.status === 'DECLINED' &&
          row.initiatorTenantId === tenantId &&
          row.declinedAt !== null &&
          now.getTime() - row.declinedAt.getTime() < DECLINE_COOLDOWN_DAYS * DAY_MS,
      )

      if (refusal?.declinedAt != null) {
        throw new ConflictException({
          error: {
            code: 'INVITE_COOLDOWN',
            message: 'Это заведение недавно отказалось. Пригласить снова можно через месяц',
            details: {
              retryAfter: new Date(
                refusal.declinedAt.getTime() + DECLINE_COOLDOWN_DAYS * DAY_MS,
              ).toISOString(),
            },
          },
        })
      }

      const me = await selfOf(tx, tenantId)
      const pricing = await pricingFor(tx, me.vertical)

      const activeCount = await tx.partnership.count({
        where: { status: 'ACTIVE', ...sidesOf(tenantId) },
      })

      if (activeCount >= pricing.maxActivePartnerships) {
        throw new ConflictException({
          error: {
            code: 'PARTNERSHIP_LIMIT',
            message:
              'Действующих партнёрств уже максимум — гость не должен тонуть в чужих подарках',
            details: { limit: pricing.maxActivePartnerships },
          },
        })
      }

      // Мы сами когда-то заблокировали это заведение, а теперь приглашаем:
      // решение пересмотрено, и блокировка ему больше не соответствует.
      await tx.inviteBlock.deleteMany({
        where: { blockerTenantId: tenantId, blockedTenantId: partnerId },
      })

      const day = localDay(me.timezone, now)
      await tx.inviteQuota.upsert({
        where: { tenantId_date: { tenantId, date: day } },
        create: { tenantId, date: day },
        update: {},
      })

      // Условное обновление, а не «прочитать и записать»: два приглашения
      // в одну секунду не проскочат оба последнее бесплатное.
      const taken = await tx.inviteQuota.updateMany({
        where: { tenantId, date: day, freeUsed: { lt: pricing.freeInvitesPerDay } },
        data: { freeUsed: { increment: 1 } },
      })

      if (taken.count === 0) {
        throw new HttpException(
          {
            error: {
              code: 'INVITE_QUOTA_EXCEEDED',
              message: 'Бесплатные приглашения на сегодня закончились',
              details: { freeLeft: 0, extraPrice: pricing.extraInvitePrice, currency: 'THB' },
            },
          },
          HttpStatus.PAYMENT_REQUIRED,
        )
      }

      // Отклонённое или завершённое партнёрство этой пары не плодит вторую
      // строку, а начинается заново: история условий остаётся при нём.
      const reusable = existing.find((row) => row.initiatorTenantId === tenantId) ?? existing.at(0)

      const fresh = {
        initiatorTenantId: tenantId,
        partnerTenantId: partnerId,
        status: 'PROPOSED' as const,
        proposedAt: now,
        acceptedAt: null,
        declinedAt: null,
        endsAt: null,
        endedBy: null,
        endReason: null,
      }

      const partnership =
        reusable === undefined
          ? await tx.partnership.create({ data: fresh, select: { id: true } })
          : await tx.partnership.update({
              where: { id: reusable.id },
              data: fresh,
              select: { id: true },
            })

      await tx.partnershipMessage.create({
        data: {
          partnershipId: partnership.id,
          fromTenantId: tenantId,
          toTenantId: partnerId,
          kind: 'INVITE',
          text: input.text,
          sourceLang: me.locale,
          translations: {},
        },
      })

      const quota = await tx.inviteQuota.findFirst({
        where: { tenantId, date: day },
        select: { freeUsed: true },
      })

      return {
        partnershipId: partnership.id,
        quota: quotaView(pricing.freeInvitesPerDay, quota?.freeUsed ?? 0),
      }
    })
  }

  async list(status?: PartnershipStatus): Promise<PartnershipList> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const rows = await tx.partnership.findMany({
        where: { ...sidesOf(tenantId), ...(status === undefined ? {} : { status }) },
        select: PARTNERSHIP_SELECT,
        orderBy: [{ proposedAt: 'desc' }, { id: 'asc' }],
      })

      const venues =
        rows.length === 0 ? [] : await tx.$queryRaw<VenueRow[]>`SELECT * FROM network_venues()`
      const byId = new Map(venues.map((venue) => [venue.id, venue]))

      const items = rows
        .map((row) => toSummary(row, tenantId, byId.get(otherSide(row, tenantId))))
        .sort((a, b) => rank(a) - rank(b))

      return { items }
    })
  }

  async detail(id: string): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const row = await tx.partnership.findFirst({
        where: { id, ...sidesOf(tenantId) },
        select: PARTNERSHIP_SELECT,
      })

      if (row === null) {
        throw notFound()
      }

      const [venue] = await tx.$queryRaw<VenueRow[]>`
        SELECT * FROM network_venues() WHERE id = ${otherSide(row, tenantId)}
      `

      const recent = await tx.partnershipMessage.findMany({
        where: { partnershipId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MESSAGES_LIMIT,
        select: MESSAGE_SELECT,
      })

      const invited = row.partnerTenantId === tenantId
      const waiting = row.status === 'PROPOSED' && invited
      const engaged = ENGAGED.includes(row.status)

      return {
        ...toSummary(row, tenantId, venue),
        endReason: row.endReason,
        messages: recent.reverse().map((message) => toMessage(message, tenantId)),
        actions: {
          accept: waiting,
          decline: waiting,
          end: engaged,
          block: true,
          message: engaged,
        },
      }
    })
  }

  /** Приглашённый соглашается обсудить. Условия — отдельным шагом. */
  async accept(id: string): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await this.answerable(tx, tenantId, id)

      const moved = await tx.partnership.updateMany({
        where: { id, partnerTenantId: tenantId, status: 'PROPOSED' },
        data: { status: 'NEGOTIATING', acceptedAt: now },
      })

      if (moved.count === 0) {
        throw wrongState('Приглашение уже не ждёт ответа')
      }
    })

    return this.detail(id)
  }

  async decline(id: string, reason: string | undefined): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    await this.prisma.forTenant(tenantId, async (tx) => {
      await this.answerable(tx, tenantId, id)

      const moved = await tx.partnership.updateMany({
        where: { id, partnerTenantId: tenantId, status: 'PROPOSED' },
        data: { status: 'DECLINED', declinedAt: now, endedBy: tenantId, endReason: reason ?? null },
      })

      if (moved.count === 0) {
        throw wrongState('Приглашение уже не ждёт ответа')
      }
    })

    return this.detail(id)
  }

  /**
   * Расторгнуть партнёрство. Любая сторона, без согласия второй.
   *
   * Новые подарки перестают выдаваться сразу: условия завершаются в той же
   * транзакции, а слушатель триггеров берёт только действующие. Уже выданные
   * промокоды догорают до своего срока — погашение смотрит на промокод,
   * а не на акцию (docs/07, раздел 5, правило 3).
   */
  async end(id: string, reason: string | undefined): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    const offers = await this.prisma.forTenant(tenantId, async (tx) => {
      const row = await findOwn(tx, tenantId, id)

      if (!ENGAGED.includes(row.status)) {
        throw wrongState('Партнёрство уже не действует')
      }

      const moved = await tx.partnership.updateMany({
        where: { id, status: { in: [...ENGAGED] } },
        data: { status: 'ENDED', endsAt: now, endedBy: tenantId, endReason: reason ?? null },
      })

      if (moved.count === 0) {
        throw wrongState('Партнёрство уже не действует')
      }

      return stopTerms(tx, id)
    })

    await this.endOffers(offers)

    return this.detail(id)
  }

  /**
   * Заблокировать вторую сторону навсегда — абсолютный стоп (docs/07, раздел 6.2).
   *
   * Живое приглашение при этом закрывается: полученное — отказом, своё —
   * завершением. Действующее партнёрство расторгается так же, как по «Завершить».
   */
  async block(id: string, reason: string | undefined): Promise<PartnershipDetail> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    const offers = await this.prisma.forTenant(tenantId, async (tx) => {
      const row = await findOwn(tx, tenantId, id)
      const closing = { endedBy: tenantId, endReason: reason ?? null }

      await tx.inviteBlock.createMany({
        data: [
          {
            blockerTenantId: tenantId,
            blockedTenantId: otherSide(row, tenantId),
            reason: reason ?? null,
          },
        ],
        skipDuplicates: true,
      })

      if (row.status === 'PROPOSED') {
        await tx.partnership.update({
          where: { id },
          data:
            row.partnerTenantId === tenantId
              ? { status: 'DECLINED', declinedAt: now, ...closing }
              : { status: 'ENDED', endsAt: now, ...closing },
        })
        return []
      }

      if (ENGAGED.includes(row.status)) {
        await tx.partnership.update({
          where: { id },
          data: { status: 'ENDED', endsAt: now, ...closing },
        })
        return stopTerms(tx, id)
      }

      return []
    })

    await this.endOffers(offers)

    return this.detail(id)
  }

  async sendMessage(id: string, text: string): Promise<PartnershipMessageView> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => {
      const row = await findOwn(tx, tenantId, id)

      // До принятия писать может только приглашение — само приглашение.
      // Иначе отправитель заваливал бы получателя сообщениями, на которые
      // тот не соглашался.
      if (!ENGAGED.includes(row.status)) {
        throw wrongState('Писать можно, когда приглашение принято и партнёрство не завершено')
      }

      const me = await selfOf(tx, tenantId)
      const created = await tx.partnershipMessage.create({
        data: {
          partnershipId: id,
          fromTenantId: tenantId,
          toTenantId: otherSide(row, tenantId),
          kind: 'TEXT',
          text,
          sourceLang: me.locale,
          translations: {},
        },
        select: MESSAGE_SELECT,
      })

      return toMessage(created, tenantId)
    })
  }

  /** Ответить на приглашение может только приглашённый и только пока оно ждёт. */
  private async answerable(tx: Tx, tenantId: string, id: string): Promise<void> {
    const row = await findOwn(tx, tenantId, id)

    if (row.partnerTenantId !== tenantId) {
      throw new ForbiddenException({
        error: {
          code: 'NOT_RECIPIENT',
          message: 'Ответить на приглашение может только тот, кого пригласили',
        },
      })
    }

    if (row.status !== 'PROPOSED') {
      throw wrongState('Приглашение уже не ждёт ответа')
    }
  }

  /**
   * Завершить акции условий. Акция принадлежит дающему подарок, поэтому
   * и правится под его заведением, отдельной транзакцией на каждого.
   *
   * Если это упадёт, вреда нет: условия уже завершены, и новых подарков
   * по ним не будет. Статус акции — для отчётов, а не для выдачи.
   */
  private async endOffers(offers: readonly OfferToEnd[]): Promise<void> {
    const byTenant = new Map<string, string[]>()

    for (const offer of offers) {
      byTenant.set(offer.tenantId, [...(byTenant.get(offer.tenantId) ?? []), offer.offerId])
    }

    for (const [rewardTenantId, offerIds] of byTenant) {
      await this.prisma.forTenant(rewardTenantId, async (tx) =>
        tx.offer.updateMany({
          where: { id: { in: offerIds }, tenantId: rewardTenantId },
          data: { status: 'ENDED' },
        }),
      )
    }
  }
}

const sidesOf = (tenantId: string): Prisma.PartnershipWhereInput => ({
  OR: [{ initiatorTenantId: tenantId }, { partnerTenantId: tenantId }],
})

const otherSide = (
  row: { initiatorTenantId: string; partnerTenantId: string },
  tenantId: string,
): string => (row.initiatorTenantId === tenantId ? row.partnerTenantId : row.initiatorTenantId)

const findOwn = async (
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{
  id: string
  status: PartnershipStatus
  initiatorTenantId: string
  partnerTenantId: string
}> => {
  const row = await tx.partnership.findFirst({
    where: { id, ...sidesOf(tenantId) },
    select: { id: true, status: true, initiatorTenantId: true, partnerTenantId: true },
  })

  if (row === null) {
    throw notFound()
  }

  return row
}

/** Завершить все незавершённые условия и вернуть их акции. */
const stopTerms = async (tx: Tx, partnershipId: string): Promise<OfferToEnd[]> => {
  const live = await tx.partnershipTerm.findMany({
    where: { partnershipId, status: { not: 'ENDED' } },
    select: { offerId: true, rewardTenantId: true },
  })

  await tx.partnershipTerm.updateMany({
    where: { partnershipId, status: { not: 'ENDED' } },
    data: { status: 'ENDED' },
  })

  return live.flatMap((term) =>
    term.offerId === null ? [] : [{ offerId: term.offerId, tenantId: term.rewardTenantId }],
  )
}

const selfOf = async (
  tx: Tx,
  tenantId: string,
): Promise<{ vertical: VenueVertical; timezone: string; locale: string }> => {
  const me = await tx.tenant.findFirst({
    where: { id: tenantId },
    select: { vertical: true, timezone: true, locale: true },
  })

  if (me === null) {
    throw new InternalServerErrorException({
      error: { code: 'TENANT_NOT_FOUND', message: 'Заведение из токена не найдено' },
    })
  }

  return me
}

const pricingFor = async (
  tx: Tx,
  vertical: VenueVertical,
): Promise<{
  freeInvitesPerDay: number
  extraInvitePrice: number
  maxActivePartnerships: number
}> => {
  const rows = await tx.partnershipPricing.findMany({
    where: { OR: [{ vertical }, { vertical: null }] },
    select: {
      vertical: true,
      freeInvitesPerDay: true,
      extraInvitePrice: true,
      maxActivePartnerships: true,
    },
  })

  return (
    rows.find((row) => row.vertical === vertical) ??
    rows.find((row) => row.vertical === null) ??
    DEFAULT_PRICING
  )
}

const quotaView = (limit: number, used: number): InviteQuotaView => ({
  freeLimit: limit,
  freeUsed: used,
  freeLeft: Math.max(0, limit - used),
})

const toVertical = (value: string): VenueVertical => {
  const parsed = VenueVertical.safeParse(value)
  return parsed.success ? parsed.data : 'OTHER'
}

const toSummary = (
  row: PartnershipRow,
  tenantId: string,
  venue: VenueRow | undefined,
): PartnershipSummary => {
  const outgoing = row.initiatorTenantId === tenantId

  return {
    id: row.id,
    status: row.status,
    direction: outgoing ? 'OUTGOING' : 'INCOMING',
    partner: {
      tenantId: otherSide(row, tenantId),
      brandName: venue?.brandName ?? null,
      vertical: venue === undefined ? null : toVertical(venue.vertical),
    },
    proposedAt: row.proposedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    activeTerms: {
      weGive: row.terms.filter((term) => term.rewardTenantId === tenantId).length,
      theyGive: row.terms.filter((term) => term.rewardTenantId !== tenantId).length,
    },
  }
}

/** Порядок в списке: сначала ждёт нашего ответа, в конце — закрытое. */
const rank = (summary: PartnershipSummary): number => {
  switch (summary.status) {
    case 'PROPOSED':
      return summary.direction === 'INCOMING' ? 0 : 1
    case 'NEGOTIATING':
      return 2
    case 'ACTIVE':
      return 3
    case 'PAUSED':
      return 4
    case 'ENDED':
      return 5
    case 'DECLINED':
      return 6
  }
}

const toMessage = (row: MessageRow, tenantId: string): PartnershipMessageView => ({
  id: row.id,
  kind: row.kind,
  fromUs: row.fromTenantId === tenantId,
  text: row.text,
  sourceLang: row.sourceLang,
  createdAt: row.createdAt.toISOString(),
})

const notFound = (): NotFoundException =>
  new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Партнёрство не найдено' } })

const wrongState = (message: string): ConflictException =>
  new ConflictException({ error: { code: 'PARTNERSHIP_STATE', message } })
