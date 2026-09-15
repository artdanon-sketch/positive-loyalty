import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AcceptReferralInput } from '@positive/contracts'
import type { AcceptReferralResult, GuestReferral } from '@positive/contracts'

import { Public } from '../common/tenant/public.decorator'

import { GuestReferralService } from './guest-referral.service'
import { GuestGuard } from './guest.guard'

/**
 * «Пригласить друга». docs/02, раздел 2.5 · docs/11, У6.
 *
 * Заведение — в адресе, а не в токене: у гостя нет своего заведения, кошелёк
 * общий на всю сеть. Границу держит база: без участия или кода в этом заведении
 * ответа нет.
 */
@ApiTags('guest')
@Controller('guest/venues/:tenantId/referral')
@Public()
@UseGuards(GuestGuard)
export class GuestReferralController {
  constructor(private readonly referrals: GuestReferralService) {}

  @Get()
  @ApiOperation({ summary: 'Код приглашения, сколько друзей пришло и за скольких получены баллы' })
  @ApiOkResponse({
    description: 'Код появляется при первом открытии; приглашения выключены — кода нет',
  })
  @ApiNotFoundResponse({ description: 'Гость ещё не бывал в этом заведении' })
  async referral(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<GuestReferral> {
    return this.referrals.referral(tenantId)
  }

  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Стать гостем заведения по приглашению друга' })
  @ApiOkResponse({ description: 'joined: false — гость уже был гостем заведения' })
  @ApiBadRequestResponse({ description: 'Код не из восьми букв и цифр' })
  @ApiNotFoundResponse({
    description: 'INVITE_NOT_FOUND — кода нет в этом заведении или приглашения выключены',
  })
  @ApiConflictResponse({ description: 'SELF_REFERRAL — своя ссылка' })
  async accept(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: unknown,
  ): Promise<AcceptReferralResult> {
    const parsed = AcceptReferralInput.safeParse(body)

    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: parsed.error.issues[0]?.message ?? 'Некорректный запрос',
          details: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    return this.referrals.accept(tenantId, parsed.data.code)
  }
}
