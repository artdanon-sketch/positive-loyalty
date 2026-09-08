/**
 * ТЕСТ-СТРАЖ: аудит-лог можно только дописывать.
 *
 * ─── Что этот файл сторожит ──────────────────────────────────────────────────
 *
 * У аудита права устроены наоборот обычного: приложению выдан ровно INSERT.
 * SELECT и UPDATE отобраны миграцией 20260909100000, DELETE не выдавался.
 * Смысл в том, что журнал наблюдений не должен выгружаться ошибкой в обычном API,
 * а запись, которую можно исправить, доказательством не является.
 *
 * Эти права держатся на трёх строках миграции, и потерять их проще простого.
 * В миграции 20260828100000 стоит `ALTER DEFAULT PRIVILEGES ... GRANT SELECT,
 * INSERT, UPDATE TO positive_app` — то есть КАЖДАЯ новая таблица получает чтение
 * и правку автоматически, без единого GRANT. Проверено опытом: таблица, созданная
 * без единой строчки о правах, немедленно имеет INSERT, SELECT, UPDATE.
 *
 * Значит `REVOKE ALL` в миграции аудита — не перестраховка, а единственное, что
 * отделяет журнал наблюдений от обычной таблицы. Уберут REVOKE при рефакторинге —
 * ничего не сломается, тесты останутся зелёными, и никто не заметит. Кроме этого.
 *
 * ─── Почему тест обязан ходить ролью приложения ──────────────────────────────
 *
 * Под владельцем базы (`DATABASE_URL_TEST`) проверять права бессмысленно: владелец
 * читает и правит что угодно, потому что `FORCE ROW LEVEL SECURITY` намеренно
 * выключен, а GRANT-ы его не касаются вовсе. Файл берёт `DATABASE_URL_TEST_APP_ROLE`
 * и падает, если её нет, — приём и довод взяты у теста изоляции: пропущенная
 * проверка прав хуже красной.
 */

import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AuditReasonRequiredError, AuditService } from '../../src/core/audit.service'
import { PrismaService } from '../../src/core/prisma.service'

/** Строка подключения под ролью positive_app. Копия приёма из теста изоляции. */
const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_APP_ROLE — строка подключения под ролью positive_app. ' +
      'Без неё права аудита не проверяются: тесты ходят владельцем, а владельцу ' +
      'отобранные GRANT-ы безразличны. Как завести роль локально — в prisma/README.md.',
  )
}

/** Строка подключения владельца: только для проверки, что запись реально легла. */
const ownerUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error('Не задан DATABASE_URL_TEST — тестовая база владельца.')
}

const buildPrisma = async (url: string): Promise<PrismaService> => {
  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = url

  try {
    const moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile()
    const prisma = moduleRef.get(PrismaService)
    await prisma.onModuleInit()
    return prisma
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL']
    } else {
      process.env['DATABASE_URL'] = previous
    }
  }
}

