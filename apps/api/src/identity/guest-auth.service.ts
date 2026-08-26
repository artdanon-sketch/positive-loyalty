import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'

import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import type { GuestAuthResult, OtpChannel, OtpRequestResult } from '@positive/contracts'
import jwt from 'jsonwebtoken'

import { hashPin, verifyPin } from '../auth/pin'
import { getEnv } from '../common/config/env'
import { signGuestToken } from '../common/tenant/access-token'
import { PrismaService } from '../core/prisma.service'

/**
 * Вход гостя по коду подтверждения. docs/02, разделы 1.1–1.2.
 *
 * КАНАЛ ДОСТАВКИ — DEV, ПОКА НЕТ SMS-ПРОВАЙДЕРА. Решение владельца «пока без
 * SMS»: код пишется в лог сервера, а вне production дополнительно возвращается
 * в ответе (поле devCode) — иначе гостевой контур нельзя ни разрабатывать,
 * ни показывать. Появится провайдер — добавится канал, форма ответа не
 * изменится: devCode в production не отдаётся УЖЕ СЕЙЧАС, и это проверяет тест.
 *
 * Хеширование кода — тем же scrypt, что PIN сотрудника: шесть цифр, та же
 * честная оценка стойкости, тот же вывод — защищают лимит попыток и срок
 * жизни, а хеш лишь не даёт прочитать коды из украденной базы.
 */

/** docs/02, раздел 1.1: код живёт 5 минут, повтор не раньше чем через 60 секунд. */
const OTP_TTL_SECONDS = 300
const OTP_RESEND_SECONDS = 60
/** docs/02, раздел 1.2: пять неверных попыток — блокировка requestId. */
const OTP_MAX_ATTEMPTS = 5
/** docs/02, раздел 1.1: три запроса на номер за десять минут. */
const OTP_PHONE_LIMIT = 3
const OTP_PHONE_WINDOW_MS = 10 * 60_000

/** docs/05, раздел 2: access гостя 15 минут, refresh 30 дней с ротацией. */
const GUEST_ACCESS_TTL_SECONDS = 15 * 60
const GUEST_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

const maskPhone = (e164: string): string => `${e164.slice(0, 3)} •• •• ${e164.slice(-4)}`

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

interface GuestRefreshClaims {
  readonly guestId: string
  readonly sessionId: string
  readonly familyId: string
}

@Injectable()
export class GuestAuthService {
  private readonly logger = new Logger(GuestAuthService.name)

  constructor(private readonly prisma: PrismaService) {}

  private get secret(): string {
    const secret = getEnv().accessTokenSecret
    if (secret.length === 0) {
      throw new Error('ACCESS_TOKEN_SECRET не задан: нечем подписывать гостевые токены')
    }
    return secret
  }

  private rejected(reason: string, details: Record<string, unknown> = {}): UnauthorizedException {
    this.logger.warn(`Гостевой вход отклонён: ${reason} ${JSON.stringify(details)}`)
    return new UnauthorizedException({
      error: { code: 'UNAUTHORIZED', message: 'Не удалось войти' },
    })
  }

  async requestOtp(phone: string, channel: OtpChannel): Promise<OtpRequestResult> {
    if (channel !== 'DEV') {
      // Честный отказ вместо тихой подмены канала: касса и приложение должны
      // знать, что SMS ещё нет, а не думать, что код «где-то потерялся».
      throw new BadRequestException({
        error: {
          code: 'CHANNEL_UNAVAILABLE',
          message: 'Пока доступен только DEV-канал: SMS-провайдер не подключён',
        },
      })
    }

    const since = new Date(Date.now() - OTP_PHONE_WINDOW_MS)
    const recent = await this.prisma.otpRequest.count({
      where: { phoneE164: phone, createdAt: { gt: since } },
    })

    if (recent >= OTP_PHONE_LIMIT) {
      // 429 по контракту docs/02, раздел 1.1.
      throw new BadRequestException({
        error: {
          code: 'RATE_LIMITED',
          message: 'Слишком много запросов кода. Подождите десять минут.',
        },
      })
    }

    // randomInt криптостойкий; ведущие нули сохраняются форматированием.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')

    const request = await this.prisma.otpRequest.create({
      data: {
        phoneE164: phone,
        codeHash: await hashPin(code),
        channel,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1_000),
      },
      select: { id: true },
    })

    const production = getEnv().nodeEnv === 'production'

    // Телефон в лог — только маской (железное правило 5). Код — только вне
    // production: это и есть DEV-канал доставки.
    this.logger.log(
      `Код подтверждения для ${maskPhone(phone)}: ${production ? '[скрыт]' : code} ` +
        `(requestId ${request.id})`,
    )

