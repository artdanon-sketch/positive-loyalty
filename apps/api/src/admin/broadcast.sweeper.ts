import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { getEnv } from '../common/config/env'

import { BroadcastSendService } from './broadcast-send.service'

/**
 * Расписание отправки рассылок.
 *
 * ЖИВЁТ В API, А НЕ В ВОРКЕРЕ, и это временно — как у разгребателей исходящих
 * и партнёрских триггеров (docs/01, раздел 6 · docs/09, Э3). Состояние лежит
 * в базе, переезд не тронет ничего, кроме этого файла.
 *
 * ИНТЕРВАЛ — ПЯТНАДЦАТЬ СЕКУНД. Рассылка не горит: владелец отправляет её раз
 * в неделю, а гость не заметит разницы между «сразу» и «через четверть минуты».
 * Частые проходы стоили бы базе запросов круглые сутки без всякой пользы.
 */

const SWEEP_INTERVAL_MS = 15_000

@Injectable()
export class BroadcastSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcastSweeper.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly sender: BroadcastSendService) {}

  onModuleInit(): void {
    // В тестах молчит: фоновая отправка, идущая сама по себе, превращает падение
    // одного теста в падение соседнего.
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
    // Проход не накладывается сам на себя: медленный Telegram растянул бы его
    // дольше интервала, и два прохода взяли бы одних и тех же получателей.
    if (this.running) {
      return
    }

    this.running = true

    try {
      const result = await this.sender.tick()

      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(`Рассылка: отправлено ${result.sent}, не дошло ${result.failed}`)
      }
    } catch (error) {
      // Разгребатель не имеет права умереть: без него рассылки встают молча.
      this.logger.warn(
        `Проход рассылок не удался: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.running = false
    }
  }
}
