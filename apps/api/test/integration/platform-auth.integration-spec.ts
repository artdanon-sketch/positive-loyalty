/**
 * Вход в админку платформы: удачный случай и каждая защита по отдельности.
 *
 * ─── Почему тест интеграционный, а не юнитовый ───────────────────────────────
 *
 * Половина защит здесь живёт не в коде, а в базе: счётчик попыток, номер
 * последнего принятого окна, доверенные устройства. Подменить базу заглушкой
 * значило бы проверить свои же представления о ней, а не поведение. Именно так
 * в этом проекте дважды и прятались поломки изоляции.
 *
 * ─── Почему под ролью positive_platform ──────────────────────────────────────
 *
 * Таблицы входа админа платформы обычному приложению недоступны вовсе (миграция
 * 20260909170000). Прогон под владельцем базы обошёл бы и права, и RLS —
 * то есть проверил бы код в условиях, которых в боевой среде не существует.
 */

import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { hashPin } from '../../src/auth/pin'
import { AuditService } from '../../src/core/audit.service'
import {
  PlatformAuthService,
  PlatformSignInFailedError,
  type SignInInput,
} from '../../src/platform/platform-auth.service'
import { PlatformPrismaService } from '../../src/platform/platform-prisma.service'
import { sealSecret, keyFromEnv } from '../../src/platform/secret-box'
import { generateSecret, totpCode } from '../../src/platform/totp'

const platformUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_PLATFORM_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_PLATFORM_ROLE. Без него вход админа платформы ' +
      'не проверяется вовсе: его таблицы недоступны обычной роли.',
  )
}

/** Ключ шифрования секретов второго фактора. В тестах — свой, одноразовый. */
const TEST_ENC_KEY = Buffer.alloc(32, 7).toString('base64')

let prisma: PlatformPrismaService
let service: PlatformAuthService

/** Заводит админа с известными паролем и секретом. Возвращает всё нужное для входа. */
const createAdmin = async (options: { withDevice?: string } = {}) => {
  const password = `Пароль-${randomUUID()}`
  const secret = generateSecret()

  const admin = await prisma.platformAdmin.create({
    data: {
      email: `probe-${randomUUID()}@example.test`,
      displayName: 'Проверочный админ',
      passwordHash: await hashPin(password),
      totpSecretEnc: sealSecret(secret, keyFromEnv(TEST_ENC_KEY)),
      totpConfirmedAt: new Date(),
    },
  })

  if (options.withDevice !== undefined) {
    const { createHash } = await import('node:crypto')
    await prisma.platformAdminDevice.create({
      data: {
        adminId: admin.id,
        deviceIdHash: createHash('sha256').update(options.withDevice).digest('hex'),
        label: 'Уже доверенное',
      },
    })
  }

  return { admin, password, secret }
}

const signInInput = (
  email: string,
  password: string,
  secret: string,
  now: Date,
  overrides: Partial<SignInInput> = {},
): SignInInput => ({
  email,
  password,
  totpCode: totpCode(secret, now.getTime()),
  deviceId: `device-${randomUUID()}`,
  deviceLabel: 'Ноутбук проверки',
  ip: '203.0.113.9',
  userAgent: 'vitest',
  now,
  ...overrides,
})

