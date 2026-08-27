import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { WebhookOutboxService } from './webhook-outbox.service'

/**
 * Разгребатель исходящей очереди: заводит доставки и отправляет их.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, И ЭТО ВРЕМЕННО. По docs/01, раздел 6 фоновые
 * задачи — дело `apps/worker`. Но воркер сейчас пуст, а очередь без
 * разгребателя бесполезна: события копились бы и не уходили никогда.
 *
 * Переезд дешёвый и не тронет ничего, кроме этого файла: сама очередь живёт
 * в базе, а не в памяти процесса, и разбирать её может кто угодно. Именно
 * поэтому она и в базе.
 *
 * ПРОХОД НЕ НАКЛАДЫВАЕТСЯ САМ НА СЕБЯ. Отправка ходит по сети, и медленный
 * получатель растянет проход дольше интервала. Два одновременных прохода
 * не сломают данные — уникальный индекс и статусы это выдержат, — но сожгут
 * попытки вдвое быстрее, чем задумано в расписании повторов.
 */

/** Как часто разгребаем. Две секунды: касса показывает «свежий» баланс. */
const SWEEP_INTERVAL_MS = 2_000

@Injectable()
export class WebhookOutboxSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookOutboxSweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly outbox: WebhookOutboxService) {}

  onModuleInit(): void {
    // В тестах разгребатель молчит: фоновая работа, идущая сама по себе,
    // превращает падение одного теста в падение соседнего.
    if (getEnv().nodeEnv === 'test') {
      return
    }

    this.timer = setInterval(() => {
      void this.sweep()
    }, SWEEP_INTERVAL_MS)

    // Таймер не держит процесс: без этого API не завершится по Ctrl+C.
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
    }
  }

  private async sweep(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true

    try {
      const result = await this.outbox.tick()

      if (result.failed > 0) {
        this.logger.warn(`Исходящих не доставлено: ${result.failed}`)
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: следующий проход через две
      // секунды, и он может оказаться удачнее.
      this.logger.warn(
        `Проход исходящей очереди не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
