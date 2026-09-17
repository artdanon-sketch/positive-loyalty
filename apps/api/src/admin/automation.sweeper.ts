import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { AutomationRunService } from './automation-run.service'

/**
 * Расписание автоматических сценариев.
 *
 * ИНТЕРВАЛ — ПЯТЬ МИНУТ, и этого с запасом хватает: сам сценарий срабатывает
 * не чаще раза в сутки, а его условие («не заходил тридцать дней») не меняется
 * от того, заметили мы его в 9:00 или в 9:05.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ — как разгребатель рассылок рядом (docs/01,
 * раздел 6). Состояние в базе, переезд не тронет ничего, кроме этого файла.
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000

@Injectable()
export class AutomationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationSweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly runner: AutomationRunService) {}

  onModuleInit(): void {
    // В тестах молчит: рассылка, созданная сама по себе посреди чужого теста,
    // ломает соседа.
    if (getEnv().nodeEnv === 'test') {
      return
    }

    this.timer = setInterval(() => {
      void this.run()
    }, SWEEP_INTERVAL_MS)

    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true

    try {
      const result = await this.runner.tick()

      if (result.started > 0) {
        this.logger.log(`Автосценарии: создано рассылок ${String(result.started)}`)
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: без него сценарии встают молча.
      this.logger.warn(
        `Проход автосценариев не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