describe('Вход в админку платформы', () => {
  beforeAll(async () => {
    // Собираем руками, без контейнера зависимостей. Причина не в лени:
    // AuditService объявлен через PrismaService, а здесь ему нужен КЛИЕНТ
    // ПЛАТФОРМЫ — обычная роль в таблицу аудита писать может, но ни одну
    // таблицу входа админа не увидит. Связать это через overrideProvider
    // означало бы описывать в тесте проводку, которой в приложении нет:
    // настоящую проводку сделает приложение админки на шаге 4.
    const previousUrl = process.env['DATABASE_URL_PLATFORM']
    process.env['DATABASE_URL_PLATFORM'] = platformUrl()
    process.env['PLATFORM_TOTP_ENC_KEY'] = TEST_ENC_KEY

    try {
      prisma = new PlatformPrismaService()
      await prisma.onModuleInit()
      service = new PlatformAuthService(prisma, new AuditService(prisma))
    } finally {
      if (previousUrl === undefined) {
        delete process.env['DATABASE_URL_PLATFORM']
      } else {
        process.env['DATABASE_URL_PLATFORM'] = previousUrl
      }
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  let now: Date

  beforeEach(() => {
    // Фиксированный момент: коды TOTP считаются от него, и «сейчас» в тесте
    // не должно зависеть от того, попал ли прогон на границу тридцати секунд.
    now = new Date('2026-09-09T12:00:00.000Z')
  })

  it('впускает по паролю и коду, заводит первое устройство и сессию', async () => {
    const { admin, password, secret } = await createAdmin()

    const result = await service.signIn(signInInput(admin.email, password, secret, now))

    expect(result.adminId).toBe(admin.id)
    expect(result.deviceEnrolled, 'первое устройство должно завестись само').toBe(true)
    expect(result.refreshToken.length).toBeGreaterThan(20)

    const session = await prisma.platformSession.findUnique({ where: { id: result.sessionId } })
    expect(session?.adminId).toBe(admin.id)

    // Счётчик попыток сброшен, окно запомнено — иначе защита от повтора не сработает.
    const after = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })
    expect(after.failedAttempts).toBe(0)
    expect(after.lastTotpCounter).not.toBeNull()
  })

  it('оставляет след в аудите', async () => {
    const { admin, password, secret } = await createAdmin()

    await service.signIn(signInInput(admin.email, password, secret, now))

    const trail = await prisma.auditLog.findMany({
      where: { actorId: admin.id, action: 'PLATFORM_ADMIN_SIGNED_IN' },
    })

    expect(trail.length).toBeGreaterThanOrEqual(1)
  })

  it('ОДИН И ТОТ ЖЕ КОД ВТОРОЙ РАЗ НЕ ПРИНИМАЕТСЯ (RFC 6238, раздел 5.2)', async () => {
    const { admin, password, secret } = await createAdmin()
    const first = signInInput(admin.email, password, secret, now)

    await service.signIn(first)

    // Тот же код, то же мгновение — снаружи неотличимо от подсмотренного кода,
    // которым воспользовались в течение его тридцати секунд.
    await expect(service.signIn({ ...first, deviceId: first.deviceId })).rejects.toBeInstanceOf(
      PlatformSignInFailedError,
    )
  })

  it('не впускает с неверным паролем', async () => {
    const { admin, secret } = await createAdmin()

    await expect(
      service.signIn(signInInput(admin.email, 'совсем-не-тот-пароль', secret, now)),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })

  it('не впускает с неверным кодом', async () => {
    const { admin, password, secret } = await createAdmin()

    await expect(
      service.signIn(signInInput(admin.email, password, secret, now, { totpCode: '000000' })),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })

  it('несуществующая почта отвергается ТОЙ ЖЕ ошибкой, что и неверный пароль', async () => {
    const { secret } = await createAdmin()

    await expect(
      service.signIn(signInInput('никого-тут-нет@example.test', 'пароль', secret, now)),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })

  it('не впускает с незнакомого устройства, когда доверенное уже есть', async () => {
    const trusted = `device-${randomUUID()}`
    const { admin, password, secret } = await createAdmin({ withDevice: trusted })

    await expect(
      service.signIn(
        signInInput(admin.email, password, secret, now, { deviceId: `чужое-${randomUUID()}` }),
      ),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)

    // А с доверенного — впускает, и вторым устройством его не заводит.
    const ok = await service.signIn(
      signInInput(admin.email, password, secret, now, { deviceId: trusted }),
    )
    expect(ok.deviceEnrolled).toBe(false)
  })

  /**
   * Довести учётку до жёсткой блокировки, перематывая время через задержки.
   *
   * Просто десять вызовов подряд НЕ накопили бы десять неудач, и это не изъян
   * теста, а суть защиты: после третьей ошибки учётка закрыта на две секунды,
   * и попытки внутри этого срока отбиваются, НЕ увеличивая счётчик. Чтобы
   * добраться до десятой, подбирающему придётся честно выждать каждую паузу —
   * ровно за этим прогрессивные задержки и нужны.
   *
   * Возвращает момент, когда жёсткая блокировка ещё действует.
   */
  const driveToHardLock = async (email: string, secret: string): Promise<Date> => {
    let cursor = now

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(
        service.signIn(signInInput(email, 'неверный', secret, cursor)),
      ).rejects.toBeInstanceOf(PlatformSignInFailedError)

      const state = await prisma.platformAdmin.findFirstOrThrow({ where: { email } })

      // Перематываем ровно за край текущей паузы: иначе следующая попытка
      // упрётся в закрытую дверь и счётчик не сдвинется.
      if (state.lockedUntil !== null && state.lockedUntil > cursor) {
        cursor = new Date(state.lockedUntil.getTime() + 1000)
      }
    }

    return cursor
  }

  it('блокирует после десяти неудач — даже с верными данными', async () => {
    const { admin, password, secret } = await createAdmin()

    const cursor = await driveToHardLock(admin.email, secret)

    const locked = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })
    expect(locked.failedAttempts).toBeGreaterThanOrEqual(10)
    expect(locked.lockedUntil).not.toBeNull()

    // Жёсткая блокировка — на час, а не на секунды: перемотка на минуту вперёд
    // её не снимает.
    const soon = new Date(cursor.getTime() + 60 * 1000)

    // Верные пароль и код теперь тоже не помогают — в этом и смысл блокировки.
    await expect(
      service.signIn(signInInput(admin.email, password, secret, soon)),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })

  it('стук в закрытую дверь НЕ продлевает блокировку', async () => {
    const { admin, password, secret } = await createAdmin()

    const cursor = await driveToHardLock(admin.email, secret)

    const first = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })

    await service
      .signIn(signInInput(admin.email, password, secret, new Date(cursor.getTime() + 1000)))
      .catch(() => undefined)

    const second = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } })

    // Иначе тот, кто стучится, продлевал бы запрет сам себе бесконечно,
    // и владелец не смог бы войти, дождавшись окончания срока.
    expect(second.lockedUntil?.getTime()).toBe(first.lockedUntil?.getTime())
    expect(second.failedAttempts).toBe(first.failedAttempts)
  })

  it('не впускает, пока второй фактор не подтверждён', async () => {
    const { admin, password, secret } = await createAdmin()

    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpConfirmedAt: null },
    })

    await expect(
      service.signIn(signInInput(admin.email, password, secret, now)),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })

  it('не впускает выключенную учётку', async () => {
    const { admin, password, secret } = await createAdmin()

    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { isActive: false } })

    await expect(
      service.signIn(signInInput(admin.email, password, secret, now)),
    ).rejects.toBeInstanceOf(PlatformSignInFailedError)
  })
})
