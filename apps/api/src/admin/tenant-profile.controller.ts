import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { TenantProfile } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'

import { TenantProfileService } from './tenant-profile.service'

/**
 * Профиль заведения. docs/02, раздел 5.6.7.
 *
 * Только владелец: часовой пояс двигает границу суток во всех отчётах, а имя
 * заведения стоит в каждом сообщении гостю.
 */
@ApiTags('admin')
@Controller('admin/settings/profile')
@Roles('OWNER')
export class TenantProfileController {
  constructor(private readonly profile: TenantProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Профиль заведения: имя, вид, пояс, язык и контакты' })
  @ApiOkResponse({ description: 'Текущий профиль; незаполненные поля — пустые' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async get(): Promise<TenantProfile> {
    return this.profile.get()
  }

  @Put()
  @ApiOperation({ summary: 'Изменить профиль заведения' })
  @ApiOkResponse({ description: 'Профиль сохранён' })
  @ApiBadRequestResponse({ description: 'Пустое имя, неизвестный пояс или ссылка не ссылка' })
  @ApiForbiddenResponse({ description: 'Только владелец' })
  async update(@Body() body: unknown): Promise<TenantProfile> {
    const parsed = TenantProfile.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.profile.update(parsed.data)
  }
}
