/**
 * Ошибки изоляции тенантов.
 *
 * Коды — машиночитаемые SCREAMING_SNAKE по docs/02, раздел 0. Сообщения
 * человекочитаемые и НЕ содержат идентификаторов чужих объектов: подсказка
 * «такого тенанта нет, а вот такой есть» сама по себе утечка.
 */
export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING'

  constructor() {
    super(
      'Контекст тенанта не установлен. Запрос дошёл до бизнес-логики в обход ' +
        'TenantContextMiddleware — это ошибка конфигурации модуля, а не входных данных.',
    )
    this.name = 'TenantContextMissingError'
  }
}

export class AccessTokenInvalidError extends Error {
  readonly code = 'ACCESS_TOKEN_INVALID'

  constructor(reason: string) {
    // Причина нужна в логах для разбора, но наружу отдаётся общий 401:
    // подробности отличают «токен просрочен» от «подпись не сошлась» и помогают подбирать.
    super(`Токен доступа отклонён: ${reason}`)
    this.name = 'AccessTokenInvalidError'
  }
}
