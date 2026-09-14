import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import {
  CreateInviteInput,
  PartnershipListQuery,
  PartnershipReasonInput,
  SendPartnershipMessageInput,
} from '@positive/contracts'
import type {
  CreateInviteResult,
  InviteQuotaView,
  PartnerCatalog,
  PartnershipDetail,
  PartnershipList,
  PartnershipMessageView,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { PartnershipsService } from './partnerships.service'

/**
 * API партнёрств заведения: договориться. docs/07, раздел 9 · docs/02, раздел 5.8.
 *
 * СМОТРЕТЬ — ВЛАДЕЛЕЦ И МЕНЕДЖЕР, ДОГОВАРИВАТЬСЯ — ТОЛЬКО ВЛАДЕЛЕЦ. Принятое
 * условие рождает акцию заведения, а «создавать и менять акции» в матрице прав
 * docs/05 — его галочка. Менеджер, пригласивший соседа от имени заведения,
 * обязал бы владельца раздавать подарки, о которых тот не знал.
 *
 * Чужое партнёрство даёт 404, а не 403: по ответу нельзя узнать, что два
 * других заведения о чём-то договариваются.
 */

type Issues = ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>

const invalid = (issues: Issues): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })

@ApiTags('partnerships')
@Controller('admin')
@Roles('MANAGER', 'OWNER')
export class PartnershipsController {
  constructor(private readonly partnerships: PartnershipsService) {}

  @Get('partners/catalog')
  @ApiOperation({ summary: 'Каталог сети: с кем можно договориться' })
  @ApiOkResponse({ description: 'Витрины заведений сети, дополняющие первыми' })
  async catalog(): Promise<PartnerCatalog> {
    return this.partnerships.catalog()
  }

  // Объявлен раньше `partnerships/:id`: иначе «quota» ушла бы туда как id.
  @Get('partnerships/quota')
  @ApiOperation({ summary: 'Бесплатные приглашения на сегодня' })
  @ApiOkResponse({ description: 'Лимит, израсходовано и осталось — по дню заведения' })
  async quota(): Promise<InviteQuotaView> {
    return this.partnerships.quota()
  }

  @Get('partnerships')
  @ApiOperation({ summary: 'Партнёрства заведения' })
  @ApiOkResponse({ description: 'Сначала ждущие нашего ответа, в конце — завершённые' })
  @ApiBadRequestResponse({ description: 'Неизвестный статус' })
  async list(@Query() query: Record<string, unknown>): Promise<PartnershipList> {
    const parsed = PartnershipListQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.list(parsed.data.status)
  }

  @Post('partnerships/invites')
  @HttpCode(201)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Пригласить заведение к партнёрству' })
  @ApiCreatedResponse({ description: 'Приглашение отправлено, бесплатное приглашение списано' })
  @ApiBadRequestResponse({ description: 'Текст короче 40 знаков или приглашение самим себе' })
  @ApiForbiddenResponse({ description: 'Получатель не принимает приглашения от вас' })
  @ApiNotFoundResponse({ description: 'Такого открытого заведения в сети нет' })
  @ApiConflictResponse({
    description: 'Разговор уже идёт, недавний отказ или действующих партнёрств максимум',
  })
  @ApiResponse({ status: 402, description: 'Бесплатные приглашения на сегодня закончились' })
  async invite(@Body() body: unknown): Promise<CreateInviteResult> {
    const parsed = CreateInviteInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.invite(parsed.data)
  }

  @Get('partnerships/:id')
  @ApiOperation({ summary: 'Партнёрство: вторая сторона, переписка, доступные действия' })
  @ApiOkResponse({ description: 'Партнёрство, в котором заведение — одна из сторон' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства либо заведение в нём не участвует' })
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<PartnershipDetail> {
    return this.partnerships.detail(id)
  }

  @Post('partnerships/:id/accept')
  @HttpCode(200)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Принять приглашение к обсуждению' })
  @ApiOkResponse({ description: 'Партнёрство перешло к обсуждению' })
  @ApiForbiddenResponse({ description: 'Ответить может только приглашённый' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Приглашение уже не ждёт ответа' })
  async accept(@Param('id', ParseUUIDPipe) id: string): Promise<PartnershipDetail> {
    return this.partnerships.accept(id)
  }

  @Post('partnerships/:id/decline')
  @HttpCode(200)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Отклонить приглашение' })
  @ApiOkResponse({ description: 'Отклонено; пригласить снова можно через 30 дней' })
  @ApiForbiddenResponse({ description: 'Ответить может только приглашённый' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Приглашение уже не ждёт ответа' })
  async decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PartnershipDetail> {
    const parsed = PartnershipReasonInput.safeParse(body ?? {})

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.decline(id, parsed.data.reason)
  }

  @Post('partnerships/:id/end')
  @HttpCode(200)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Расторгнуть партнёрство' })
  @ApiOkResponse({ description: 'Новые подарки прекращены, выданные действуют до своего срока' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Партнёрство уже не действует' })
  async end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PartnershipDetail> {
    const parsed = PartnershipReasonInput.safeParse(body ?? {})

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.end(id, parsed.data.reason)
  }

  @Post('partnerships/:id/block')
  @HttpCode(200)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Заблокировать вторую сторону навсегда' })
  @ApiOkResponse({ description: 'Заблокировано; живое приглашение или партнёрство закрыто' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  async block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PartnershipDetail> {
    const parsed = PartnershipReasonInput.safeParse(body ?? {})

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.block(id, parsed.data.reason)
  }

  @Post('partnerships/:id/messages')
  @HttpCode(201)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Написать второй стороне' })
  @ApiCreatedResponse({ description: 'Сообщение отправлено' })
  @ApiNotFoundResponse({ description: 'Нет такого партнёрства' })
  @ApiConflictResponse({ description: 'Приглашение ещё не принято или партнёрство завершено' })
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<PartnershipMessageView> {
    const parsed = SendPartnershipMessageInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.partnerships.sendMessage(id, parsed.data.text)
  }
}
