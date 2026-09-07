import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import type { TelegramClaimResult, TelegramLoginStartResult } from '@positive/contracts'

import { PrismaService } from '../core/prisma.service'

import { GuestAuthService } from './guest-auth.service'
import { TelegramBotService } from './telegram-bot.service'
import type { TelegramStart } from './telegram-api'

/**
 * Вход через Telegram: трёхсторонний обмен, описанный в контракте
 * `TelegramLoginStartResult`.
 *
 *   приложение  ->  «начинаю вход»        ->  сервер выдаёт ссылку
 *   гость       ->  нажимает «Запустить»  ->  бот сообщает серверу, кто это
 *   приложение  ->  «уже?» ... «уже?»     ->  сервер отдаёт сессию, один раз
 *
 * ПОЧЕМУ ПРИЛОЖЕНИЕ СПРАШИВАЕТ, А НЕ СЕРВЕР СООБЩАЕТ. Подтверждение приходит
 * с ДРУГОГО устройства: гость может открыть ссылку на телефоне, а входить
 * на планшете. Толкать результат некуда — соединения с тем, кто начал вход,
 * может уже не быть. Опрос раз в пару секунд на пять минут — это ничтожная
 * нагрузка и никакой новой инфраструктуры.
 */

/** Пять минут — столько же, сколько живёт код подтверждения (docs/02, 1.1). */
const LOGIN_TTL_SECONDS = 300
/** Реже спрашивать незачем, чаще — не нужно. */
const POLL_AFTER_SECONDS = 2

/**
 * Сколько входов можно начать с одного адреса за десять минут.
 *
 * Ограничение здесь не про безопасность гостя, а про наш ресурс: эндпоинт
 * публичный и создаёт строку в базе (OWASP API4, docs/05 раздел 4). Порог
 * заведомо выше любого человеческого поведения — гость, у которого не вышло
 * с третьего раза, пойдёт входить другим способом, а не двадцатым.
 */
const START_LIMIT = 10
const START_WINDOW_MS = 10 * 60_000

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** Сравнение хешей за постоянное время: длина у SHA-256 всегда одна. */
const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

const pending = (): TelegramClaimResult => ({ state: 'PENDING', session: null })
const expired = (): TelegramClaimResult => ({ state: 'EXPIRED', session: null })

/** Что известно о попытке входа к моменту, когда приложение спрашивает результат. */
export interface ClaimSubject {
  readonly claimSecretHash: string
  readonly telegramUserId: string | null
  readonly confirmedAt: Date | null
  readonly claimedAt: Date | null
  readonly expiresAt: Date
}

/**
 * Решение по одному опросу: отказать, ждать дальше или выдавать сессию.
 *
 * Вынесено отдельной чистой функцией намеренно. Здесь живёт вся защита этого
 * входа — секрет, срок, однократность, — и проверить её тестом важнее, чем
 * что-либо ещё в модуле. Функция без базы и без сети проверяется целиком.
 */
export const decideClaim = (
  subject: ClaimSubject | null,
  presentedSecret: string,
  now: Date,
): 'EXPIRED' | 'PENDING' | 'TAKE' => {
  if (subject === null || !sameHash(subject.claimSecretHash, hashToken(presentedSecret))) {
    return 'EXPIRED'
  }

  if (subject.claimedAt !== null || subject.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED'
  }

  if (subject.confirmedAt === null || subject.telegramUserId === null) {
    return 'PENDING'
  }

  return 'TAKE'
}

@Injectable()
export class TelegramLoginService {
  private readonly logger = new Logger(TelegramLoginService.name)