describe('AuditLog: только дописывать', () => {
  let appRole: PrismaService
  let owner: PrismaService
  let audit: AuditService

  beforeAll(async () => {
    appRole = await buildPrisma(appRoleUrl())
    owner = await buildPrisma(ownerUrl())
    audit = new AuditService(appRole)
  })

  afterAll(async () => {
    await appRole.$disconnect()
    await owner.$disconnect()
  })

  /**
   * Страж невырожденности.
   *
   * Если DATABASE_URL_TEST_APP_ROLE по ошибке укажет на владельца, весь файл
   * станет зелёным, ничего не проверив. Этот случай ловит подмену: под ролью
   * приложения чтение аудита обязано быть запрещено.
   */
  it('роль приложения не может ЧИТАТЬ аудит', async () => {
    await expect(appRole.$queryRawUnsafe('SELECT count(*) FROM "AuditLog"')).rejects.toThrow(
      /permission denied|нет прав/i,
    )
  })

  it('роль приложения не может ПРАВИТЬ аудит', async () => {
    await expect(
      appRole.$executeRawUnsafe(`UPDATE "AuditLog" SET "reason" = 'подделка'`),
    ).rejects.toThrow(/permission denied|нет прав/i)
  })

  it('роль приложения не может УДАЛЯТЬ из аудита', async () => {
    await expect(appRole.$executeRawUnsafe('DELETE FROM "AuditLog"')).rejects.toThrow(
      /permission denied|нет прав/i,
    )
  })

  it('но записать наблюдение — может, и оно действительно ложится в базу', async () => {
    const marker = `PROBE-${process.pid}-${process.hrtime.bigint().toString()}`

    await audit.writeOrThrow({
      action: 'OPERATION_REVERSED',
      actorType: 'MANAGER',
      actorId: marker,
      tenantId: null,
      entityType: 'LedgerEntry',
      entityId: 'entry-1',
      oldValue: { amount: 100 },
      newValue: { amount: 0 },
      ip: '203.0.113.7',
      requestId: marker,
    })

    // Читаем ВЛАДЕЛЬЦЕМ: у роли приложения на это прав нет, и в том весь смысл.
    const rows = await owner.$queryRawUnsafe<
      Array<{ action: string; actorType: string; oldValue: unknown }>
    >(`SELECT "action", "actorType", "oldValue" FROM "AuditLog" WHERE "actorId" = $1`, marker)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe('OPERATION_REVERSED')
    expect(rows[0]?.actorType).toBe('MANAGER')
    expect(rows[0]?.oldValue).toEqual({ amount: 100 })

    await owner.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "actorId" = $1`, marker)
  })

  /**
   * Негативный случай, которого требует CLAUDE.md.
   *
   * docs/02 раздел 6 называет impersonate самой опасной ручкой и требует причину
   * текстом. Требование живёт в коде, а не в ограничении таблицы: обязательность
   * зависит от действия. Значит её надо проверять — иначе она тихо исчезнет.
   */
  it('вход под владельцем без причины не записывается вовсе', async () => {
    await expect(
      audit.writeOrThrow({
        action: 'IMPERSONATE_START',
        actorType: 'PLATFORM_ADMIN',
        actorId: 'admin-1',
        tenantId: 'tenant-1',
      }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError)
  })

  it('причина из пробелов за причину не считается', async () => {
    await expect(
      audit.writeOrThrow({
        action: 'IMPERSONATE_START',
        actorType: 'PLATFORM_ADMIN',
        actorId: 'admin-1',
        tenantId: 'tenant-1',
        reason: '        ',
      }),
    ).rejects.toBeInstanceOf(AuditReasonRequiredError)
  })

  it('с внятной причиной — записывается', async () => {
    const marker = `PROBE-REASON-${process.pid}-${process.hrtime.bigint().toString()}`

    await audit.writeOrThrow({
      action: 'IMPERSONATE_START',
      actorType: 'PLATFORM_ADMIN',
      actorId: marker,
      tenantId: null,
      reason: 'Разбор жалобы владельца на пропавшие баллы, тикет 412',
    })

    const rows = await owner.$queryRawUnsafe<Array<{ reason: string }>>(
      `SELECT "reason" FROM "AuditLog" WHERE "actorId" = $1`,
      marker,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toContain('тикет 412')

    await owner.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "actorId" = $1`, marker)
  })

  /**
   * write() в отличие от writeOrThrow() не роняет вызывающего.
   *
   * Отменить кассиру операцию из-за недоступности журнала хуже, чем потерять
   * одну строку наблюдения. Но провал обязан быть громким — за это отвечает
   * логгер уровня error, здесь проверяем только что исключение не вылетело.
   */
  it('write() глушит ошибку, чтобы не уронить основное действие', async () => {
    await expect(
      audit.write({
        action: 'IMPERSONATE_START',
        actorType: 'PLATFORM_ADMIN',
        actorId: 'admin-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeUndefined()
  })
})
