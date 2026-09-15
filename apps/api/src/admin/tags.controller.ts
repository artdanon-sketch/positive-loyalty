import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateTagInput, UpdateTagInput } from '@positive/contracts'
import type { Tag } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { TagsService } from './tags.service'

/**
 * Справочник тегов. docs/02, раздел 5.2.5.
 *
 * Заводит и переименовывает менеджер или владелец: теги нужны у стойки.
 * Удаляет только владелец — удалённый тег сходит со всех гостей сразу.
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
@Controller('admin/tags')
@Roles('MANAGER', 'OWNER')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @ApiOperation({ summary: 'Теги заведения' })
  @ApiOkResponse({ description: 'По названию' })
  async list(): Promise<Tag[]> {
    return this.tags.list()
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Завести тег' })
  @ApiCreatedResponse({ description: 'Тег создан' })
  @ApiBadRequestResponse({
    description: 'Название пустое или длинное, неизвестный цвет, тегов больше 50',
  })
  @ApiConflictResponse({ description: 'TAG_EXISTS — такое название уже есть' })
  async create(@Body() body: unknown): Promise<Tag> {
    const parsed = CreateTagInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.tags.create(parsed.data)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Переименовать тег или сменить цвет' })
  @ApiOkResponse({ description: 'Тег изменён' })
  @ApiBadRequestResponse({ description: 'Нечего менять или значение не проходит' })
  @ApiNotFoundResponse({ description: 'Тега нет в этом заведении' })
  @ApiConflictResponse({ description: 'TAG_EXISTS — такое название уже есть' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<Tag> {
    const parsed = UpdateTagInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.tags.update(id, parsed.data)
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить тег — он сходит со всех гостей' })
  @ApiNoContentResponse({ description: 'Тег удалён' })
  @ApiForbiddenResponse({ description: 'Удаляет только владелец' })
  @ApiNotFoundResponse({ description: 'Тега нет в этом заведении' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tags.remove(id)
  }
}