  /**
   * Счётчик начатых входов по адресу. В памяти процесса намеренно: цена
   * промаха при перезапуске — десяток лишних строк в таблице, а вынесение
   * счётчика в Redis ради этого добавило бы зависимость и точку отказа
   * прямо на пути входа. Общий rate limit по ТЗ живёт перед API, на Cloudflare.
   */
  private readonly starts = new Map<string, number[]>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
    private readonly guestAuth: GuestAuthService,
  ) {}

  private unavailable(): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'CHANNEL_UNAVAILABLE',
        message: 'Вход через Telegram не настроен',
      },
    })
  }

  private allow(ip: string): boolean {
    const now = Date.now()
    const fresh = (this.starts.get(ip) ?? []).filter((at) => now - at < START_WINDOW_MS)

    if (fresh.length >= START_LIMIT) {
      this.starts.set(ip, fresh)
      return false
    }

    fresh.push(now)
    this.starts.set(ip, fresh)

    // Карта не должна расти вечно: адреса, по которым давно не ходили,
    // выбрасываем попутно. Отдельного таймера ради этого заводить незачем.
    if (this.starts.size > 10_000) {
      for (const [key, times] of this.starts) {
        if (times.every((at) => now - at >= START_WINDOW_MS)) {
          this.starts.delete(key)
        }
      }
    }

    return true
  }

  /** Начало входа: одноразовая ссылка на бота. */
  async start(ip: string): Promise<TelegramLoginStartResult> {
    if (!this.bot.enabled) {
      throw this.unavailable()
    }

    if (!this.allow(ip)) {
      throw new BadRequestException({
        error: {
          code: 'RATE_LIMITED',
          message: 'Слишком много попыток входа. Подождите десять минут.',
        },
      })
    }

    let username: string

    try {
      username = await this.bot.username()
    } catch (error) {
      this.logger.error(
        `Не удалось узнать имя бота: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )
      throw this.unavailable()
    }

    // Истёкшие попытки чистим здесь же. Их единицы, и отдельное задание
    // по расписанию ради такой таблицы — деталь, которую придётся содержать.
    await this.prisma.telegramLoginRequest.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } },
    })

    // 24 байта — 32 символа base64url. Telegram допускает в параметре ссылки
    // до 64 символов из [A-Za-z0-9_-], base64url укладывается ровно в них.
    const nonce = randomBytes(24).toString('base64url')
    const claimSecret = randomBytes(32).toString('base64url')

    const request = await this.prisma.telegramLoginRequest.create({
      data: {
        nonceHash: hashToken(nonce),
        claimSecretHash: hashToken(claimSecret),
        expiresAt: new Date(Date.now() + LOGIN_TTL_SECONDS * 1_000),
      },
      select: { id: true },
    })

    return {
      requestId: request.id,
      claimSecret,
      url: `https://t.me/${username}?start=${nonce}`,
      expiresIn: LOGIN_TTL_SECONDS,
      pollAfter: POLL_AFTER_SECONDS,
    }
  }

  /**
   * Подтверждение от бота. Вызывается разбором сообщений, не контроллером.
   *
   * Возвращает текст, который бот скажет гостю в ответ. Решение о тексте
   * принимается здесь, а не в разборе сообщений: только здесь известно,
   * нашлась ли попытка входа и не протухла ли она.
   */
  async confirm(start: TelegramStart): Promise<string> {
    if (start.payload === null) {
      return (
        'Это бот программы лояльности POSitive.\n\n' +
        'Чтобы войти, откройте приложение и нажмите «Войти через Telegram» — ' +
        'оттуда вы вернётесь сюда по ссылке, и вход завершится сам.'
      )
    }

    const now = new Date()

    // Одним запросом: находим по хешу кода И проверяем, что попытка ещё жива
    // и никем не занята. Пара «прочитать, потом обновить» здесь дала бы
    // возможность подтвердить одну попытку дважды.
    const { count } = await this.prisma.telegramLoginRequest.updateMany({
      where: {
        nonceHash: hashToken(start.payload),
        confirmedAt: null,
        claimedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        confirmedAt: now,
        telegramUserId: start.userId,
        displayName: start.displayName,
        locale: start.locale,
      },
    })

    if (count === 0) {
      return 'Ссылка устарела. Вернитесь в приложение и нажмите «Войти через Telegram» ещё раз.'
    }

    // Ни имени, ни идентификатора гостя в лог: это персональные данные
    // (железное правило 5). Факт события — можно.
    this.logger.log('Вход через Telegram подтверждён гостем')

    return 'Готово. Возвращайтесь в приложение — вы уже вошли.'
  }

  /**
   * «Уже?» от приложения.
   *
   * Три причины отказа — нет такой попытки, не тот секрет, срок вышел —
   * отвечают одинаково. Различать их снаружи значит подсказывать,
   * существует ли попытка с таким идентификатором.
   */
  async claim(requestId: string, claimSecret: string): Promise<TelegramClaimResult> {
    if (!this.bot.enabled) {
      throw this.unavailable()
    }

    const request = await this.prisma.telegramLoginRequest.findUnique({
      where: { id: requestId },
      select: {
        claimSecretHash: true,
        telegramUserId: true,
        displayName: true,
        locale: true,
        confirmedAt: true,
        claimedAt: true,
        expiresAt: true,
      },
    })

    const verdict = decideClaim(request, claimSecret, new Date())

    if (verdict === 'EXPIRED') {
      return expired()
    }

    if (verdict === 'PENDING') {
      return pending()
    }

    if (request === null || request.telegramUserId === null) {
      // Недостижимо: «выдавать» получается только при заполненных полях.
      // Проверка нужна компилятору — и она же поймает расхождение, если
      // решение однажды изменят, а это место забудут.
      return expired()
    }

    // Забрать сессию можно ровно один раз, и решает это база, а не проверка
    // выше: два одновременных опроса иначе создали бы две сессии.
    const taken = await this.prisma.telegramLoginRequest.updateMany({
      where: { id: requestId, claimedAt: null },
      data: { claimedAt: new Date() },
    })

    if (taken.count === 0) {
      return expired()
    }

    const session = await this.guestAuth.loginWithTelegram(
      {
        externalId: request.telegramUserId,
        // Почты Telegram не даёт — склейка карт только вручную.
        email: null,
        displayName: request.displayName,
      },
      request.locale ?? 'ru',
    )

    return { state: 'READY', session }
  }
}
