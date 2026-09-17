import { Injectable, NotFoundException } from '@nestjs/common'
import { TenantProfile, TenantProfileExtra } from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Профиль заведения. docs/02, раздел 5.6.7.
 *
 * ПОЛОВИНА ПОЛЕЙ — КОЛОНКИ, ПОЛОВИНА — НАСТРОЙКИ, и это не беспорядок: имя,
 * вид, часовой пояс и язык читает касса и отчёты на каждом запросе, а рассказ
 * о заведении и часы работы нужны одному экрану карты. Разделение уже было
 * в схеме — профиль его не ломает, а показывает владельцу как одно целое.
 *
 * НАСТРОЙКИ ПОДМЕШИВАЮТСЯ, А НЕ ПЕРЕЗАПИСЫВАЮТСЯ: в `Tenant.settings` лежат
 * статусы, проценты и мотивация кассиров. Сохранение профиля их не касается.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

@Injectable()
export class TenantProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<TenantProfile> {
    const { tenantId } = TenantContext.getOrThrow()

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          brandName: true,
          legalName: true,
          vertical: true,
          timezone: true,
          locale: true,
          settings: true,
        },
      }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'TENANT_NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    const raw = isRecord(tenant.settings) ? tenant.settings : {}
    // Незаполненный профиль читается пустым, а не падает: заведение заводится
    // раньше, чем владелец доходит до этого экрана.
    const extra = TenantProfileExtra.parse(isRecord(raw['profile']) ? raw['profile'] : {})

    return {
      brandName: tenant.brandName,
      legalName: tenant.legalName,
      vertical: tenant.vertical,
      timezone: tenant.timezone,
      locale: tenant.locale === 'ru' || tenant.locale === 'en' ? tenant.locale : 'th',
      ...extra,
      website: extra.website,
    }
  }

  async update(input: TenantProfile): Promise<TenantProfile> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const before = await this.get()

    await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      })

      const raw = isRecord(current?.settings) ? current.settings : {}

      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          brandName: input.brandName,
          legalName: input.legalName,
          vertical: input.vertical,
          timezone: input.timezone,
          locale: input.locale,
          settings: {
            ...raw,
            profile: {
              about: input.about,
              phone: input.phone,
              website: input.website,
              address: input.address,
              hours: input.hours,
            },
          },
        },
      })
    })

    await this.audit.write({
      action: 'TENANT_PROFILE_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      // Часовой пояс в истории — первое, что спросят, когда выручка за день
      // разойдётся с кассовой лентой.
      oldValue: { brandName: before.brandName, timezone: before.timezone },
      newValue: { brandName: input.brandName, timezone: input.timezone },
    })

    return this.get()
  }
}
