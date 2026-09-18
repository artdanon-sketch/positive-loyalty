import { Injectable, Logger } from '@nestjs/common'
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'

import { getEnv } from '../common/config/env'
import { PrismaService } from '../core/prisma.service'

import { parseStart, type TelegramApi } from './telegram-api'
import { TelegramApiFactory } from './telegram-api.factory'
import { VenueBotLinkService } from './venue-bot-link.service'

/**
 * Разбор сообщений ботов заведений. docs/02, раздел 5.18.
 *
 * ОПРОС НА КАЖДОГО БОТА, как и у общего (telegram-updates.service.ts): вебхук
 * потребовал бы знать свой публичный адрес и не работал бы на машине
 * разработчика. Цена известна: одно соединение на заведение и один процесс
 * на всех. При десятках заведений это переедет в воркер — менять придётся
 * этот файл, и только его.
 *
 * СПИСОК БОТОВ ПЕРЕЧИТЫВАЕТСЯ НА ХОДУ. Владелец подключает бота посреди дня,
 * и заставлять его ждать перезапуска сервера — значит получить обращение
 * «я всё сделал, ничего не работает».
 *
 * БОТ ОТВЕЧАЕТ ВСЕГДА. Молчание в ответ на «Запустить» гость читает как
 * поломку, даже когда код просто просрочен.
 */

/** Сколько Telegram держит наш запрос, если сообщений нет. */
const WAIT_SECONDS = 25
/** Как часто перечитываем список ботов. */
const REFRESH_MS = 60_000

interface Runner {
  readonly stop: AbortController
  readonly task: Promise<void>
}

@Injectable()
export class VenueBotUpdatesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VenueBotUpdatesService.name)
  private readonly runners = new Map<string, Runner>()
  private refresh: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: VenueBotLinkService,
    private readonly telegram: TelegramApiFactory,
  ) {}

  onApplicationBootstrap(): void {
    if (getEnv().nodeEnv === 'test') {
      // В тестах фоновых соединений с внешним миром не открываем: они
      // переживут тест и превратят набор в мигающий.
      return
    }

    this.running = true
    void this.sync()

    this.refresh = setInterval(() => {
      void this.sync()
    }, REFRESH_MS)

    this.refresh.unref()
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false

    if (this.refresh !== null) {
      clearInterval(this.refresh)
    }

    for (const runner of this.runners.values()) {
      runner.stop.abort()
    }

    await Promise.all([...this.runners.values()].map((runner) => runner.task))
    this.runners.clear()
  }

  /** Привести набор опросов в соответствие со списком подключённых ботов. */
  private async sync(): Promise<void> {
    if (!this.running) {
      return
    }

    let bots: Array<{ tenantId: string; token: string }>

    try {
      bots = await this.prisma.venueBot.findMany({
        where: { isActive: true },
        select: { tenantId: true, token: true },
      })
    } catch (error) {
      this.logger.warn(
        `Список ботов не прочитан: ${error instanceof Error ? error.message : 'неизвестно'}`,
      )

      return
    }

    const alive = new Set(bots.map((bot) => bot.tenantId))

    for (const [tenantId, runner] of this.runners) {
      if (!alive.has(tenantId)) {
        runner.stop.abort()
        this.runners.delete(tenantId)
      }
    }

    for (const bot of bots) {
      if (!this.runners.has(bot.tenantId)) {
        const stop = new AbortController()
        this.runners.set(bot.tenantId, {
          stop,
          task: this.poll(bot.tenantId, bot.token, stop),
        })
      }
    }
  }

  private async poll(tenantId: string, token: string, stop: AbortController): Promise<void> {
    const api = this.telegram.for(token)

    // Накопленное за время простоя пропускаем: коды приглашений живут час,
    // и отвечать на позавчерашние «Запустить» бессмысленно.
    let offset: number | null = await this.freshOffset(api)

    while (this.running && !stop.signal.aborted) {
      try {
        const updates = await api.getUpdates(offset ?? 0, WAIT_SECONDS, stop.signal)

        for (const update of updates) {
          offset = update.update_id + 1
          await this.handle(tenantId, api, parseStart(update))
        }
      } catch (error) {
        if (stop.signal.aborted) {
          return
        }

        this.logger.warn(
          `Опрос бота заведения ${tenantId} прерван: ${
            error instanceof Error ? error.message : 'неизвестно'
          }`,
        )

        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }
    }
  }

  /** Где начинать чтение: сразу после последнего накопленного сообщения. */
  private async freshOffset(api: TelegramApi): Promise<number | null> {
    try {
      const last = await api.getUpdates(-1, 0)
      const newest = last.at(-1)

      return newest === undefined ? null : newest.update_id + 1
    } catch {
      // Telegram недоступен — начнём с начала очереди: лишний ответ «ссылка
      // устарела» дешевле, чем несработавший опрос.
      return null
    }
  }

  private async handle(
    tenantId: string,
    api: TelegramApi,
    start: ReturnType<typeof parseStart>,
  ): Promise<void> {
    if (start === null) {
      return
    }

    const claimed =
      start.payload === null ? null : await this.links.claim(tenantId, start.payload, start.chatId)

    const reply =
      claimed === null
        ? 'Откройте свою карту в приложении и нажмите «Получать сообщения от заведения» — ссылка действует час.'
        : 'Готово: теперь новости и подарки этого заведения приходят сюда.'

    try {
      await api.sendMessage(start.chatId, reply)
    } catch (error) {
      // Чат уже связан, и молчание бота этого не отменяет.
      this.logger.warn(
        `Бот заведения ${tenantId} не ответил гостю: ${
          error instanceof Error ? error.message : 'неизвестно'
        }`,
      )
    }
  }
}
