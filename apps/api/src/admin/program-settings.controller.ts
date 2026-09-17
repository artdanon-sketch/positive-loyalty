import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import {
  BirthdaySettings,
  ProgramSettings,
  ReferralSettings,
  StaffRewardSettings,
  ReviewSettings,
  SuspiciousSettings,
  TierSettings,
} from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { ProgramSettingsService } from './program-settings.service'

/**
 * Настройки программы. docs/02, раздел 5.6.
 *
 * Только владелец: процент начисления — это деньги заведения, и менеджер,
 * способный поднять его себе в смену, раздавал бы чужую выручку баллами.
 */
@ApiTags('admin')
@Controller('admin/settings/program')
@Roles('OWNER')
export class ProgramSettingsController {
  constructor(private readonly settings: ProgramSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Настройки программы',
    description: 'Только те, что касса уже соблюдает: начисление, оплата баллами, правила кассы.',
  })
  @ApiOkResponse({ description: 'Текущие настройки' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async get(): Promise<ProgramSettings> {
    return this.settings.get()
  }

  @Put()
  @ApiOperation({
    summary: 'Изменить настройки программы',
    description:
      'Заменяет три настройки целиком; остальное в настройках заведения не трогает. ' +
      'Касса применяет новые значения со следующего чека.',
  })
  @ApiOkResponse({ description: 'Настройки сохранены' })
  @ApiBadRequestResponse({ description: 'Значение вне допустимого диапазона' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async update(@Body() body: unknown): Promise<ProgramSettings> {
    const parsed = ProgramSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Некорректные настройки',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.update(parsed.data)
  }

  @Get('tiers')
  @ApiOperation({
    summary: 'Статусы гостей и приветственные баллы',
    description: 'Лестница статусов снизу вверх и приветственные баллы. docs/02, раздел 5.6.1.',
  })
  @ApiOkResponse({ description: 'Текущие статусы и приветственные баллы' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async getTiers(): Promise<TierSettings> {
    return this.settings.getTiers()
  }

  @Put('tiers')
  @ApiOperation({
    summary: 'Изменить статусы и приветственные баллы',
    description:
      'Заменяет лестницу и приветственные баллы целиком; остальные настройки не трогает. ' +
      'Касса применяет со следующего чека.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({
    description:
      'Два статуса с одним id или названием, ставка вне диапазона, включённые приветственные баллы — ноль',
  })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async updateTiers(@Body() body: unknown): Promise<TierSettings> {
    const parsed = TierSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректные статусы',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateTiers(parsed.data)
  }

  @Get('staff-reward')
  @ApiOperation({
    summary: 'Мотивация кассиров',
    description: 'Включена ли доплата, за что платим, когда зачитываем. docs/03, раздел 6.',
  })
  @ApiOkResponse({ description: 'Текущие настройки доплаты' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  async getStaffReward(): Promise<StaffRewardSettings> {
    return this.settings.getStaffReward()
  }

  @Put('staff-reward')
  @ApiOperation({
    summary: 'Изменить мотивацию кассиров',
    description:
      'Заменяет настройки доплаты целиком; остальное не трогает. Уже начисленные ' +
      'награды не пересчитываются: смена отработана по прежним правилам.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({ description: 'Нулевая включённая доплата, процент больше 50' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  async updateStaffReward(@Body() body: unknown): Promise<StaffRewardSettings> {
    const parsed = StaffRewardSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректные настройки доплаты',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateStaffReward(parsed.data)
  }

  @Get('referral')
  @ApiOperation({
    summary: 'Приглашения друзей',
    description:
      'Включены ли, сколько баллов за друга и сколько наград на гостя. docs/02, раздел 5.6.2.',
  })
  @ApiOkResponse({ description: 'Текущие настройки приглашений' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async getReferral(): Promise<ReferralSettings> {
    return this.settings.getReferral()
  }

  @Put('referral')
  @ApiOperation({
    summary: 'Изменить приглашения друзей',
    description:
      'Заменяет настройки приглашений целиком; остальное не трогает. ' +
      'Касса применяет со следующего чека.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({ description: 'Включённая награда — ноль, лимит вне 1–100' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async updateReferral(@Body() body: unknown): Promise<ReferralSettings> {
    const parsed = ReferralSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректные настройки приглашений',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateReferral(parsed.data)
  }

  @Get('birthday')
  @ApiOperation({
    summary: 'Подарок ко дню рождения',
    description: 'Баллы или сертификат и окно в днях до и после. docs/02, раздел 5.6.3.',
  })
  @ApiOkResponse({ description: 'Текущие настройки дня рождения' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async getBirthday(): Promise<BirthdaySettings> {
    return this.settings.getBirthday()
  }

  @Put('birthday')
  @ApiOperation({
    summary: 'Изменить подарок ко дню рождения',
    description: 'Заменяет настройки дня рождения целиком; остальное не трогает.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({
    description: 'Окно шире двух недель, баллы вне диапазона, CERTIFICATE_NOT_FOUND',
  })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async updateBirthday(@Body() body: unknown): Promise<BirthdaySettings> {
    const parsed = BirthdaySettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректные настройки дня рождения',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateBirthday(parsed.data)
  }

  @Get('reviews')
  @ApiOperation({
    summary: 'Автоответы на отзывы',
    description: 'Пять мест — на оценки от 1 до 5; null — без автоответа. docs/02, раздел 5.6.4.',
  })
  @ApiOkResponse({ description: 'Текущие автоответы' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async getReviews(): Promise<ReviewSettings> {
    return this.settings.getReviews()
  }

  @Put('reviews')
  @ApiOperation({
    summary: 'Изменить автоответы на отзывы',
    description: 'Заменяет автоответы целиком; остальное не трогает.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({ description: 'Мест не пять, ответ пустой или длиннее 1000 знаков' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async updateReviews(@Body() body: unknown): Promise<ReviewSettings> {
    const parsed = ReviewSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректные автоответы',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateReviews(parsed.data)
  }

  @Get('suspicious')
  @ApiOperation({
    summary: 'Порог подозрительных чеков',
    description: 'Больше стольких чеков у гостя за день — повод посмотреть. docs/02, раздел 5.6.5.',
  })
  @ApiOkResponse({ description: 'Текущий порог' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async getSuspicious(): Promise<SuspiciousSettings> {
    return this.settings.getSuspicious()
  }

  @Put('suspicious')
  @ApiOperation({
    summary: 'Изменить порог подозрительных чеков',
    description: 'Заменяет порог; остальное не трогает.',
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @ApiBadRequestResponse({ description: 'Порог не целое от 2 до 50' })
  @ApiForbiddenResponse({ description: 'Не владелец' })
  @ApiInternalServerErrorResponse({ description: 'TENANT_MISCONFIGURED — настройки не читаются' })
  async updateSuspicious(@Body() body: unknown): Promise<SuspiciousSettings> {
    const parsed = SuspiciousSettings.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный порог',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.settings.updateSuspicious(parsed.data)
  }
}
