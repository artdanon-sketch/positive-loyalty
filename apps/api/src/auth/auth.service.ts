import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import type { AuthTokens, Role } from '@positive/contracts'
import jwt from 'jsonwebtoken'

import { getEnv } from '../common/config/env'
import { signAccessToken } from '../common/tenant/access-token'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../core/prisma.service'

import { verifyPin } from './pin'

/**
 * Вход сотрудников и обновление сессий.
 * docs/02, разделы 1.3–1.4 · docs/05, раздел 2.
 *
 * ЕДИНЫЙ ОТВЕТ НА ВСЕ ОТКАЗЫ. Наружу всегда один и тот же 401 без подробностей:
 * не важно, устройство не зарегистрировано, сотрудник уволен, PIN неверный или
 * учётка заблокирована. Любое различие превращает эндпоинт в оракул — по нему
 * перебирают устройства и узнают, какие PIN «почти подошли».
 * Подробности уходят в лог, где их видит владелец, а не атакующий.
 */

/** Кассиру и менеджеру — 8 часов (docs/05, раздел 2): смена длинная, перелогин у кассы недопустим. */
const STAFF_ACCESS_TTL_SECONDS = 8 * 60 * 60
/** Refresh — 30 дней с ротацией на каждом использовании. */
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60

/** Порог блокировки PIN. Десять тысяч вариантов у четырёх цифр — перебор должен упираться быстро. */
const PIN_MAX_ATTEMPTS = 5
const PIN_LOCK_MINUTES = 15

interface RefreshClaims {
  readonly tenantId: string
  readonly sessionId: string
  readonly familyId: string
}

