import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { parseProgramConfig } from '@positive/contracts'
import type {
  BirthdaySettings,
  ProgramConfig,
  ProgramSettings,
  ReferralSettings,
  TierSettings,
} from '@positive/contracts'

import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { MembershipRulesService } from '../core/membership-rules.service'
import { PrismaService } from '../core/prisma.service'
import type { Prisma } from '../generated/prisma/client'

/**
 * Настройки программы: процент начисления, доля оплаты баллами, правила кассы.
 * docs/02, раздел 5.6.
 *
 * ─── ПОЧЕМУ ЭТОГО НЕ БЫЛО ──────────────────────────────────────────────────
 *
 * Настройки программы описаны в контракте полностью и читаются кассой на каждом
 * чеке — но записать их было нечем, кроме демо-скрипта. Владелец реального
 * заведения работал на пяти процентах начисления, потому что другого варианта
 * у него не было.
 *
 * ─── ПОДМЕШИВАЕМ, А НЕ ПЕРЕЗАПИСЫВАЕМ ──────────────────────────────────────
 *
 * В `Tenant.settings` лежит больше трёх полей: статусы, приветственные баллы,
 * мотивация персонала. Этот сервис меняет ровно три — остальные ключи сохраняются
 * такими, какими были. Перезапись целиком стёрла бы статусы, заведённые
 * при подключении, одним нажатием «Сохранить» на другом экране.
 *
 * Пишется СЫРОЙ объект с подмешанными полями, а не разобранный конфиг: разбор
 * дописывает значения по умолчанию, и в базу уехали бы «сегодняшние умолчания»
 * для полей, которых владелец не касался. Когда умолчание однажды поменяется,
 * такие заведения молча остались бы на старом.
 *
 * ─── ИТОГ ПРОВЕРЯЕТСЯ ТОЙ ЖЕ СХЕМОЙ, ПО КОТОРОЙ ЧИТАЕТ КАССА ────────────────
 *
 * Перед записью подмешанный объект целиком прогоняется через parseProgramConfig —
 * ту же функцию, что вызывает касса. Сохранить то, на чём касса упадёт на следующем
 * чеке, нельзя в принципе: отказ приходит владельцу сейчас, а не кассиру в час пик.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pick = (config: ProgramConfig): ProgramSettings => ({
  baseEarnRate: config.baseEarnRate,
  baseRedeemRate: config.baseRedeemRate,
  cashierRules: {
    requireReceiptNumber: config.cashierRules.requireReceiptNumber,
    maxManualAmount: config.cashierRules.maxManualAmount,
    allowManualEntry: config.cashierRules.allowManualEntry,
  },
})

const pickTiers = (config: ProgramConfig): TierSettings => ({
  tiers: config.tiers,
  welcomeBonus: config.welcomeBonus,
})

const pickBirthday = (config: ProgramConfig): BirthdaySettings => ({
  enabled: config.birthday.enabled,
  reward: config.birthday.reward,
  daysBefore: config.birthday.daysBefore,
  daysAfter: config.birthday.daysAfter,
})

const pickReferral = (config: ProgramConfig): ReferralSettings => ({
  enabled: config.referral.enabled,
  reward: config.referral.reward,
  limit: config.referral.limit,
})

@Injectable()
export class ProgramSettingsService {
  private readonly logger = new Logger(ProgramSettingsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: MembershipRulesService,
  ) {}

  async get(): Promise<ProgramSettings> {
    const { tenantId } = TenantContext.getOrThrow()

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return pick(this.parse(tenantId, tenant.settings))
  }

  async update(input: ProgramSettings): Promise<ProgramSettings> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const raw = isRecord(tenant.settings) ? tenant.settings : {}
      const current = this.parse(tenantId, raw)

      const merged: Record<string, unknown> = {
        ...raw,
        baseEarnRate: input.baseEarnRate,
        baseRedeemRate: input.baseRedeemRate,
        cashierRules: {
          ...(isRecord(raw['cashierRules']) ? raw['cashierRules'] : {}),
          ...input.cashierRules,
        },
      }

      const checked = this.parse(tenantId, merged)

      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
      })

      return { before: pick(current), after: pick(checked) }
    })

    await this.audit.write({
      action: 'PROGRAM_CONFIG_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      oldValue: before,
      newValue: after,
    })

    return after
  }

  /** Статусы гостей и приветственные баллы. docs/02, раздел 5.6.1. */
  async getTiers(): Promise<TierSettings> {
    const { tenantId } = TenantContext.getOrThrow()

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return pickTiers(this.parse(tenantId, tenant.settings))
  }

  /**
   * Заменить лестницу статусов и приветственные баллы — тем же подмешиванием,
   * что и три настройки выше: остальные ключи не трогаются.
   *
   * Удалённый из лестницы статус у гостей руками не отбирается: касса вернёт их
   * на лестницу со следующего чека (core/tiers.ts).
   */
  async updateTiers(input: TierSettings): Promise<TierSettings> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after, config } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const raw = isRecord(tenant.settings) ? tenant.settings : {}
      const current = this.parse(tenantId, raw)

      const merged: Record<string, unknown> = {
        ...raw,
        tiers: input.tiers,
        welcomeBonus: input.welcomeBonus,
      }

      const checked = this.parse(tenantId, merged)

      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
      })

      return { before: pickTiers(current), after: pickTiers(checked), config: checked }
    })

    // Статусы гостей — сразу по новой лестнице: иначе список с фильтром по статусу
    // до следующего чека жил бы вчерашними порогами, а карточка — сегодняшними.
    await this.rules.refreshTenantTiers(tenantId, config)

    await this.audit.write({
      action: 'PROGRAM_CONFIG_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      oldValue: before,
      newValue: after,
    })

    return after
  }

  /** Приглашения друзей. docs/02, раздел 5.6.2. */
  async getReferral(): Promise<ReferralSettings> {
    const { tenantId } = TenantContext.getOrThrow()

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return pickReferral(this.parse(tenantId, tenant.settings))
  }

  /**
   * Включить, выключить или поменять награду за друга — тем же подмешиванием:
   * остальные ключи не трогаются. Касса применяет со следующего чека. Выданные
   * награды не отзываются, а друзья, пришедшие по ссылкам, остаются «по приглашению».
   */
  async updateReferral(input: ReferralSettings): Promise<ReferralSettings> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      const raw = isRecord(tenant.settings) ? tenant.settings : {}
      const current = this.parse(tenantId, raw)

      const merged: Record<string, unknown> = { ...raw, referral: input }

      const checked = this.parse(tenantId, merged)

      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
      })

      return { before: pickReferral(current), after: pickReferral(checked) }
    })

    await this.audit.write({
      action: 'PROGRAM_CONFIG_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      oldValue: before,
      newValue: after,
    })

    return after
  }

  /** Подарок ко дню рождения. docs/02, раздел 5.6.3. */
  async getBirthday(): Promise<BirthdaySettings> {
    const { tenantId } = TenantContext.getOrThrow()

    const tenant = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.tenant.findFirst({ where: { id: tenantId }, select: { settings: true } }),
    )

    if (tenant === null) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
      })
    }

    return pickBirthday(this.parse(tenantId, tenant.settings))
  }

  /**
   * Подарок ко дню рождения — тем же подмешиванием. Сертификат проверяется сейчас:
   * выключенный или чужой шаблон молча не выдался бы ни одному имениннику, и владелец
   * узнал бы об этом от обиженного гостя.
   */
  async updateBirthday(input: BirthdaySettings): Promise<BirthdaySettings> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { settings: true },
      })

      if (tenant === null) {
        throw new NotFoundException({
          error: { code: 'NOT_FOUND', message: 'Заведение не найдено' },
        })
      }

      if (input.reward.kind === 'CERTIFICATE') {
        const template = await tx.offer.findFirst({
          where: {
            id: input.reward.certificateId,
            tenantId,
            type: 'GIFT_CARD',
            status: 'LIVE',
          },
          select: { id: true },
        })

        if (template === null) {
          throw new BadRequestException({
            error: {
              code: 'CERTIFICATE_NOT_FOUND',
              message: 'Сертификат не найден или выключен — выберите включённый шаблон',
            },
          })
        }
      }

      const raw = isRecord(tenant.settings) ? tenant.settings : {}
      const current = this.parse(tenantId, raw)

      const merged: Record<string, unknown> = { ...raw, birthday: input }

      const checked = this.parse(tenantId, merged)

      await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
      })

      return { before: pickBirthday(current), after: pickBirthday(checked) }
    })

    await this.audit.write({
      action: 'PROGRAM_CONFIG_CHANGED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Tenant',
      entityId: tenantId,
      oldValue: before,
      newValue: after,
    })

    return after
  }

  /**
   * Разбор настроек. Неразборчивые настройки — не ошибка владельца: в базе лежит
   * конфигурация, которую приложение прочитать не может, и чинит это поддержка.
   * Ответ тот же, что отдаёт касса в этом случае, — по нему видно, куда идти.
   */
  private parse(tenantId: string, settings: unknown): ProgramConfig {
    try {
      return parseProgramConfig(settings)
    } catch (error) {
      this.logger.error(
        `Настройки заведения ${tenantId} не проходят схему`,
        error instanceof Error ? error.stack : undefined,
      )
      throw new InternalServerErrorException({
        error: {
          code: 'TENANT_MISCONFIGURED',
          message: 'Настройки заведения не читаются — это чинит поддержка, а не владелец',
        },
      })
    }
  }
}
