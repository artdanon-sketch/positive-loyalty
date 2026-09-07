import { Injectable, Logger } from '@nestjs/common'
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { parseStart } from './telegram-api'
import { TelegramBotService } from './telegram-bot.service'
import { TelegramLoginService } from './telegram-login.service'

/**
 * Разбор сообщений бота: единственное место, где мы узнаём, что гость нажал
 * «Запустить».
 *
 * ПОЧЕМУ МЫ СПРАШИВАЕМ TELEGRAM, А НЕ ОН НАС. У Telegram есть два способа
 * доставки: вебхук (он стучится к нам) и опрос (мы держим открытый запрос
 * и ждём). Выбран опрос, и вот почему:
 *
 * - Вебхук требует, чтобы мы знали и настроили СВОЙ публичный адрес. Это ещё
 *   одна переменная окружения, которая молча разъедется при переезде сервера,
 *   и отказ будет тихим: бот просто перестанет отвечать.
 * - Вебхук не работает на машине разработчика без туннеля наружу. Опрос
 *   работает одинаково и локально, и на сервере — то есть проверить вход
 *   можно там же, где пишется код.
 *
 * ЦЕНА. Опрос держит одно постоянное соединение с Telegram и требует, чтобы
 * процесс был ОДИН: два одновременных опроса одного бота Telegram отвергает
 * ошибкой «Conflict». Сегодня API работает в один процесс. Когда их станет
 * несколько, разбор переедет в воркер (docs/01, раздел 6) или на вебхук —
 * менять придётся этот файл, и только его.
 */

/** Сколько Telegram держит наш запрос, если сообщений нет. */
const WAIT_SECONDS = 30
/** Пауза после сбоя. Растёт до минуты, чтобы не молотить лог при поломке. */
const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000

@Injectable()
export class TelegramUpdatesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUpdatesService.name)
  private running = false
  private loop: Promise<void> | null = null
  private readonly stop = new AbortController()

  constructor(
    private readonly bot: TelegramBotService,
    private readonly login: TelegramLoginService,
  ) {}

  onApplicationBootstrap(): void {
    if (getEnv().nodeEnv === 'test') {
      // В тестах фоновых соединений с внешним миром не открываем: они
      // переживут тест и превратят набор в мигающий.
      return
    }

    if (!this.bot.enabled) {
      this.logger.log('Вход через Telegram выключен: TELEGRAM_BOT_TOKEN не задан')
      return
    }

    this.running = true
    this.loop = this.run()
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false
    // Обрываем ожидание немедленно: Telegram держит запрос до сорока пяти
    // секунд, и без обрыва каждый выкат вставал бы на эту паузу.
    this.stop.abort()
    // Но завершения круга дожидаемся: иначе процесс погасят посреди разбора
    // сообщения, и гость останется с подтверждением, о котором никто не узнал.
    await this.loop
  }

  private async pause(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Пропускает всё, что накопилось, пока сервер был выключен.
   *
   * Разбирать накопленное вредно: попытки входа живут пять минут, и старые
   * сообщения годятся лишь на то, чтобы бот ответил «ссылка устарела» тем,
   * кто уже давно вошёл другим способом.
   */
  private async skipBacklog(): Promise<number | null> {
    const last = await this.bot.api.getUpdates(-1, 0)
    const newest = last.at(-1)
    return newest === undefined ? null : newest.update_id + 1
  }

  private async handle(update: ReturnType<typeof parseStart>): Promise<void> {
    if (update === null) {
      return
    }

    const reply = await this.login.confirm(update)

    try {
      await this.bot.api.sendMessage(update.chatId, reply)
    } catch (error) {
      // Вход уже подтверждён, приложение его заберёт. Молчание бота —
      // неприятно, но не повод считать попытку неудавшейся и тем более
      // не повод останавливать разбор.
      this.logger.warn(
        `Не удалось ответить гостю в Telegram: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )
    }
  }

  private async run(): Promise<void> {
    let offset: number | null = null
    let retry = RETRY_MIN_MS

    try {
      offset = await this.skipBacklog()
      this.logger.log('Разбор сообщений Telegram запущен')
    } catch (error) {
      this.logger.warn(
        `Не удалось пропустить старые сообщения: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )
    }

    while (this.running) {
      try {
        const updates = await this.bot.api.getUpdates(offset, WAIT_SECONDS, this.stop.signal)
        retry = RETRY_MIN_MS

        for (const update of updates) {
          // Сдвигаем указатель ДО разбора: сообщение, на котором мы споткнулись,
          // не должно возвращаться бесконечно и блокировать всю очередь.
          offset = update.update_id + 1

          try {
            await this.handle(parseStart(update))
          } catch (error) {
            this.logger.error(
              `Сообщение Telegram не разобрано: ${error instanceof Error ? error.message : 'неизвестно'}`,
            )
          }
        }
      } catch (error) {
        if (!this.running) {
          break
        }

        this.logger.warn(
          `Разбор сообщений Telegram прерван: ${error instanceof Error ? error.message : 'неизвестно'}`,
        )
        await this.pause(retry)
        retry = Math.min(retry * 2, RETRY_MAX_MS)
      }
    }

    this.logger.log('Разбор сообщений Telegram остановлен')
  }
}
