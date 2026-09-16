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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { AdminMessagesQuery, ReplyGuestMessageInput } from '@positive/contracts'
import type { AdminGuestMessage, AdminMessagesList } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { MessagesService } from './messages.service'

/**
 * Жалобы и предложения. docs/02, раздел 5.15 · docs/03, раздел 8.
 *
 * Менеджер и владелец — как отзывы: на обращения отвечают каждый день, и кассиру
 * их видеть незачем (в них жалуются и на него).
 */

const invalid = (
  issues: ReadonlyArray<{ readonly message: string; readonly path: readonly PropertyKey[] }>,
): BadRequestException =>
  new BadRequestException({
    error: {
      code: 'VALIDATION_FAILED',
      message: issues[0]?.message ?? 'Некорректный запрос',
      details: { fields: issues.map((issue) => issue.path.join('.')) },
    },
  })

@ApiTags('admin')
@Controller('admin/messages')
@Roles('MANAGER', 'OWNER')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  @ApiOperation({ summary: 'Жалобы и предложения гостей — свежие сверху' })
  @ApiOkResponse({ description: 'unanswered — сколько ждут ответа по всему заведению' })
  @ApiBadRequestResponse({ description: 'Неизвестный вид или фильтр ответа, страница больше ста' })
  @ApiForbiddenResponse({ description: 'Кассиру обращения не показываются' })
  async list(@Query() query: Record<string, unknown>): Promise<AdminMessagesList> {
    const parsed = AdminMessagesQuery.safeParse(query)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.messages.list(parsed.data)
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ответить гостю — ответ виден в приложении' })
  @ApiOkResponse({ description: 'Обращение с ответом' })
  @ApiBadRequestResponse({ description: 'Ответ пустой или длиннее тысячи знаков' })
  @ApiForbiddenResponse({ description: 'Кассиру обращения не показываются' })
  @ApiNotFoundResponse({ description: 'Обращения нет в этом заведении' })
  async reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AdminGuestMessage> {
    const parsed = ReplyGuestMessageInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.messages.reply(id, parsed.data)
  }
}
