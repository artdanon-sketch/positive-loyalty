import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { SecurityHistoryQuery, SuspiciousQuery } from '@positive/contracts'
import type { SecurityHistory, SuspiciousReport } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { SecurityService } from './security.service'

/**
 * Безопасность заведения. docs/02, раздел 5.13 · docs/11, У12.
 *
 * Только владелец: в истории — кто из сотрудников что менял, в подозрительном — телефоны
 * гостей целиком и имена кассиров. Это разбор, а не рабочий экран смены.
 */

const invalid = (
  issues: ReadonlyArray<{ readonly message: string; readonly path: readonly PropertyKey[] }>,
): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })

@ApiTags('admin')
@Controller('admin/security')
@Roles('OWNER')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('history')
  @ApiOperation({ summary: 'История действий своего заведения — свежие сверху' })
  @ApiOkResponse({ description: 'Кто, что и когда; nextBefore — для следующей страницы' })
  @ApiBadRequestResponse({ description: 'before не момент ISO или страница больше ста' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async history(@Query() query: Record<string, unknown>): Promise<SecurityHistory> {
    const parsed = SecurityHistoryQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.security.history(parsed.data)
  }

  @Get('suspicious')
  @ApiOperation({ summary: 'Подозрительные операции: гости с частыми чеками, всплески у кассиров' })
  @ApiOkResponse({ description: 'Повод посмотреть — ничего не блокируется' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async suspicious(@Query() query: Record<string, unknown>): Promise<SuspiciousReport> {
    const parsed = SuspiciousQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.security.suspicious(parsed.data)
  }
}
