import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AutomationKind, AutomationRule, SaveAutomationInput } from '@positive/contracts'
import type { AutomationRule as AutomationRuleType, AutomationRules } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { AutomationService } from './automation.service'

/**
 * Автоматические сценарии рассылок. docs/02, раздел 5.4.1 · docs/03, раздел 5.
 *
 * ТОЛЬКО ВЛАДЕЛЕЦ — как и у обычных рассылок: включённый сценарий пишет всей
 * базе без чьего-либо участия, и отозвать отправленное нельзя.
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
@Controller('admin/automation')
@Roles('OWNER')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @ApiOperation({ summary: 'Три сценария с текущими настройками — включённые и нет' })
  @ApiOkResponse({ description: 'Всегда три строки: выключенный сценарий тоже виден' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async list(): Promise<AutomationRules> {
    return this.automation.list()
  }

  @Put(':kind')
  @ApiOperation({ summary: 'Включить, выключить или перенастроить сценарий' })
  @ApiOkResponse({ description: 'Сохранённый сценарий' })
  @ApiBadRequestResponse({ description: 'Неизвестный сценарий или порог вне допустимых значений' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async save(
    @Param('kind') kind: string,
    @Body() body: Record<string, unknown>,
  ): Promise<AutomationRuleType> {
    const parsedKind = AutomationKind.safeParse(kind)

    if (!parsedKind.success) {
      throw invalid([{ message: 'Неизвестный сценарий', path: ['kind'] }])
    }

    const parsed = SaveAutomationInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    // Порог зависит от вида сценария (дни или сумма), а вид приходит адресом —
    // поэтому проверяем их вместе, целым правилом, а не телом запроса отдельно.
    // Подарок и «ждут» в проверке порога не участвуют — подставляем нейтральные.
    const whole = AutomationRule.safeParse({
      ...parsed.data,
      kind: parsedKind.data,
      gift: parsed.data.gift ?? null,
      lastRunAt: null,
      waiting: 0,
    })

    if (!whole.success) {
      throw invalid(whole.error.issues)
    }

    return this.automation.save(parsedKind.data, parsed.data)
  }
}
