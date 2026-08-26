import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { HealthResponse } from '@positive/contracts'

import { HealthService } from './health.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Проверка живости сервиса',
    description:
      'Живёт вне префикса /v1: на этот путь смотрит healthcheck Railway, ' +
      'и он не должен ломаться при выпуске новой версии API.',
  })
  @ApiOkResponse({
    description: 'Сервис поднят и отвечает',
    schema: {
      type: 'object',
      required: ['status', 'service', 'version', 'uptimeSeconds', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['ok'], example: 'ok' },
        service: { type: 'string', example: 'api' },
        version: { type: 'string', example: '0.0.0' },
        uptimeSeconds: { type: 'integer', minimum: 0, example: 42 },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  check(): HealthResponse {
    return this.healthService.check()
  }
}