/** Refresh высокоэнтропийный и случайный — быстрый хеш здесь уместен, KDF не нужен. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(private readonly prisma: PrismaService) {}

  private get secret(): string {
    const secret = getEnv().accessTokenSecret
    if (secret.length === 0) {
      throw new Error('ACCESS_TOKEN_SECRET не задан: нечем подписывать и проверять токены')
    }
    return secret
  }

  private rejected(reason: string, details: Record<string, unknown> = {}): UnauthorizedException {
    // PII в лог не уходит: только идентификаторы и причина.
    this.logger.warn(`Вход отклонён: ${reason} ${JSON.stringify(details)}`)
    return new UnauthorizedException({
      error: { code: 'UNAUTHORIZED', message: 'Не удалось войти' },
    })
  }

  /**
   * Вход по PIN с зарегистрированного устройства.
   *
   * Заведение определяется устройством, а не телом запроса: `deviceId` глобально
   * уникален, и функция `auth_tenant_for_device` — единственный способ узнать
   * tenantId до аутентификации (см. миграцию 20260826190000).
   */
  async staffPinLogin(deviceId: string, pin: string): Promise<AuthTokens> {
    const resolved = await this.prisma.$queryRaw<Array<{ tenantId: string | null }>>`
      SELECT auth_tenant_for_device(${deviceId}) AS "tenantId"
    `
    const tenantId = resolved[0]?.tenantId ?? null

    if (tenantId === null) {
      throw this.rejected('устройство не зарегистрировано или отозвано', { deviceId })
    }

    const attempt = await this.prisma.forTenant(tenantId, async (tx) => {
      const device = await tx.staffDevice.findFirst({
        where: { deviceId, tenantId, isActive: true, revokedAt: null },
        select: { id: true, staffId: true },
      })

      if (device === null) {
        throw this.rejected('устройство не найдено внутри заведения', { deviceId })
      }

      const staff = await tx.staff.findFirst({
        where: { id: device.staffId, tenantId, isActive: true },
      })

      if (staff === null || staff.pinHash === null) {
        throw this.rejected('сотрудник неактивен или у него нет PIN', { staffId: device.staffId })
      }

      if (staff.pinLockedUntil !== null && staff.pinLockedUntil > new Date()) {
        throw this.rejected('вход временно заблокирован после серии неудач', { staffId: staff.id })
      }

      const ok = await verifyPin(pin, staff.pinHash)

      if (!ok) {
        // ЗАПИСЬ ШТРАФА ЗДЕСЬ НЕ ДЕЛАЕТСЯ, И ЭТО ГЛАВНОЕ В ЭТОМ МЕТОДЕ.
        //
        // Мы внутри транзакции forTenant. Любое исключение отсюда откатывает
        // её целиком — вместе с инкрементом счётчика неудач. Первая версия
        // так и была написана: счётчик увеличивался, потом throw, потом откат,
        // и блокировка не наступала НИКОГДА. Десять тысяч вариантов PIN
        // перебирались бы без единого препятствия.
        //
        // Поймано интеграционным тестом: после пяти неудач верный PIN
        // возвращал 200 вместо 401.
        //
        // Поэтому наружу отдаётся признак неудачи, а штраф пишется отдельной
        // транзакцией уже за пределами этой.
        return {
          outcome: 'PIN_MISMATCH' as const,
          staffId: staff.id,
          attempts: staff.pinFailedAttempts + 1,
        }
      }

      await tx.staff.update({
        where: { id: staff.id },
        data: { pinFailedAttempts: 0, pinLockedUntil: null, lastSeenAt: new Date() },
      })

      const tokens = await this.issueTokens(tx, {
        tenantId,
        staffId: staff.id,
        displayName: staff.displayName,
        role: staff.role,
        deviceId,
        familyId: randomUUID(),
        parentId: null,
      })

      return { outcome: 'OK' as const, tokens }
    })

    if (attempt.outcome === 'PIN_MISMATCH') {
      await this.penalizeFailedPin(tenantId, attempt.staffId, attempt.attempts)
      throw this.rejected('неверный PIN', {
        staffId: attempt.staffId,
        attempts: attempt.attempts,
      })
    }

    return attempt.tokens
  }

  /**
   * Записывает неудачную попытку PIN отдельной транзакцией.
   *
   * Отдельной — потому что транзакция входа откатывается вместе с отказом,
   * и штраф, записанный внутри неё, исчезает. Это ровно тот случай, когда
   * «сделать всё атомарно» даёт противоположный нужному результат: счётчик
   * неудач обязан пережить отказ, ради которого он и ведётся.
   */
  private async penalizeFailedPin(
    tenantId: string,
    staffId: string,
    attempts: number,
  ): Promise<void> {
    const locked = attempts >= PIN_MAX_ATTEMPTS

    await this.prisma.forTenant(tenantId, async (tx) => {
      await tx.staff.updateMany({
        where: { id: staffId, tenantId },
        data: {
          // При блокировке счётчик обнуляем: он начнёт заново после снятия.
          pinFailedAttempts: locked ? 0 : attempts,
          ...(locked ? { pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) } : {}),
        },
      })
    })
  }

  /**
   * Обновление сессии с ротацией.
   *
   * ПОВТОРНОЕ ИСПОЛЬЗОВАНИЕ ОТОЗВАННОГО REFRESH — СИГНАЛ КРАЖИ, а не ошибка
   * клиента. Отзывается ВСЯ цепочка (`familyId`), а не одно звено: если токен
   * украли, у вора и у владельца на руках разные звенья одной цепочки, и
   * отозвать надо обоих — законный владелец переживёт повторный вход,
   * вор не получит ничего (docs/05, раздел 2).
   *
   * tenantId лежит внутри подписанного refresh: без него запрос к сессиям не
   * прошёл бы RLS, а принимать заведение от клиента непроверенным нельзя.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let claims: RefreshClaims

    try {
      const payload = jwt.verify(refreshToken, this.secret, { algorithms: ['HS256'] })
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('нагрузка не объект')
      }
      const raw = payload as Record<string, unknown>
      if (
        typeof raw['tenantId'] !== 'string' ||
        typeof raw['sessionId'] !== 'string' ||
        typeof raw['familyId'] !== 'string'
      ) {
        throw new Error('в токене нет обязательных полей')
      }
      claims = {
        tenantId: raw['tenantId'],
        sessionId: raw['sessionId'],
        familyId: raw['familyId'],
      }
    } catch (error) {
      throw this.rejected('refresh не прошёл проверку подписи или срока', {
        reason: error instanceof Error ? error.message : 'неизвестно',
      })
    }

    const tokenHash = hashToken(refreshToken)

    const attempt = await this.prisma.forTenant(claims.tenantId, async (tx) => {
      const session = await tx.session.findFirst({
        where: { refreshTokenHash: tokenHash, tenantId: claims.tenantId },
      })

      if (session === null) {
        throw this.rejected('сессия не найдена', { sessionId: claims.sessionId })
      }

      if (session.revokedAt !== null) {
        // Кража. Но гасить цепочку ЗДЕСЬ нельзя: мы внутри транзакции, из
        // которой сейчас полетит отказ, и он откатит отзыв вместе с собой.
        // Та же ловушка, что со счётчиком неудачных PIN — и обнаружилась она
        // тоже тестом: украденный токен отвергался, а цепочка оставалась живой,
        // то есть вор просто пробовал следующее звено.
        return { outcome: 'REUSE_DETECTED' as const, familyId: session.familyId }
      }

      if (session.expiresAt <= new Date()) {
        throw this.rejected('срок сессии истёк', { sessionId: session.id })
      }

      const staff =
        session.staffId === null
          ? null
          : await tx.staff.findFirst({
              where: { id: session.staffId, tenantId: claims.tenantId, isActive: true },
            })

      if (staff === null) {
        throw this.rejected('сотрудник сессии неактивен', { sessionId: session.id })
      }

      await tx.session.update({
        where: { id: session.id },
        data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'TOKEN_ROTATED' },
      })

      const tokens = await this.issueTokens(tx, {
        tenantId: claims.tenantId,
        staffId: staff.id,
        displayName: staff.displayName,
        role: staff.role,
        deviceId: session.deviceId,
        familyId: session.familyId,
        parentId: session.id,
      })

      return { outcome: 'OK' as const, tokens }
    })

    if (attempt.outcome === 'REUSE_DETECTED') {
      await this.revokeFamily(claims.tenantId, attempt.familyId)
      throw this.rejected('повторное использование отозванного refresh', {
        familyId: attempt.familyId,
      })
    }

    return attempt.tokens
  }

  /**
   * Гасит всю цепочку сессий одного входа.
   *
   * Именно всю, а не украденное звено: у вора и у законного владельца на руках
   * разные звенья одной цепочки, и определить, кто из них кто, невозможно.
   * Владелец переживёт повторный вход, вор не получит ничего (docs/05, раздел 2).
   *
   * Отдельная транзакция по той же причине, что и штраф за PIN: вызывающий
   * сразу после этого бросает отказ, и запись внутри его транзакции откатилась бы.
   */
  private async revokeFamily(tenantId: string, familyId: string): Promise<void> {
    const revoked = await this.prisma.forTenant(tenantId, async (tx) =>
      tx.session.updateMany({
        where: { tenantId, familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSED' },
      }),
    )

    this.logger.error(
      `Повторное использование отозванного refresh: цепочка ${familyId} погашена ` +
        `целиком, звеньев отозвано ${revoked.count}. ` +
        'Сигнал в risk-модуль появится вместе с ним.',
    )
  }

  private async issueTokens(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string
      staffId: string
      displayName: string
      role: Role
      deviceId: string | null
      familyId: string
      parentId: string | null
    },
  ): Promise<AuthTokens> {
    const sessionId = randomUUID()
    // 32 байта случайности внутри подписанного токена: даже при утечке секрета
    // подобрать конкретную сессию по хешу невозможно.
    const nonce = randomBytes(32).toString('base64url')

    const refreshToken = jwt.sign(
      { tenantId: input.tenantId, sessionId, familyId: input.familyId, nonce },
      this.secret,
      { algorithm: 'HS256', expiresIn: REFRESH_TTL_SECONDS },
    )

    await tx.session.create({
      data: {
        id: sessionId,
        tenantId: input.tenantId,
        staffId: input.staffId,
        familyId: input.familyId,
        parentId: input.parentId,
        refreshTokenHash: hashToken(refreshToken),
        deviceId: input.deviceId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1_000),
      },
    })

    const accessToken = signAccessToken(
      { tenantId: input.tenantId, actorId: input.staffId, role: input.role },
      this.secret,
      STAFF_ACCESS_TTL_SECONDS,
    )

    return {
      accessToken,
      refreshToken,
      expiresIn: STAFF_ACCESS_TTL_SECONDS,
      subject: {
        staffId: input.staffId,
        displayName: input.displayName,
        role: input.role,
        tenantId: input.tenantId,
      },
    }
  }
}
