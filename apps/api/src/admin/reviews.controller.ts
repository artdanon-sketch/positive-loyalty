import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AdminReviewsQuery, ReplyReviewInput } from '@positive/contracts'
import type { AdminReview, AdminReviewsList } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { ReviewsService } from './reviews.service'

/**
 * Отзывы гостей. docs/02, раздел 5.12 · docs/11, У10.
 *
 * Читает и отвечает менеджер и владелец: на жалобу у стойки отвечает тот, кто в смене.
 * Кассиру отзывы не показываются — в них оценивают и его самого.
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
@Controller('admin/reviews')
@Roles('MANAGER', 'OWNER')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Отзывы за период: сводка, распределение оценок, темы и список' })
  @ApiOkResponse({ description: 'Свежие сверху; сводка — за период без фильтров' })
  @ApiBadRequestResponse({ description: 'Период не 7d, 30d или 90d, оценка не от 1 до 5' })
  @ApiForbiddenResponse({ description: 'Кассиру отзывы не показываются' })
  async list(@Query() query: Record<string, unknown>): Promise<AdminReviewsList> {
    const parsed = AdminReviewsQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.reviews.list(parsed.data)
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ответить гостю — ответ заменяет автоответ и виден в приложении' })
  @ApiOkResponse({ description: 'Отзыв с ответом' })
  @ApiBadRequestResponse({ description: 'Ответ пустой или длиннее 1000 знаков' })
  @ApiForbiddenResponse({ description: 'Кассиру отзывы не показываются' })
  @ApiNotFoundResponse({ description: 'Отзыва нет в этом заведении' })
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<AdminReview> {
    const parsed = ReplyReviewInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.reviews.reply(id, parsed.data)
  }
}
