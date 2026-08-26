import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { CommitInput, PosGuestQuery, PreviewInput } from '@positive/contracts'
import type { CommitResult, PosGuest, PreviewResult } from '@positive/contracts'

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
      // Токен с экрана гостя выпускается гостевой аутентификацией, а она ждёт
      // выбора SMS-провайдера. Возвращаем честный отказ, а не пустого гостя.
      throw new BadRequestException({
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Поиск по токену появится вместе с гостевой аутентификацией',
        },
      })
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
}
