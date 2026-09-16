import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import {
  AdminBroadcastsQuery,
  BroadcastPreviewInput,
  CreateBroadcastInput,
} from '@positive/contracts'
import type { AdminBroadcast, AdminBroadcastsList, BroadcastPreview } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { BroadcastsService } from './broadcasts.service'

/**
 * Рассылки. docs/02, раздел 5.4 · docs/03, раздел 5.
 *
 * ТОЛЬКО ВЛАДЕЛЕЦ. Сообщение уходит всей базе от имени заведения — это не рабочее
 * действие смены, а решение хозяина: испорченную рассылку нельзя отозвать.
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
@Controller('admin/broadcasts')
@Roles('OWNER')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  @ApiOperation({ summary: 'Отправленные и запланированные рассылки — свежие сверху' })
  @ApiOkResponse({ description: 'С итогами доставки по каждой' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async list(@Query() query: Record<string, unknown>): Promise<AdminBroadcastsList> {
    const parsed = AdminBroadcastsQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.broadcasts.list(parsed.data)
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Сколько гостей под фильтрами и сколько из них получит сообщение',
    description: 'Считает заранее: часть гостей без Telegram, часть уже устала от рассылок.',
  })
  @ApiOkResponse({ description: 'found, willReceive, tired, unreachable' })
  @ApiBadRequestResponse({ description: 'Неизвестный фильтр аудитории' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async preview(@Body() body: unknown): Promise<BroadcastPreview> {
    const parsed = BroadcastPreviewInput.safeParse(body ?? {})

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.broadcasts.preview(parsed.data)
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Создать рассылку: сразу или на время',
    description: 'Аудитория фиксируется списком получателей; отправляет фоновый разгребатель.',
  })
  @ApiCreatedResponse({ description: 'Рассылка с итогами, пока нулевыми' })
  @ApiBadRequestResponse({ description: 'Пустой текст, длинный текст или неизвестный фильтр' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async create(@Body() body: unknown): Promise<AdminBroadcast> {
    const parsed = CreateBroadcastInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.broadcasts.create(parsed.data)
  }
}
