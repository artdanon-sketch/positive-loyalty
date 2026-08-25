import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common'
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminListQuery } from '@positive/contracts'
import type { AdminLedgerEntry, AdminLedgerList, AdminMembership } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { AdminService } from './admin.service'

/**
 * API бэк-офиса заведения.
 *
 * Токена нет — `401` от глобального TenantGuard. Объект чужого заведения — `404`,
 * а не `403`: по коду ответа не должно быть видно, существует объект или нет
 * (docs/02, раздел 0).
 *
 * Контроллер только маршрутизирует: бизнес-логика в сервисе (CLAUDE.md).
 */
@ApiTags('admin')
@Controller('admin')
// Матрица прав из docs/05, раздел 3: «Аналитика точки» — менеджер и владелец.
// Кассиру бэк-офис не положен: он работает на кассе, а не смотрит выручку.
@Roles('MANAGER', 'OWNER')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('ledger')
  @ApiOperation({ summary: 'Операции заведения' })
  @ApiOkResponse({ description: 'Страница журнала своего заведения' })
  async listLedger(@Query() query: Record<string, unknown>): Promise<AdminLedgerList> {
    // Разбор через контракт, а не через @Query('limit'): так границы (1..100)
    // живут в одном месте с типом и не разъедутся с фронтом.
    //
    // safeParse, а не parse: непойманный ZodError уходит в обработчик как
    // неизвестная ошибка и превращается в 500. Кривой query — это 400,
    // и путать одно с другим нельзя: 500 поднимает алерты и прячет настоящие сбои.
    const parsed = AdminListQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные параметры запроса',
          // Только пути полей: значения могут содержать чужие идентификаторы.
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.adminService.listLedger(parsed.data.limit, parsed.data.offset)
  }

  @Get('ledger/:id')
  @ApiOperation({ summary: 'Одна операция по идентификатору' })
  @ApiOkResponse({ description: 'Операция своего заведения' })
  @ApiNotFoundResponse({ description: 'Операции нет либо она принадлежит другому заведению' })
  async getLedgerEntry(@Param('id', ParseUUIDPipe) id: string): Promise<AdminLedgerEntry> {
    return this.adminService.getLedgerEntry(id)
  }

  @Get('memberships/:id')
  @ApiOperation({ summary: 'Участие гостя в программе' })
  @ApiOkResponse({ description: 'Участие в своём заведении' })
  @ApiNotFoundResponse({ description: 'Участия нет либо оно принадлежит другому заведению' })
  async getMembership(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMembership> {
    return this.adminService.getMembership(id)
  }
}
