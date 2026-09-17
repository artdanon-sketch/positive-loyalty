import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { StaffRewardsService } from './staff-rewards.service'

/**
 * Расписание разбора наград кассирам.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ — как партнёрские триггеры и рассылки
 * (docs/01, раздел 6 · docs/09, Э3). Состояние в базе, переезд тронет
 * только этот файл.
 *
 * ИНТЕРВАЛ — ТРИДЦАТЬ СЕКУНД. Награда не горит: кассир смотрит свой заработок
 * в конце смены, а не после каждого чека. Частые проходы стоили бы базе
 * запросов круглые сутки без пользы.
 */

const SWEEP_INTERVAL_MS = 30_000

@Injectable()
export class StaffRewardsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaffRewardsSweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly rewards: StaffRewardsService) {}

  onModuleInit(): void {
    // В тестах молчит: фоновая работа сама по себе превращает падение одного
    // теста в падение соседнего.
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
      const result = await this.rewards.tick()

      if (result.decided > 0 || result.vested > 0 || result.cancelled > 0) {
        this.logger.log(
          `Награды кассирам: разобрано ${String(result.decided)}, дозрело ${String(result.vested)}, снято ${String(result.cancelled)}`,
        )
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: без него мотивация встаёт молча.
      this.logger.warn(
        `Проход наград не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
