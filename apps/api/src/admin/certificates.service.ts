import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CERTIFICATES_MAX, CertificateOfferReward, offerTitle } from '@positive/contracts'
import type {
  CertificateTemplate,
  CreateCertificateInput,
  UpdateCertificateInput,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService } from '../core/audit.service'
import type { AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Шаблоны сертификатов. docs/02, раздел 5.11 · docs/11, У9.
 *
 * ШАБЛОН — АКЦИЯ ВИДА GIFT_CARD. Движок правил кассы её не видит (он берёт только
 * кэшбэк и акции на чек), список «Акции» — тоже: сертификат не кампания. Зато
 * выдача, погашение на кассе, кошелёк гостя и счётчики работают как у любого
 * промокода, без третьего способа дарить.
 *
 * ВЫКЛЮЧИТЬ, А НЕ УДАЛИТЬ. На шаблон ссылаются выданные промокоды: выключенный
 * не выдаётся, а выданные доживают свой срок. Выключение — пауза акции.
 */

type Tx = Prisma.TransactionClient

const HOW_TO = { ru: ['Покажите код на кассе'], en: ['Show the code at the till'] }

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CertificateTemplate[]> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.prisma.forTenant(tenantId, async (tx) => this.views(tx, tenantId, undefined))
  }

  async create(input: CreateCertificateInput): Promise<CertificateTemplate> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const created = await this.prisma.forTenant(tenantId, async (tx) => {
      const count = await tx.offer.count({ where: { tenantId, type: 'GIFT_CARD' } })

      if (count >= CERTIFICATES_MAX) {
        throw new BadRequestException({
          error: {
            code: 'TOO_MANY_CERTIFICATES',
            message: `Шаблонов сертификатов не может быть больше ${String(CERTIFICATES_MAX)}`,
          },
        })
      }

      const reward: CertificateOfferReward = {
        kind: 'CERTIFICATE',
        value: input.value,
        validityDays: input.validityDays,
      }

      const offer = await tx.offer.create({
        data: {
          tenantId,
          type: 'GIFT_CARD',
          status: 'LIVE',
          visibility: 'VENUE_ONLY',
          audience: {},
          schedule: {},
          limits: {},
          reward,
          i18n: { title: { ru: input.title, en: input.title }, howTo: HOW_TO },
        },
        select: { id: true },
      })

      const [view] = await this.views(tx, tenantId, offer.id)
      return view
    })

    if (created === undefined) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Сертификат не найден' } })
    }

    await this.audit.write({
      action: 'CERTIFICATE_CREATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Offer',
      entityId: created.id,
      newValue: { title: created.title, value: created.value, validityDays: created.validityDays },
    })

    return created
  }

  async update(id: string, input: UpdateCertificateInput): Promise<CertificateTemplate> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const [current] = await this.views(tx, tenantId, id)

      if (current === undefined) {
        // Чужой шаблон — 404, а не 403: по ответу не должно быть видно, что он есть.
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Сертификат не найден' },
        })
      }

      await tx.offer.updateMany({
        where: { id, tenantId, type: 'GIFT_CARD' },
        data: {
          ...(input.isActive === undefined ? {} : { status: input.isActive ? 'LIVE' : 'PAUSED' }),
          ...(input.title === undefined
            ? {}
            : { i18n: { title: { ru: input.title, en: input.title }, howTo: HOW_TO } }),
        },
      })

      const [updated] = await this.views(tx, tenantId, id)
      return { before: current, after: updated ?? current }
    })

    await this.audit.write({
      action: 'CERTIFICATE_UPDATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Offer',
      entityId: id,
      oldValue: { title: before.title, isActive: before.isActive },
      newValue: { title: after.title, isActive: after.isActive },
    })

    return after
  }

  /** Шаблоны со счётчиками. Шаблон с неразборчивой наградой пропускается, а не роняет список. */
  private async views(
    tx: Tx,
    tenantId: string,
    id: string | undefined,
  ): Promise<CertificateTemplate[]> {
    const offers = await tx.offer.findMany({
      where: { tenantId, type: 'GIFT_CARD', ...(id === undefined ? {} : { id }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, status: true, reward: true, i18n: true },
    })

    const counts =
      offers.length === 0
        ? []
        : await tx.offerGrant.groupBy({
            by: ['offerId', 'state'],
            where: { tenantId, offerId: { in: offers.map((offer) => offer.id) } },
            _count: { _all: true },
          })

    return offers.flatMap((offer): CertificateTemplate[] => {
      const reward = CertificateOfferReward.safeParse(offer.reward)

      if (!reward.success) {
        return []
      }

      const mine = counts.filter((row) => row.offerId === offer.id)

      return [
        {
          id: offer.id,
          title: offerTitle(offer.i18n, 'ru') ?? '',
          value: reward.data.value,
          validityDays: reward.data.validityDays,
          isActive: offer.status === 'LIVE',
          issued: mine.reduce((sum, row) => sum + row._count._all, 0),
          redeemed: mine
            .filter((row) => row.state === 'REDEEMED')
            .reduce((sum, row) => sum + row._count._all, 0),
        },
      ]
    })
  }
}
