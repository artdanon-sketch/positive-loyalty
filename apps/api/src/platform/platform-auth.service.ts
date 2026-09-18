import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'

import { hashPin, verifyPin } from '../auth/pin'
import { AuditService } from '../core/audit.service'

import { PlatformPrismaService } from './platform-prisma.service'
import { platformTokenSecret, signPlatformToken } from './platform-token'
import { openSecret, keyFromEnv } from './secret-box'
import { matchTotpCounter } from './totp'

/**
 * Вход в админку платформы: пароль, код из аутентификатора, доверенное устройство.
 *
 * ─── ПОЧЕМУ ВСЁ ОДНИМ ШАГОМ, А НЕ «СНАЧАЛА ПАРОЛЬ, ПОТОМ КОД» ────────────────
 *
 * Привычная двухшаговая форма («пароль принят, введите код») удобнее, но она
 * сама по себе является оракулом: по тому, дошло ли дело до второго экрана,
 * видно, верен ли пароль. Для учётной записи, которая видит данные всех
 * заведений, эта подсказка стоит дороже удобства. Здесь всё приходит разом
 * и отвергается разом, одинаковой ошибкой.
 *
 * ─── ОДИН ОТКАЗ НА ВСЕ ПРИЧИНЫ ───────────────────────────────────────────────
 *
 * Нет такой почты, неверный пароль, неверный код, повтор кода, чужое устройство,
 * заблокированная учётка — снаружи всё это неотличимо. Никаких «пользователь не
 * найден» и никаких «осталось 3 попытки»: любая разница в ответе превращает
 * форму входа в справочник.
 *
 * Настоящая причина уходит в лог и в аудит, где её увидит владелец платформы,
 * а не тот, кто подбирает.
 *
 * ─── ЗАЧЕМ ХОЛОСТОЕ ХЕШИРОВАНИЕ ──────────────────────────────────────────────
 *
 * Если почты нет в базе, ответить сразу — значит выдать её отсутствие временем
 * ответа: с почтой сервер думает сотню миллисекунд на scrypt, без почты
 * отвечает мгновенно. Поэтому на несуществующей почте всё равно считается
 * scrypt от подставного хеша. Это не суеверие, а разница в два порядка.
 *
 * ─── ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ ────────────────────────────────────────────────
 *
 * Ни одной строки про HTTP. Сервис ничего не знает про запросы, заголовки
 * и куки: его задача — решить, впускать ли, и оставить след. Маршруты появятся
 * в отдельном приложении админки платформы, которое и будет ходить в базу
 * ролью positive_platform.
 */

/** Единственная ошибка входа. Ни поля, ни кода, по которым различалась бы причина. */
export class PlatformSignInFailedError extends Error {
  constructor() {
    super('Вход не выполнен: неверные учётные данные, код или устройство.')
    this.name = 'PlatformSignInFailedError'
  }
}

/** Внутренняя причина отказа. Наружу не попадает никогда — только в лог и аудит. */
type FailureReason =
  | 'НЕТ_ТАКОЙ_ПОЧТЫ'
  | 'УЧЁТКА_ВЫКЛЮЧЕНА'
  | 'ЗАБЛОКИРОВАНА'
  | 'НЕВЕРНЫЙ_ПАРОЛЬ'
  | 'ВТОРОЙ_ФАКТОР_НЕ_НАСТРОЕН'
  | 'НЕВЕРНЫЙ_КОД'
  | 'ПОВТОР_КОДА'
  | 'ЧУЖОЕ_УСТРОЙСТВО'

export interface SignInInput {
  readonly email: string
  readonly password: string
  readonly totpCode: string
  /** Идентификатор устройства с клиента. В базе от него хранится только хеш. */
  readonly deviceId: string
  /** Как назвать устройство, если оно оказалось первым и его придётся завести. */
  readonly deviceLabel?: string
  readonly ip?: string | null
  readonly userAgent?: string | null
  /** Момент времени аргументом, а не Date.now() внутри: иначе это не проверить тестом. */
  readonly now: Date
}

