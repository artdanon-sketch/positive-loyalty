import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateCatalogItemInput, UpdateCatalogItemInput } from '@positive/contracts'
import type { CatalogItem } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { CatalogService } from './catalog.service'

/**
 * Каталог товаров и услуг. docs/02, раздел 5.17.
 *
 * Только владелец: цена в баллах — это то, за сколько заведение отдаёт товар,
 * то есть решение о деньгах.
 */
@ApiTags('admin')
@Controller('admin/catalog')
@Roles('OWNER')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Каталог заведения — в порядке витрины' })
  @ApiOkResponse({ description: 'Включённые и выключенные позиции' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async list(): Promise<CatalogItem[]> {
    return this.catalog.list()
  }

  @Post()
  @ApiOperation({ summary: 'Добавить позицию' })
  @ApiCreatedResponse({ description: 'Позиция добавлена' })
  @ApiBadRequestResponse({ description: 'Пустое имя, ссылка не https или цена отрицательная' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async create(@Body() body: unknown): Promise<CatalogItem> {
    const parsed = CreateCatalogItemInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.catalog.create(parsed.data)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить позицию',
    description: 'Удаления нет: снятая с витрины позиция выключается и остаётся у владельца.',
  })
  @ApiOkResponse({ description: 'Позиция изменена' })
  @ApiBadRequestResponse({ description: 'Нечего менять или значения вне допустимых' })
  @ApiNotFoundResponse({ description: 'Позиция не найдена' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async update(@Param('id') id: string, @Body() body: unknown): Promise<CatalogItem> {
    const parsed = UpdateCatalogItemInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.catalog.update(id, parsed.data)
  }
}

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
