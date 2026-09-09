import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CommitInput, PosGuestQuery, PosVoidInput, PreviewInput } from '@positive/contracts'
import type {
  CommitResult,
  PosConfig,
  PosGuest,
  PosVoidResult,
  PreviewResult,
  SaleKind,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { PosService } from './pos.service'

/**
 * API кассы. docs/02, раздел 3.
 *
 * Доступно кассиру, менеджеру и владельцу: за кассу встают все трое.
 * Бэк-офис при этом кассиру закрыт — права разные, и это не симметрично.
 */
@ApiTags('pos')
@Controller('pos')
@Roles('CASHIER', 'MANAGER', 'OWNER')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('config')
  @ApiOperation({ summary: 'Правила кассы заведения' })
  @ApiOkResponse({ description: 'Что касса обязана знать до ввода суммы' })
  async config(): Promise<PosConfig> {
    return this.posService.config()
  }

  @Get('sale-kinds')
  @ApiOperation({
    summary: 'Виды продаж заведения',
    description:
      'Только включённые: выключенный вид остаётся в истории, но выбирать его нельзя. ' +
      'Пустой список — норма: справочник ведут не все заведения.',
  })
  @ApiOkResponse({ description: 'Что можно выбрать при проведении чека' })
  async saleKinds(): Promise<SaleKind[]> {
    return this.posService.saleKinds()
  }

  @Get('guest')
  @ApiOperation({
    summary: 'Найти гостя на кассе',
    description:
      'Находит гостя, у которого уже есть участие в этом заведении. Гость, впервые ' +
      'пришедший сюда, оформляется через собственную регистрацию в гостевом приложении.',
  })
  async findGuest(@Query() query: Record<string, unknown>): Promise<PosGuest> {
    const parsed = PosGuestQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Укажите либо token, либо phone',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    if (parsed.data.token !== undefined) {
      return this.posService.findGuestByQrToken(parsed.data.token)
    }

    return this.posService.findGuestByPhone(parsed.data.phone as string)
  }

  @Post('transactions/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Предрасчёт чека',
    description: 'Ничего не меняет. Считает списание и начисление по настройкам программы.',
  })
  async preview(@Body() body: unknown): Promise<PreviewResult> {
    const parsed = PreviewInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.preview(parsed.data)
  }

  @Post('transactions/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Провести чек',
    description:
      'Идемпотентно по receiptId: повтор того же чека возвращает первый результат, ' +
      'а не создаёт вторую операцию.',
  })
  async commit(@Body() body: unknown): Promise<CommitResult> {
    const parsed = CommitInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.commit(parsed.data)
  }

  @Post('transactions/:transactionId/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отменить проведённый чек',
    description:
      'Компенсирует записи чека. Кассиру доступно 15 минут; менеджеру и владельцу — ' +
      'без окна, но только с комментарием. Повтор отмены возвращает прежний результат.',
  })
  async voidTransaction(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body() body: unknown,
  ): Promise<PosVoidResult> {
    const parsed = PosVoidInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.voidTransaction(transactionId, parsed.data.reason, parsed.data.comment)
  }
}
