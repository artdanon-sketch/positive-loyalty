import { Injectable, Logger } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { TelegramApi } from './telegram-api'

/**
 * Один бот на всё приложение: и вход, и — в будущем — доставка кодов
 * и уведомлений. Отдельный провайдер нужен ровно затем, чтобы ключ бота
 * читался в одном месте, а имя бота спрашивалось у Telegram один раз.
 *
 * ПОЧЕМУ ИМЯ БОТА НЕ ОТДЕЛЬНАЯ ПЕРЕМЕННАЯ ОКРУЖЕНИЯ. Оно однозначно следует
 * из ключа, и Telegram отдаёт его сам. Лишняя переменная — это лишний шанс
 * ошибиться: разъехавшись с ключом, она дала бы ссылку на чужого бота,
 * причём внешне рабочую.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name)
  private cachedUsername: string | null = null
  private pending: Promise<string> | null = null

  /** Ключ не задан — вход через Telegram выключен целиком, а не «наполовину». */
  get enabled(): boolean {
    return getEnv().telegramBotToken !== ''
  }

  get api(): TelegramApi {
    const token = getEnv().telegramBotToken
    if (token === '') {
      throw new Error('TELEGRAM_BOT_TOKEN не задан: обращаться к Telegram нечем')
    }
    return new TelegramApi(token)
  }

  /**
   * Имя бота для ссылки `t.me/<имя>`. Спрашивается у Telegram один раз
   * и запоминается: оно не меняется, пока владелец сам его не сменит.
   *
   * Параллельные вызовы разделяют одно обещание — иначе первый же наплыв
   * входов превратился бы в десяток одинаковых запросов к Telegram.
   */
  async username(): Promise<string> {
    if (this.cachedUsername !== null) {
      return this.cachedUsername
    }

    this.pending ??= this.api
      .getMe()
      .then((me) => {
        this.cachedUsername = me.username
        this.logger.log(`Бот Telegram опознан: @${me.username}`)
        return me.username
      })
      .finally(() => {
        // Неудачу не кэшируем: следующий вход должен попробовать заново.
        this.pending = null
      })

    return this.pending
  }
}
