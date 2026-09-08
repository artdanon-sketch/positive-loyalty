import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'

import { getEnv } from '../common/config/env'
import { PrismaClient } from '../generated/prisma/client'
import { buildSchemaBoundConfig, PrismaService } from '../core/prisma.service'

/**
 * Подключение админки платформы: та же база, ДРУГАЯ роль Postgres.
 *
 * ─── В ЧЁМ СМЫСЛ ОТДЕЛЬНОГО КЛИЕНТА ──────────────────────────────────────────
 *
 * Обычный PrismaService ходит ролью positive_app, и она по построению не видит
 * ничего за пределами объявленного заведения. Админке платформы нужно ровно
 * обратное — видеть все заведения сразу, — и получает она это не проверкой
 * в коде, а тем, что подключается под ролью positive_platform (миграция
 * 20260909140000).
 *
 * Граница проходит по роли базы, а не по декоратору на контроллере. Забытый
 * декоратор — это утечка; забытая строка подключения — это отказ. Направление
 * ошибки выбрано осознанно, потому что в этом проекте прикладная защита уже
 * ломалась дважды (PR #38, #39).
 *
 * ─── ПОЧЕМУ НАСЛЕДНИК, А НЕ САМОСТОЯТЕЛЬНЫЙ КЛАСС ────────────────────────────
 *
 * Чтобы AuditService принимал его без единой правки. Аудит — общий для всех
 * контуров, и переделывать его под интерфейс ради одного случая значило бы
 * усложнить общий код в угоду частному.
 *
 * ─── ЧТО ЭТОТ КЛИЕНТ УМЕЕТ, А ЧЕГО НЕТ ───────────────────────────────────────
 *
 * Ровно то, что выдано роли миграциями, и ни байтом больше. Он НЕ видит
 * телефоны и имена гостей, хеш PIN сотрудника, ключ подписи вебхуков, сессии
 * и коды входа: права выданы поколоночно, а таблицы с секретами не выданы вовсе.
 * Забыть об этом и попытаться прочитать — значит получить permission denied
 * от самой базы, а не пустой результат.
 */

/** Строка подключения роли платформы. Отдельная переменная, а не DATABASE_URL. */
const resolvePlatformUrl = (): string => {
  const raw = process.env['DATABASE_URL_PLATFORM']

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'Не задан DATABASE_URL_PLATFORM — строка подключения под ролью positive_platform. ' +
        'Это НЕ то же самое, что DATABASE_URL: под обычной ролью админка платформы ' +
        'не увидит ни одного заведения, потому что политики RLS отсекут всё. ' +
        'Как выдать роли пароль — в .env.example, раздел про positive_platform.',
    )
  }

  return raw
}

const createPlatformClientOptions = (): ConstructorParameters<typeof PrismaClient>[0] => {
  const { poolConfig, adapterOptions } = buildSchemaBoundConfig(
    resolvePlatformUrl(),
    getEnv().databaseSchema,
    getEnv().databaseSslCa,
  )

  return {
    adapter: new PrismaPg(poolConfig, adapterOptions),
    log: ['error'],
    errorFormat: 'minimal',
  }
}

@Injectable()
export class PlatformPrismaService extends PrismaService {
  constructor() {
    super(createPlatformClientOptions())
  }
}