export interface SignInResult {
  readonly adminId: string
  readonly displayName: string
  /** Короткоживущий токен доступа. Подписан ОТДЕЛЬНЫМ секретом — см. platform-token.ts. */
  readonly accessToken: string
  /** Секунды жизни accessToken: клиент не должен вычитывать это из самого токена. */
  readonly expiresIn: number
  readonly refreshToken: string
  readonly sessionId: string
  /** Устройство завели прямо сейчас — экран входа должен об этом сказать. */
  readonly deviceEnrolled: boolean
}

/**
 * Подставной хеш для холостого прогона scrypt.
 *
 * Не константа-строка «password», а настоящий хеш от случайного значения:
 * verifyPin на заведомо неверном формате вышел бы раньше, чем посчитал бы
 * scrypt, и холостой прогон перестал бы стоить столько же, сколько настоящий.
 */
let dummyHash: string | null = null

/** docs/05, раздел 2: блокировка после 10 попыток. */
const MAX_ATTEMPTS = 10

/** Сколько держать учётку закрытой, когда попытки исчерпаны. */
const HARD_LOCK_MINUTES = 60

/**
 * Прогрессивная задержка: первые две ошибки бесплатны, дальше растёт вдвое.
 *
 * Первые две — потому что опечатка в пароле это норма, а не атака, и наказывать
 * за неё ожиданием значит воспитывать привычку хранить пароль в блокноте.
 * Дальше рост быстрый: к седьмой попытке пауза уже минута, и перебор миллиона
 * шестизначных кодов растягивается за пределы человеческой жизни.
 */
