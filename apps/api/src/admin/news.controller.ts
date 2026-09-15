import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateNewsInput, UpdateNewsInput } from '@positive/contracts'
import type { AdminNews } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { NewsService } from './news.service'

/**
 * Новости заведения. docs/02, раздел 5.14 · docs/11, У13.
 *
 * Смотрят менеджер и владелец. Пишет и снимает с публикации владелец — как акции
 * в матрице прав docs/05: текст уходит всем гостям заведения от его имени.
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
@Controller('admin/news')
@Roles('MANAGER', 'OWNER')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  @ApiOperation({ summary: 'Новости заведения — свежие сверху, черновики тоже' })
  @ApiOkResponse({ description: 'Не больше ста последних' })
  @ApiForbiddenResponse({ description: 'Кассиру не показываются' })
  async list(): Promise<AdminNews[]> {
    return this.news.list()
  }

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  @ApiOperation({ summary: 'Написать новость — черновиком или сразу для гостей' })
  @ApiCreatedResponse({ description: 'Новость создана' })
  @ApiBadRequestResponse({ description: 'Заголовок или текст пустые либо длинные' })
  @ApiForbiddenResponse({ description: 'Пишет только владелец' })
  async create(@Body() body: unknown): Promise<AdminNews> {
    const parsed = CreateNewsInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.news.create(parsed.data)
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Поправить новость, опубликовать или снять с публикации' })
  @ApiOkResponse({ description: 'Новость изменена' })
  @ApiBadRequestResponse({ description: 'Нечего менять или значение не проходит' })
  @ApiForbiddenResponse({ description: 'Меняет только владелец' })
  @ApiNotFoundResponse({ description: 'Новости нет в этом заведении' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<AdminNews> {
    const parsed = UpdateNewsInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.news.update(id, parsed.data)
  }
}
