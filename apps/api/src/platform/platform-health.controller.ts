import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

/**
 * Health-check процесса админки платформы.
 *
 * Свой, а не общий с основным API, и не под префиксом версии: на него смотрит
 * healthcheck Railway у ОТДЕЛЬНОГО сервиса, и он должен отвечать, даже когда
 * база недоступна. Иначе Railway решит, что сервис не поднялся, и укатит
 * деплой назад из-за недоступной базы — то есть из-за чужой беды.
 *
 * Намеренно НЕ трогает базу и НЕ сообщает ничего о состоянии платформы:
 * это открытый маршрут, а всё, что он мог бы рассказать, — подсказка тому,
 * кто изучает контур.
 */
@ApiTags('platform')
@Controller()
export class PlatformHealthController {
  @Get('health')
  @ApiOperation({ summary: 'Жив ли процесс админки платформы' })
  check(): { status: 'ok'; service: 'platform' } {
    return { status: 'ok', service: 'platform' }
  }
}