const lockSecondsForAttempt = (attempt: number): number => {
  if (attempt <= 2) {
    return 0
  }

  if (attempt >= MAX_ATTEMPTS) {
    return HARD_LOCK_MINUTES * 60
  }

  return 2 ** (attempt - 2)
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Refresh живёт 30 дней — столько же, сколько у остальных субъектов системы. */
const REFRESH_TTL_DAYS = 30

/** 15 минут — docs/05, раздел 2: столько же, сколько у владельца заведения. */
const ACCESS_TTL_SECONDS = 900

/**
 * Двенадцать букв и цифр из нашего алфавита — это код восстановления;
 * шесть цифр — код аутентификатора. Спутать их нельзя, поэтому переключателя
 * в форме входа нет.
 */
const isRecoveryShape = (value: string): boolean =>
  /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/i.test(value.trim())

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name)

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Впустить или отказать.
   *
   * Успех выдаёт refresh-токен и заводит сессию; провал по любой причине
   * приводит к одной и той же ошибке, но по-разному отражается в аудите.
   */
  async signIn(input: SignInInput): Promise<SignInResult> {
    const email = input.email.trim().toLowerCase()

    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } })

    if (admin === null) {
      // Холостой scrypt: см. «зачем холостое хеширование» в шапке файла.
      await this.burnTime(input.password)
      await this.recordFailure(null, email, 'НЕТ_ТАКОЙ_ПОЧТЫ', input)
      throw new PlatformSignInFailedError()
    }

    if (!admin.isActive) {
      await this.burnTime(input.password)
      await this.recordFailure(admin.id, email, 'УЧЁТКА_ВЫКЛЮЧЕНА', input)
      throw new PlatformSignInFailedError()
    }

    if (admin.lockedUntil !== null && admin.lockedUntil > input.now) {
      // Счётчик НЕ увеличиваем: иначе стучащий в закрытую дверь продлевал бы
      // блокировку сам себе бесконечно, и владелец не смог бы войти, дождавшись
      // окончания срока. Это дало бы отказ в обслуживании вместо защиты.
      await this.burnTime(input.password)
      await this.audit.write(this.auditEntry(admin.id, email, 'ЗАБЛОКИРОВАНА', input))
      throw new PlatformSignInFailedError()
    }

    if (!(await verifyPin(input.password, admin.passwordHash))) {
      await this.recordFailure(admin.id, email, 'НЕВЕРНЫЙ_ПАРОЛЬ', input)
      throw new PlatformSignInFailedError()
    }

    if (admin.totpSecretEnc === null) {
      // Секрета нет вовсе — впустить по одному паролю нельзя ни при каких
      // обстоятельствах: это учётная запись, видящая все заведения.
      await this.recordFailure(admin.id, email, 'ВТОРОЙ_ФАКТОР_НЕ_НАСТРОЕН', input)
      throw new PlatformSignInFailedError()
    }

    // ПЕРВЫЙ УДАЧНЫЙ ВХОД И ЕСТЬ ПОДТВЕРЖДЕНИЕ ВТОРОГО ФАКТОРА.
    //
    // Секрет заводится скриптом bootstrap-admin и до первого входа помечен
    // неподтверждённым. Отдельного экрана «подтвердите аутентификатор» нет
    // и быть не может: чтобы до него добраться, надо войти, а вход требует
    // подтверждённого фактора — замкнутый круг.
    //
    // Разрывается он тем, что сошедшийся код САМ является доказательством:
    // предъявить его может только тот, у кого секрет уже в аутентификаторе.
    // Безопасность при этом не страдает — код требуется в любом случае,
    // и пароля в одиночку не хватает ни на одном шаге.

    // Код восстановления — запасной ключ от той же двери. Он нужен ровно
    // в одном случае: телефон с аутентификатором утонул, и другого способа
    // предъявить второй фактор не осталось. Поэтому он проверяется здесь же,
    // после пароля, и сгорает при первом использовании.
    const recovery = isRecoveryShape(input.totpCode)
      ? await this.burnRecoveryCode(admin.id, input.totpCode)
      : null

    let counter: number | null = null

    if (recovery === null) {
      const secret = openSecret(
        admin.totpSecretEnc,
        keyFromEnv(process.env['PLATFORM_TOTP_ENC_KEY']),
      )
      counter = matchTotpCounter(secret, input.totpCode, input.now.getTime())

      if (counter === null) {
        await this.recordFailure(admin.id, email, 'НЕВЕРНЫЙ_КОД', input)
        throw new PlatformSignInFailedError()
      }
    }

    // RFC 6238, раздел 5.2: принятый код не принимается второй раз. Строгое
    // «больше», а не «больше или равно», отсекает и повтор того же кода,
    // и попытку предъявить код из более раннего окна.
    if (
      counter !== null &&
      admin.lastTotpCounter !== null &&
      BigInt(counter) <= admin.lastTotpCounter
    ) {
      await this.recordFailure(admin.id, email, 'ПОВТОР_КОДА', input)
      throw new PlatformSignInFailedError()
    }

    const deviceIdHash = sha256(input.deviceId)
    // Вход по коду восстановления заводит устройство сам: телефон потерян
    // вместе с доверием к нему, и требовать «войдите со старого устройства»
    // значит не восстановить доступ, а запереть дверь окончательно.
    const enrolled =
      recovery === null
        ? await this.resolveDevice(admin.id, deviceIdHash, input)
        : await this.enrollDevice(admin.id, deviceIdHash, input)

    if (enrolled === null) {
      await this.recordFailure(admin.id, email, 'ЧУЖОЕ_УСТРОЙСТВО', input)
      throw new PlatformSignInFailedError()
    }

    if (recovery !== null) {
      // Отдельная запись в истории: вход запасным ключом — событие, о котором
      // владелец должен узнать, даже если это был он сам.
      await this.audit.write(this.recoveryEntry(admin.id, email, input))
    }

    return this.completeSignIn(
      admin.id,
      admin.displayName,
      counter,
      deviceIdHash,
      enrolled,
      admin.totpConfirmedAt === null,
      input,
    )
  }

  /**
   * Доверенное устройство: узнать или завести первое.
   *
   * Возвращает `null`, если устройство неизвестно, а известные у админа есть.
   *
   * ПЕРВОЕ УСТРОЙСТВО ЗАВОДИТСЯ САМО, и это осознанная уступка. Иначе владелец,
   * которому только что создали учётку, не смог бы войти ни с одного устройства:
   * доверенных нет, а завести их можно только изнутри. Уступка узкая — она
   * действует ровно один раз и только когда доверенных устройств НЕТ ВОВСЕ,
   * а к этому моменту уже проверены и пароль, и код второго фактора.
   */
  private async resolveDevice(
    adminId: string,
    deviceIdHash: string,
    input: SignInInput,
  ): Promise<boolean | null> {
    const known = await this.prisma.platformAdminDevice.findFirst({
      where: { adminId, deviceIdHash, revokedAt: null },
    })

    if (known !== null) {
      return false
    }

    const anyDevice = await this.prisma.platformAdminDevice.findFirst({
      where: { adminId, revokedAt: null },
    })

    if (anyDevice !== null) {
      return null
    }

    await this.prisma.platformAdminDevice.create({
      data: {
        adminId,
        deviceIdHash,
        label: input.deviceLabel?.trim() || 'Первое устройство',
        lastSeenAt: input.now,
      },
    })

    return true
  }

  /**
   * Сжечь код восстановления.
   *
   * ОДИН РАЗ И НАСОВСЕМ. Код, который можно предъявить дважды, — это пароль,
   * записанный на бумаге и оставленный действующим навсегда.
   *
   * Возвращает `null`, если такого кода нет или он уже использован: наружу
   * различие не выходит, иначе по ответу можно было бы перебирать бумажку.
   */
  private async burnRecoveryCode(adminId: string, code: string): Promise<{ id: string } | null> {
    const codeHash = sha256(code.trim().toUpperCase())

    const burned = await this.prisma.platformRecoveryCode.updateMany({
      where: { adminId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    })

    return burned.count === 0 ? null : { id: codeHash }
  }

  /**
   * Завести доверенное устройство при входе по коду восстановления.
   *
   * Старые устройства не трогаем: человек мог потерять телефон, а мог просто
   * оставить его дома, и отзывать за него доверие — решение владельца,
   * а не наше.
   */
  private async enrollDevice(
    adminId: string,
    deviceIdHash: string,
    input: SignInInput,
  ): Promise<boolean> {
    const known = await this.prisma.platformAdminDevice.findFirst({
      where: { adminId, deviceIdHash, revokedAt: null },
    })

    if (known !== null) {
      return false
    }

    await this.prisma.platformAdminDevice.create({
      data: {
        adminId,
        deviceIdHash,
        label: input.deviceLabel?.trim() || 'Устройство после восстановления',
        lastSeenAt: input.now,
      },
    })

    return true
  }

  /** Успешный вход: сбросить счётчики, запомнить окно, завести сессию, оставить след. */
  private async completeSignIn(
    adminId: string,
    displayName: string,
    counter: number | null,
    deviceIdHash: string,
    deviceEnrolled: boolean,
    totpWasUnconfirmed: boolean,
    input: SignInInput,
  ): Promise<SignInResult> {
    const refreshToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(input.now.getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        // Окно аутентификатора двигаем только когда им и входили: вход
        // по коду восстановления не должен обесценивать следующий код TOTP.
        ...(counter === null ? {} : { lastTotpCounter: BigInt(counter) }),
        lastSeenAt: input.now,
        // Проставляется один раз: сошедшийся код доказал, что аутентификатор
        // подключён. Повторные входы значение не трогают.
        // Аутентификатор подтверждает только сошедшийся код из него самого:
        // код восстановления доказывает владение бумажкой, а не телефоном.
        ...(totpWasUnconfirmed && counter !== null ? { totpConfirmedAt: input.now } : {}),
      },
    })

    const session = await this.prisma.platformSession.create({
      data: {
        adminId,
        refreshTokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        deviceIdHash,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt,
      },
    })

    await this.prisma.platformAdminDevice.updateMany({
      where: { adminId, deviceIdHash, revokedAt: null },
      data: { lastSeenAt: input.now },
    })

    // Вход в контур платформы — событие из списка docs/05, раздел 9.
    // write, а не writeOrThrow: отказать во входе из-за недоступного журнала
    // хуже, чем потерять одну строку. Провал уедет в лог уровнем error.
    await this.audit.write({
      action: 'PLATFORM_ADMIN_SIGNED_IN',
      actorType: 'PLATFORM_ADMIN',
      actorId: adminId,
      tenantId: null,
      entityType: 'PlatformSession',
      entityId: session.id,
      newValue: { deviceEnrolled },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    const accessToken = signPlatformToken(
      { adminId, sessionId: session.id },
      platformTokenSecret(),
      ACCESS_TTL_SECONDS,
    )

    return {
      adminId,
      displayName,
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      refreshToken,
      sessionId: session.id,
      deviceEnrolled,
    }
  }

  /** Неудачная попытка: счётчик вверх, задержка, след в аудите. */
  private async recordFailure(
    adminId: string | null,
    email: string,
    reason: FailureReason,
    input: SignInInput,
  ): Promise<void> {
    if (adminId !== null) {
      const updated = await this.prisma.platformAdmin.update({
        where: { id: adminId },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      })

      const seconds = lockSecondsForAttempt(updated.failedAttempts)

      if (seconds > 0) {
        await this.prisma.platformAdmin.update({
          where: { id: adminId },
          data: { lockedUntil: new Date(input.now.getTime() + seconds * 1000) },
        })
      }
    }

    // Причина видна владельцу платформы в аудите и в логе — но не тому,
    // кто стучится: наружу уходит одна и та же ошибка.
    this.logger.warn(`Вход в админку платформы отклонён: ${reason}, почта ${maskEmail(email)}`)

    await this.audit.write(this.auditEntry(adminId, email, reason, input))
  }

  /**
   * Вход запасным ключом — отдельная запись в истории.
   *
   * Это не отказ и не обычный вход: владелец должен увидеть в журнале, что
   * кто-то воспользовался кодом восстановления, даже если это был он сам.
   * Молчаливое «вошёл как обычно» лишило бы единственного сигнала о том,
   * что бумажка с кодами попала в чужие руки.
   */
  private recoveryEntry(
    adminId: string,
    email: string,
    input: SignInInput,
  ): Parameters<AuditService['write']>[0] {
    return {
      action: 'PLATFORM_ADMIN_SIGNED_IN',
      actorType: 'PLATFORM_ADMIN',
      actorId: adminId,
      tenantId: null,
      entityType: 'PlatformAdmin',
      entityId: adminId,
      newValue: { исход: 'УСПЕХ', способ: 'КОД_ВОССТАНОВЛЕНИЯ', почта: maskEmail(email) },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    }
  }

  private auditEntry(
    adminId: string | null,
    email: string,
    reason: FailureReason,
    input: SignInInput,
  ): Parameters<AuditService['write']>[0] {
    return {
      action: 'PLATFORM_ADMIN_SIGNED_IN',
      actorType: 'PLATFORM_ADMIN',
      actorId: adminId,
      tenantId: null,
      entityType: 'PlatformAdmin',
      entityId: adminId,
      // Почта маскируется и здесь: аудит читает человек, и полный адрес
      // в нём не нужен для разбора, а утечь при выгрузке может.
      newValue: { исход: 'ОТКАЗ', причина: reason, почта: maskEmail(email) },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    }
  }

  /**
   * Потратить столько же времени, сколько ушло бы на настоящую проверку.
   *
   * Хеш считается один раз на процесс и переиспользуется: считать его каждый
   * раз заново означало бы платить вдвое там, где нужно ровно столько же.
   */
  private async burnTime(password: string): Promise<void> {
    dummyHash ??= await hashPin(randomBytes(16).toString('hex'))
    await verifyPin(password, dummyHash)
  }
}

/** «art.danon@gmail.com» → «ar***@gmail.com». Железное правило 5: PII не в логах. */
const maskEmail = (email: string): string => {
  const at = email.indexOf('@')

  if (at <= 0) {
    return '***'
  }

  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`
}
