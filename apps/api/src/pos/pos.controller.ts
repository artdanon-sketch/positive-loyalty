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
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import {
  CommitInput,
  PosGuestQuery,
  PosTagInput,
  RedeemRewardInput,
  PosVoidInput,
  PreviewInput,
  RedeemGrantInput,
  PosHistory,
  PosHistoryQuery,
  PosInvite,
  PosMe,
  PosRewardsQuery,
} from '@positive/contracts'
import type {
  CommitResult,
  PosConfig,
  PosGuest,
  PosVoidResult,
  PreviewResult,
  PosRewards,
  RedeemGrantResult,
  RedeemRewardResult,
  SaleKind,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { PosAppService } from './pos-app.service'
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
  constructor(
    private readonly posService: PosService,
    private readonly posApp: PosAppService,
  ) {}

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

  @Post('guest/:membershipId/tags')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Повесить гостю тег',
    description:
      'Только из справочника заведения и только если владелец разрешил теги на кассе. ' +
      'Повтор ничего не меняет.',
  })
  @ApiOkResponse({ description: 'Теги гостя после добавления' })
  @ApiForbiddenResponse({ description: 'Теги на кассе выключены в настройках' })
  @ApiNotFoundResponse({ description: 'Нет такого гостя или тега' })
  async addTag(
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<PosGuest['tags']> {
    const parsed = PosTagInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.addTag(membershipId, parsed.data.tagId)
  }

  @Get('rewards')
  @ApiOperation({
    summary: 'Награды за баллы для гостя на кассе',
    description:
      'Позиции витрины с ценой в баллах и признак «хватает» по балансу гостя в этом заведении.',
  })
  @ApiOkResponse({ description: 'Баланс гостя и награды в порядке владельца' })
  @ApiBadRequestResponse({ description: 'Не указан или неверен membershipId' })
  @ApiNotFoundResponse({ description: 'Гость не участвует в программе этого заведения' })
  @ApiForbiddenResponse({ description: 'Нет роли кассы' })
  async rewards(@Query() query: Record<string, unknown>): Promise<PosRewards> {
    const parsed = PosRewardsQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Укажите участие гостя',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.rewards(parsed.data.membershipId)
  }

  @Post('rewards/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Выдать награду из каталога за баллы',
    description:
      'Списывает цену позиции в баллах. Повтор с тем же redemptionId ничего не списывает ' +
      'второй раз.',
  })
  @ApiOkResponse({ description: 'Награда выдана, баллы списаны' })
  @ApiNotFoundResponse({ description: 'Позиции нет на витрине' })
  async redeemReward(@Body() body: unknown): Promise<RedeemRewardResult> {
    const parsed = RedeemRewardInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.redeemReward(parsed.data)
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

  @Post('grants/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Погасить промокод',
    description:
      'Гасит код гостя. Повтор с тем же receiptId возвращает первый ответ, ' +
      'а не отказ «код уже погашен»: иначе касса, потерявшая связь, не отдала бы подарок.',
  })
  @ApiOkResponse({ description: 'Код погашен — что отдать гостю' })
  async redeemGrant(@Body() body: unknown): Promise<RedeemGrantResult> {
    const parsed = RedeemGrantInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posService.redeemGrant(parsed.data)
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

  @Get('invite')
  @ApiOperation({
    summary: 'Что показать гостю, чтобы записать его у стойки',
    description:
      'QR и код первого включённого источника заведения. Название источника едет рядом: ' +
      'кассир должен видеть, куда запишется гость. Источников нет — поля пустые.',
  })
  @ApiOkResponse({ description: 'Код, ссылка и название источника' })
  @ApiForbiddenResponse({ description: 'Приглашение с кассы выключено владельцем' })
  async invite(): Promise<PosInvite> {
    return this.posApp.invite()
  }

  @Get('history')
  @ApiOperation({
    summary: 'Свои чеки за период',
    description:
      'Только свои: чужая смена кассиру не показывается. Период — сегодня, неделя, месяц ' +
      'или произвольный диапазон, по часам заведения. Итог суммой приезжает вместе со списком.',
  })
  @ApiOkResponse({ description: 'Список операций и итог' })
  @ApiForbiddenResponse({ description: 'История смены выключена владельцем' })
  async history(@Query() query: Record<string, unknown>): Promise<PosHistory> {
    const parsed = PosHistoryQuery.safeParse(query)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Неверный период',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.posApp.history(parsed.data)
  }

  @Get('me')
  @ApiOperation({
    summary: 'Кто я и где работаю',
    description:
      'Имя, роль и заведение. Показатели смены и средняя оценка — только если владелец ' +
      'открыл их в настройках; иначе stats приходит пустым.',
  })
  @ApiOkResponse({ description: 'Профиль сотрудника на кассе' })
  async me(): Promise<PosMe> {
    return this.posApp.me()
  }
}
