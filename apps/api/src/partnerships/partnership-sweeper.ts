import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { PartnershipSweepService } from './partnership-sweep.service'

/**
 * Расписание разбора партнёрских триггеров.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, И ЭТО ВРЕМЕННО — ровно по тем же причинам, что
 * и разгребатель исходящих (WebhookOutboxSweeper): по docs/01, раздел 6 фон —
 * дело `apps/worker`, но воркер пуст, а очередь без разгребателя бесполезна.
 * Переезд не тронет ничего, кроме этого файла: состояние лежит в базе.
 *
 * ИНТЕРВАЛ БОЛЬШЕ, ЧЕМ У ИСХОДЯЩИХ. Там две секунды, потому что касса
 * показывает баланс человеку у стойки. Здесь подарок от соседнего заведения:
 * десять секунд разницы не заметит никто, а лишние проходы по журналу
 * стоят базе денег каждую секунду круглые сутки.
 */

/** Как часто разбираем. Десять секунд: подарок не горит, а база не бесплатна. */
const SWEEP_INTERVAL_MS = 10_000

@Injectable()
export class PartnershipSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PartnershipSweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly sweep: PartnershipSweepService) {}

  onModuleInit(): void {
    // В тестах разгребатель молчит: фоновая работа, идущая сама по себе,
    // превращает падение одного теста в падение соседнего.
    if (getEnv().nodeEnv === 'test') {
      return
    }

    this.timer = setInterval(() => {
      void this.run()
    }, SWEEP_INTERVAL_MS)

    // Таймер не держит процесс: без этого API не завершится по Ctrl+C.
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
    }
  }

  private async run(): Promise<void> {
    // Проход не накладывается сам на себя: медленная база растянула бы его
    // дольше интервала, и два прохода взяли бы одни и те же операции.
    // Данные это выдержит — UNIQUE и ключ идемпотентности на месте, — но
    // работа была бы сделана дважды впустую.
    if (this.running) {
      return
    }

    this.running = true

    try {
      const result = await this.sweep.tick()

      if (result.issued > 0) {
        this.logger.log(`Партнёрских наград выдано: ${result.issued}`)
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: следующий проход может оказаться
      // удачнее, а без него партнёрства перестают работать целиком и молча.
      this.logger.warn(
        `Проход партнёрских триггеров не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
