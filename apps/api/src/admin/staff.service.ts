import { randomInt } from 'node:crypto'

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  CreateStaffInput,
  CreateStaffResult,
  ResetStaffPinInput,
  StaffMember,
  UpdateStaffInput,
} from '@positive/contracts'

import { hashPin } from '../auth/pin'
import { TenantContext } from '../common/tenant/tenant-context'
import { AuditService, type AuditActorType } from '../core/audit.service'
import { PrismaService } from '../core/prisma.service'

/**
 * Команда заведения: добавить сотрудника, сменить PIN, отключить, поменять роль.
 *
 * ─── ПОЧЕМУ ЭТОГО НЕ БЫЛО И ПОЧЕМУ ЭТО ВАЖНО ───────────────────────────────
 *
 * Сотрудники существовали только в демо-скрипте. Владелец реального заведения
 * не мог ни завести кассира, ни отключить уволенного — то есть программа
 * лояльности работала ровно до первой смены персонала.
 *
 * ─── ЧТО ОТКЛЮЧЕНИЕ ДЕЛАЕТ НА САМОМ ДЕЛЕ ───────────────────────────────────
 *
 * Флаг `isActive = false` сам по себе ничего не отрезает: токен сотрудника
 * живёт восемь часов. Поэтому отключение делает три вещи сразу:
 *   1. ставит флаг — вход по PIN перестаёт работать;
 *   2. отзывает все сессии — обновить токен больше нельзя;
 *   3. уже выданный токен отказывает на следующем же запросе: middleware
 *      сверяет сотрудника с базой (common/tenant/tenant-context.middleware.ts).
 * Без третьего пункта первые два оставляли бы уволенному кассиру смену доступа.
 *
 * ─── ВЛАДЕЛЬЦЕВ ОТСЮДА НЕ ТРОГАЕМ ──────────────────────────────────────────
 *
 * Роли для управления — кассир и менеджер. Строку владельца нельзя ни изменить,
 * ни отключить, ни сбросить ей PIN через этот сервис. Иначе один неверный тап
 * «отключить» по своей же строке запирал бы заведение от единственного, кто
 * может его отпереть.
 */

/** Код устройства без похожих символов: 0/o, 1/l/i не спутать на слух и на глаз. */
const DEVICE_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
const DEVICE_CODE_LENGTH = 6
const DEVICE_CODE_ATTEMPTS = 5

const STAFF_SELECT = {
  id: true,
  displayName: true,
  role: true,
  isActive: true,
  pinLockedUntil: true,
  lastSeenAt: true,
  createdAt: true,
  devices: {
    select: { deviceId: true, label: true, isActive: true, revokedAt: true },
    orderBy: { registeredAt: 'asc' as const },
  },
} as const

interface StaffRow {
  id: string
  displayName: string
  role: string
  isActive: boolean
  pinLockedUntil: Date | null
  lastSeenAt: Date | null
  createdAt: Date
  devices: Array<{ deviceId: string; label: string; isActive: boolean; revokedAt: Date | null }>
}

const view = (row: StaffRow, now: Date): StaffMember => ({
  id: row.id,
  displayName: row.displayName,
  role: row.role as StaffMember['role'],
  isActive: row.isActive,
  isLocked: row.pinLockedUntil !== null && row.pinLockedUntil > now,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  devices: row.devices.map((device) => ({
    deviceCode: device.deviceId,
    label: device.label,
    isActive: device.isActive && device.revokedAt === null,
  })),
})

const generateDeviceCode = (): string => {
  let code = ''
  for (let index = 0; index < DEVICE_CODE_LENGTH; index += 1) {
    code += DEVICE_CODE_ALPHABET[randomInt(DEVICE_CODE_ALPHABET.length)]
  }
  return `pos-${code}`
}

/** Нарушение UNIQUE — по коду Prisma или Postgres: адаптер не всегда доносит второй. */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const record = error as { code?: unknown; cause?: { code?: unknown } }
  return record.code === 'P2002' || record.code === '23505' || record.cause?.code === '23505'
}

