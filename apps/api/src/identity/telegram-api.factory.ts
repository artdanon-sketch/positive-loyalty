import { Injectable } from '@nestjs/common'

import { TelegramApi } from './telegram-api'

/**
 * Откуда берётся клиент Telegram для бота заведения.
 *
 * ЗАЧЕМ ОБЁРТКА НАД `new`. Ключ у каждого заведения свой, поэтому клиент
 * создаётся на лету — и без этой фабрики его нельзя подменить в тесте:
 * проверка «нерабочий ключ не сохраняется» ходила бы в настоящий Telegram
 * и падала бы вместе с его доступностью.
 *
 * Это единственная её задача. Ни кеша, ни повторов здесь нет: клиент дешёвый,
 * а повторы — дело вызывающего.
 */
@Injectable()
export class TelegramApiFactory {
  for(token: string): TelegramApi {
    return new TelegramApi(token)
  }
}