    return {
      requestId: request.id,
      expiresIn: OTP_TTL_SECONDS,
      resendAfter: OTP_RESEND_SECONDS,
      ...(production ? {} : { devCode: code }),
    }
  }

  async verifyOtp(requestId: string, code: string): Promise<GuestAuthResult> {
    const request = await this.prisma.otpRequest.findFirst({ where: { id: requestId } })

    if (request === null) {
      throw this.rejected('запрос кода не найден', { requestId })
    }
    if (request.verifiedAt !== null) {
      throw this.rejected('код уже использован', { requestId })
    }
    if (request.expiresAt <= new Date()) {
      throw this.rejected('код просрочен', { requestId })
    }
    if (request.attempts >= OTP_MAX_ATTEMPTS) {
      throw this.rejected('запрос заблокирован после серии неудач', { requestId })
    }

    const ok = await verifyPin(code, request.codeHash)

    if (!ok) {
      // Счётчик — отдельным запросом ДО отказа, а не в транзакции с ним:
      // урок входа по PIN — штраф, записанный в отменяемой транзакции,
      // не наступает никогда.
      await this.prisma.otpRequest.update({
        where: { id: request.id },
        data: { attempts: { increment: 1 } },
      })
      throw this.rejected('неверный код', { requestId, attempts: request.attempts + 1 })
    }

    await this.prisma.otpRequest.update({
      where: { id: request.id },
      data: { verifiedAt: new Date() },
    })

    // Гость по телефону: существующий или новый. Телефон уникален — гонка
    // двух verify упрётся в UNIQUE, а не создаст дубль человека.
    const existing = await this.prisma.guest.findFirst({
      where: { phoneE164: request.phoneE164 },
    })

    const guest =
      existing ??
      (await this.prisma.guest.create({
        data: { phoneE164: request.phoneE164 },
      }))

    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { lastSeenAt: new Date() },
    })

    return this.issueTokens(guest, existing === null, randomUUID(), null)
  }

  /** Ротация refresh гостя. Механика та же, что у сотрудников: повтор гасит цепочку. */
  async refresh(refreshToken: string): Promise<GuestAuthResult> {
    let claims: GuestRefreshClaims

    try {
      const payload = jwt.verify(refreshToken, this.secret, { algorithms: ['HS256'] })
      const raw = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
        string,
        unknown
      >
      if (
        raw['kind'] !== 'guest-refresh' ||
        typeof raw['guestId'] !== 'string' ||
        typeof raw['sessionId'] !== 'string' ||
        typeof raw['familyId'] !== 'string'
      ) {
        throw new Error('не гостевой refresh')
      }
      claims = {
        guestId: raw['guestId'],
        sessionId: raw['sessionId'],
        familyId: raw['familyId'],
      }
    } catch (error) {
      throw this.rejected('refresh не прошёл проверку', {
        reason: error instanceof Error ? error.message : 'неизвестно',
      })
    }

    const session = await this.prisma.guestSession.findFirst({
      where: { refreshTokenHash: hashToken(refreshToken) },
    })

    if (session === null) {
      throw this.rejected('сессия не найдена', { sessionId: claims.sessionId })
    }

    if (session.revokedAt !== null) {
      const revoked = await this.prisma.guestSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSED' },
      })
      this.logger.error(
        `Повтор отозванного гостевого refresh: цепочка ${session.familyId} погашена, ` +
          `звеньев ${revoked.count}.`,
      )
      throw this.rejected('повтор отозванного refresh', { familyId: session.familyId })
    }

    if (session.expiresAt <= new Date()) {
      throw this.rejected('срок сессии истёк', { sessionId: session.id })
    }

    const guest = await this.prisma.guest.findFirst({ where: { id: session.guestId } })
    if (guest === null) {
      throw this.rejected('гость сессии не найден', { sessionId: session.id })
    }

    await this.prisma.guestSession.update({
      where: { id: session.id },
      data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'TOKEN_ROTATED' },
    })

    return this.issueTokens(guest, false, session.familyId, session.id)
  }

  private async issueTokens(
    guest: { id: string; displayName: string | null; mode: string; locale: string },
    isNew: boolean,
    familyId: string,
    parentId: string | null,
  ): Promise<GuestAuthResult> {
    const sessionId = randomUUID()
    const nonce = randomBytes(32).toString('base64url')

    const refreshToken = jwt.sign(
      { kind: 'guest-refresh', guestId: guest.id, sessionId, familyId, nonce },
      this.secret,
      { algorithm: 'HS256', expiresIn: GUEST_REFRESH_TTL_SECONDS },
    )

    await this.prisma.guestSession.create({
      data: {
        id: sessionId,
        guestId: guest.id,
        familyId,
        parentId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + GUEST_REFRESH_TTL_SECONDS * 1_000),
      },
    })

    return {
      accessToken: signGuestToken({ guestId: guest.id }, this.secret, GUEST_ACCESS_TTL_SECONDS),
      refreshToken,
      expiresIn: GUEST_ACCESS_TTL_SECONDS,
      guest: {
        id: guest.id,
        displayName: guest.displayName,
        mode: guest.mode as 'TOURIST' | 'RESIDENT',
        locale: guest.locale,
      },
      isNew,
    }
  }
}