const notFound = (): NotFoundException =>
  new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Сотрудник не найден' } })

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Вся команда, включая владельцев: их видно, но не редактируется. */
  async list(): Promise<StaffMember[]> {
    const { tenantId } = TenantContext.getOrThrow()
    const now = new Date()

    const rows = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.staff.findMany({
        where: { tenantId },
        select: STAFF_SELECT,
        // Действующие сверху, отключённые — внизу списка, а не вперемешку.
        orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { displayName: 'asc' }],
      }),
    )

    return rows.map((row) => view(row, now))
  }

  /**
   * Добавить сотрудника вместе с первым устройством.
   *
   * ПОВТОР ВСЕЙ ТРАНЗАКЦИИ, А НЕ ВСТАВКИ. Код устройства глобально уникален,
   * и совпадение со случайным чужим кодом возможно. Но неудачный запрос внутри
   * транзакции Postgres переводит её в состояние «только откат» — повторить
   * вставку внутри нельзя. Поэтому при совпадении повторяется всё целиком.
   */
  async create(input: CreateStaffInput): Promise<CreateStaffResult> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()
    const pinHash = await hashPin(input.pin)
    const now = new Date()

    for (let attempt = 1; attempt <= DEVICE_CODE_ATTEMPTS; attempt += 1) {
      const deviceCode = generateDeviceCode()

      try {
        const row = await this.prisma.forTenant(tenantId, async (tx) => {
          const staff = await tx.staff.create({
            data: {
              tenantId,
              role: input.role,
              displayName: input.displayName,
              pinHash,
            },
            select: { id: true },
          })

          await tx.staffDevice.create({
            data: {
              tenantId,
              staffId: staff.id,
              deviceId: deviceCode,
              label: input.deviceLabel ?? input.displayName,
              registeredBy: actorId,
            },
          })

          return tx.staff.findFirstOrThrow({
            where: { id: staff.id, tenantId },
            select: STAFF_SELECT,
          })
        })

        await this.audit.write({
          action: 'STAFF_CREATED',
          actorType: (role ?? 'OWNER') as AuditActorType,
          actorId,
          tenantId,
          entityType: 'Staff',
          entityId: row.id,
          // PIN в аудит не пишется ни в каком виде — только то, что видно владельцу.
          newValue: { displayName: row.displayName, role: row.role, deviceCode },
        })

        return { staff: view(row, now), deviceCode }
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === DEVICE_CODE_ATTEMPTS) {
          throw error
        }
      }
    }

    // Недостижимо: последняя попытка либо возвращает, либо бросает.
    throw new Error('Не удалось подобрать свободный код устройства')
  }

  async update(id: string, input: UpdateStaffInput): Promise<StaffMember> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()
    const now = new Date()

    const { before, after } = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await this.findManaged(tx, tenantId, id)

      const updated = await tx.staff.update({
        where: { id: current.id },
        data: {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
        select: STAFF_SELECT,
      })

      // Отключение отзывает сессии. Смена роли — нет: middleware берёт роль
      // из базы на каждом запросе, и повышение кассира до менеджера действует
      // сразу, без того чтобы выкидывать человека из системы посреди смены.
      if (current.isActive && input.isActive === false) {
        await this.revokeSessions(tx, tenantId, current.id, 'STAFF_DEACTIVATED', now)
      }

      return { before: current, after: updated }
    })

    await this.audit.write({
      action: 'STAFF_UPDATED',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Staff',
      entityId: after.id,
      oldValue: { displayName: before.displayName, role: before.role, isActive: before.isActive },
      newValue: { displayName: after.displayName, role: after.role, isActive: after.isActive },
    })

    return view(after, now)
  }

  /**
   * Задать новый PIN.
   *
   * Снимает блокировку после неудачных попыток — иначе кассир, забывший PIN
   * и перебравший варианты, ждал бы окончания блокировки уже с новым PIN.
   *
   * ОТЗЫВАЕТ ВСЕ СЕССИИ. PIN меняют по двум причинам: забыл или узнал кто-то
   * чужой. Во втором случае живые сессии — это ровно тот доступ, который
   * хотели отрезать.
   */
  async resetPin(id: string, input: ResetStaffPinInput): Promise<StaffMember> {
    const { tenantId, actorId, role } = TenantContext.getOrThrow()
    const pinHash = await hashPin(input.pin)
    const now = new Date()

    const row = await this.prisma.forTenant(tenantId, async (tx) => {
      const current = await this.findManaged(tx, tenantId, id)

      const updated = await tx.staff.update({
        where: { id: current.id },
        data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
        select: STAFF_SELECT,
      })

      await this.revokeSessions(tx, tenantId, current.id, 'PIN_RESET', now)

      return updated
    })

    await this.audit.write({
      action: 'STAFF_PIN_RESET',
      actorType: (role ?? 'OWNER') as AuditActorType,
      actorId,
      tenantId,
      entityType: 'Staff',
      entityId: row.id,
    })

    return view(row, now)
  }

  /**
   * Сотрудник этого заведения, которого разрешено менять.
   *
   * Чужой — 404, как несуществующий: по коду ответа не должно быть видно,
   * есть ли такой сотрудник у соседа. Владелец — 403: объект свой, но менять
   * его отсюда нельзя, и честный отказ понятнее притворства, что его нет.
   */
  private async findManaged(
    tx: Parameters<Parameters<PrismaService['forTenant']>[1]>[0],
    tenantId: string,
    id: string,
  ): Promise<StaffRow> {
    const current = await tx.staff.findFirst({ where: { id, tenantId }, select: STAFF_SELECT })

    if (current === null) {
      throw notFound()
    }

    if (current.role === 'OWNER') {
      throw new ForbiddenException({
        error: {
          code: 'OWNER_NOT_MANAGED',
          message: 'Владельца заведения нельзя изменить из списка команды',
        },
      })
    }

    return current
  }

  private async revokeSessions(
    tx: Parameters<Parameters<PrismaService['forTenant']>[1]>[0],
    tenantId: string,
    staffId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await tx.session.updateMany({
      where: { tenantId, staffId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    })
  }
}
