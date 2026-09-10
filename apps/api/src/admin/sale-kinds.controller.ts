import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateSaleKindInput, UpdateSaleKindInput } from '@positive/contracts'
import type { SaleKind } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { TenantContext } from '../common/tenant/tenant-context'

import { SaleKindsService } from './sale-kinds.service'

/**
 * Справочник видов продаж заведения.
 *
 * Настройка заведения, а не ежедневная работа: заводит и переименовывает
 * владелец или менеджер, выбирает из готового списка кассир. Поэтому здесь
 * та же матрица прав, что и у остального бэк-офиса.
 *
 * Тело разбирается схемой ЯВНО, а не типом параметра: типы стираются при
 * сборке, и `@Body() body: CreateSaleKindInput` не проверял бы ровно ничего —
 * пустое тело доехало бы до сервиса и упало пятисоткой. Этот урок уже
 * оплачен входом в панель платформы.
 */
@ApiTags('admin')
@Controller('admin/sale-kinds')
@Roles('MANAGER', 'OWNER')
export class SaleKindsController {
  constructor(private readonly saleKinds: SaleKindsService) {}

  @Get()
  @ApiOperation({
    summary: 'Виды продаж заведения',
    description: 'Включённые и выключенные: выключенный можно вернуть в работу.',
  })
  @ApiOkResponse({ description: 'Список видов продаж' })
  async list(): Promise<SaleKind[]> {
    const { tenantId } = TenantContext.getOrThrow()

    return this.saleKinds.list(tenantId)
  }

  @Post()
  @ApiOperation({ summary: 'Завести вид продажи' })
  @ApiOkResponse({ description: 'Вид продажи создан' })
  @ApiBadRequestResponse({ description: 'Название занято или их слишком много' })
  async create(@Body() body: unknown): Promise<SaleKind> {
    const { tenantId } = TenantContext.getOrThrow()
    const parsed = CreateSaleKindInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.saleKinds.create(tenantId, parsed.data)
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Изменить вид продажи',
    description:
      'Удаления нет: вид, на который ссылается журнал, исчезнуть не может. ' +
      'Ненужное выключается через isActive.',
  })
  @ApiOkResponse({ description: 'Вид продажи изменён' })
  @ApiNotFoundResponse({ description: 'Вид продажи не найден' })
  @ApiBadRequestResponse({ description: 'Название занято или нечего менять' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<SaleKind> {
    const { tenantId } = TenantContext.getOrThrow()
    const parsed = UpdateSaleKindInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.saleKinds.update(tenantId, id, parsed.data)
  }
}

/** Один и тот же ответ на любую кривизну тела: перечисляем поля, не значения. */
const invalid = (issues: readonly { path: PropertyKey[] }[]): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })
