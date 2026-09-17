import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { PointsExpiryService } from './points-expiry.service'

/**
 * Расписание сгорания баллов.
 *
 * ИНТЕРВАЛ — ЧАС. Сгорание считается по суткам: опоздать на час не страшно,
 * а бегать по базе каждую минуту ради того, что меняется раз в день, —
 * трата запросов впустую.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, как остальные разгребатели (docs/01, раздел 6).
 */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000

@Injectable()
export class PointsExpirySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PointsExpirySweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly expiry: PointsExpiryService) {}

  onModuleInit(): void {
    // В тестах молчит: списание баллов посреди чужого теста ломает соседа.
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
      const result = await this.expiry.tick()

      if (result.burned > 0) {
        this.logger.log(
          `Сгорело баллов: ${String(result.points)} у ${String(result.burned)} гостей`,
        )
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: без него баллы не сгорают молча.
      this.logger.warn(
        `Проход сгорания не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
