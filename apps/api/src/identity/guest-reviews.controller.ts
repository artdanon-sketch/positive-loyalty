import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateReviewInput } from '@positive/contracts'
import type { GuestReview, GuestReviews } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestReviewsService } from './guest-reviews.service'
import { GuestGuard } from './guest.guard'

/**
 * «Оцените визит». docs/02, раздел 2.8 · docs/11, У10.
 *
 * Заведение — из чека, а не из адреса: гость оценивает визит, а визит уже знает,
 * где он был.
 */
@ApiTags('guest')
@Controller('guest/reviews')
@Public()
@UseGuards(GuestGuard)
export class GuestReviewsController {
  constructor(private readonly reviews: GuestReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Визиты, которые можно оценить, и свои отзывы с ответами' })
  @ApiOkResponse({ description: 'Неоценённые визиты за неделю — по одному на заведение' })
  async list(): Promise<GuestReviews> {
    return this.reviews.list()
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Оценить визит: звёзды, быстрые отзывы, комментарий' })
  @ApiCreatedResponse({ description: 'Отзыв; автоответ заведения — сразу в поле reply' })
  @ApiBadRequestResponse({ description: 'Оценка не от 1 до 5, тема повторяется или неизвестна' })
  @ApiNotFoundResponse({ description: 'VISIT_NOT_FOUND — чек не свой, не чек или отменён' })
  @ApiConflictResponse({
    description: 'REVIEW_EXISTS — визит уже оценён; REVIEW_WINDOW_CLOSED — прошло больше недели',
  })
  async create(@Body() body: unknown): Promise<GuestReview> {
    const parsed = CreateReviewInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный отзыв',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.reviews.create(parsed.data)
  }
}
