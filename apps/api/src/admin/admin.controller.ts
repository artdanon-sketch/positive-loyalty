import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Sse,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import {
  AdminGuestCardQuery,
  AdminGuestsQuery,
  AdminListQuery,
  DashboardQuery,
} from '@positive/contracts'
import type {
  AdminDashboard,
  LiveFeedEvent,
  AdminGuestCard,
  AdminGuestsList,
  AdminLedgerEntry,
  AdminLedgerList,
  AdminMembership,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { LedgerEventsService } from '../core/ledger-events.service'
import { TenantContext } from '../common/tenant/tenant-context'

import { AdminService } from './admin.service'
import { DashboardService } from './dashboard.service'

/**
 * API бэк-офиса заведения.
 *
 * Токена нет — `401` от глобального TenantGuard. Объект чужого заведения — `404`,
 * а не `403`: по коду ответа не должно быть видно, существует объект или нет
 * (docs/02, раздел 0).
 *
 * Контроллер только маршрутизирует: бизнес-логика в сервисе (CLAUDE.md).
 */
/** Интервал сердцебиения потока. Меньше типичного таймаута прокси в 30–60 секунд. */
const HEARTBEAT_MS = 20_000

@ApiTags('admin')
@Controller('admin')
// Матрица прав из docs/05, раздел 3: «Аналитика точки» — менеджер и владелец.
// Кассиру бэк-офис не положен: он работает на кассе, а не смотрит выручку.
@Roles('MANAGER', 'OWNER')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly dashboardService: DashboardService,
    private readonly ledgerEvents: LedgerEventsService,
  ) {}

  /**
   * Живая лента начислений. docs/03, раздел 2.
   *
   * SSE, а не WebSocket: поток односторонний, переживает разрывы штатным
   * переподключением и не требует своей инфраструктуры.
   *
   * `tenantId` СНИМАЕТСЯ ЗДЕСЬ, В МОМЕНТ ПОДПИСКИ, и замыкается на всё время
   * жизни потока. Читать его из контекста внутри обработчика событий нельзя:
   * AsyncLocalStorage живёт до конца ЗАПРОСА, а поток переживает запрос —
   * к моменту первого события контекст будет уже чужой или пустой.
   *
   * Каждые двадцать секунд уходит комментарий-сердцебиение. Без него молчащий
   * поток закрывают прокси и мобильные операторы, причём молча: страница
   * продолжает считать, что подписана, и лента тихо замирает.
   */
  @Sse('stream')
  @ApiOperation({ summary: 'Живая лента начислений' })
  stream(): Observable<{ data: LiveFeedEvent } | { type: string; data: string }> {
    const { tenantId } = TenantContext.getOrThrow()

    return new Observable((subscriber) => {
      const unsubscribe = this.ledgerEvents.subscribe(tenantId, (event) => {
        subscriber.next({ data: event })
      })

      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'ping', data: '' })
      }, HEARTBEAT_MS)

      return () => {
        clearInterval(heartbeat)
        unsubscribe()
      }
    })
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Дашборд заведения' })
  @ApiOkResponse({ description: 'Плитки, графики и советы за выбранный период' })
  @ApiBadRequestResponse({ description: 'Неизвестный период' })
  async dashboard(@Query() query: Record<string, unknown>): Promise<AdminDashboard> {
    const parsed = DashboardQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные параметры запроса',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.dashboardService.dashboard(parsed.data.period)
  }

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

  @Get('guests')
  @ApiOperation({ summary: 'Гости заведения' })
  @ApiOkResponse({ description: 'Участия своего заведения, недавние визиты первыми' })
  @ApiBadRequestResponse({ description: 'Некорректные параметры или слишком длинный поиск' })
  async listGuests(@Query() query: Record<string, unknown>): Promise<AdminGuestsList> {
    const parsed = AdminGuestsQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные параметры запроса',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.adminService.listGuests(parsed.data.limit, parsed.data.offset, parsed.data.q)
  }

  @Get('guests/:guestId')
  @ApiOperation({ summary: 'Карточка гостя: цифры и история одной лентой' })
  @ApiOkResponse({ description: 'Гость своего заведения' })
  @ApiBadRequestResponse({ description: 'Неизвестный язык' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  async guestCard(
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<AdminGuestCard> {
    const parsed = AdminGuestCardQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные параметры запроса',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.adminService.guestCard(guestId, parsed.data.locale)
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
