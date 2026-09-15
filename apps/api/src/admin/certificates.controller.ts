import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CreateCertificateInput, UpdateCertificateInput } from '@positive/contracts'
import type { CertificateTemplate } from '@positive/contracts'

import { Roles } from '../common/tenant/roles.decorator'
import { CertificatesService } from './certificates.service'

/**
 * Шаблоны сертификатов. docs/02, раздел 5.11.
 *
 * Смотрит менеджер и владелец: менеджер дарит сертификат из карточки гостя.
 * Заводит и меняет владелец — сертификат стоит заведению денег.
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
@Controller('admin/certificates')
@Roles('MANAGER', 'OWNER')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @ApiOperation({ summary: 'Шаблоны сертификатов со счётчиками «выдано / использовано»' })
  @ApiOkResponse({ description: 'В порядке заведения' })
  async list(): Promise<CertificateTemplate[]> {
    return this.certificates.list()
  }

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  @ApiOperation({ summary: 'Завести шаблон сертификата' })
  @ApiCreatedResponse({ description: 'Шаблон создан и сразу выдаётся' })
  @ApiBadRequestResponse({
    description: 'Название, награда или срок не проходят, шаблонов больше 50',
  })
  @ApiForbiddenResponse({ description: 'Заводит только владелец' })
  async create(@Body() body: unknown): Promise<CertificateTemplate> {
    const parsed = CreateCertificateInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.certificates.create(parsed.data)
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Переименовать, выключить или снова включить шаблон' })
  @ApiOkResponse({ description: 'Шаблон изменён' })
  @ApiBadRequestResponse({ description: 'Нечего менять или значение не проходит' })
  @ApiForbiddenResponse({ description: 'Меняет только владелец' })
  @ApiNotFoundResponse({ description: 'Шаблона нет в этом заведении' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CertificateTemplate> {
    const parsed = UpdateCertificateInput.safeParse(body)

    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }

    return this.certificates.update(id, parsed.data)
  }
}
