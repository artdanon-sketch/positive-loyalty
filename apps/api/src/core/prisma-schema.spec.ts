import { describe, expect, it } from 'vitest'

import { buildSchemaBoundConfig } from './prisma.service'

/**
 * Схема базы обязана доезжать до базы ДВУМЯ разными путями.
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ СУЩЕСТВУЕТ. База может быть общей с чужим продуктом: у нас
 * своя схема, у соседа своя. И тут есть ловушка, которую не видит ни компилятор,
 * ни остальные тесты:
 *
 *   • запросы, которые Prisma генерирует сама, берут схему из опции адаптера.
 *     БЕЗ неё драйвер не «резолвит по search_path», а ЗАШИВАЕТ в каждый
 *     идентификатор литерал `public`. Настройка search_path на роли такую
 *     сборку не чинит — в SQL буквально написано public;
 *   • сырой SQL (`$queryRaw`) уходит в драйвер как есть и разрешается уже
 *     по search_path соединения. Опция адаптера на него не влияет вовсе.
 *
 * Пропусти любую из двух настроек — и часть запросов уйдёт в чужую схему,
 * часть в нашу, а падать никто не будет. Хуже того: если старые таблицы
 * остались в public, приложение молча продолжит писать журнал туда.
 *
 * Поэтому проверяется именно НАША конфигурация, а не внутренности библиотеки,
 * и без всякой базы: открывать соединение, чтобы узнать, что мы в него положили,
 * незачем.
 */

const CONNECTION = 'postgresql://user:pass@127.0.0.1:5432/db'

describe('Привязка к схеме базы', () => {
  it('схема уходит в опции адаптера — для запросов, которые строит Prisma', () => {
    const { adapterOptions } = buildSchemaBoundConfig(CONNECTION, 'loyalty')

    expect(adapterOptions.schema).toBe('loyalty')
  })

  it('схема уходит в search_path — для сырого SQL', () => {
    const { poolConfig } = buildSchemaBoundConfig(CONNECTION, 'loyalty')

    expect(poolConfig.options).toContain('search_path=loyalty')
  })

  it('схемы соседа в search_path НЕТ — промах падает, а не читает чужое', () => {
    // Самая ценная проверка файла. Пока public стоял в хвосте «на случай
    // расширений», не найдя свою таблицу, сырой SQL молча читал бы одноимённую
    // таблицу чужого продукта — и вернул бы правдоподобный ответ.
    //
    // Расширения нам не нужны: хеши считает Node, идентификаторы — Prisma,
    // а pg_catalog ищется всегда, без упоминания в списке.
    const { poolConfig } = buildSchemaBoundConfig(CONNECTION, 'loyalty')

    expect(poolConfig.options).toBe('-c search_path=loyalty')
    expect(poolConfig.options).not.toContain('public')
  })

  it('обе настройки согласованы между собой', () => {
    // Разъехавшиеся значения — худший исход: Prisma пишет в одну схему,
    // сырой SQL читает из другой, и расхождение видно только по данным.
    const { poolConfig, adapterOptions } = buildSchemaBoundConfig(CONNECTION, 'shop')

    expect(poolConfig.options).toBe(`-c search_path=${adapterOptions.schema}`)
  })

  /**
   * Шифрование канала до базы.
   *
   * ЗАЧЕМ ЭТИ ТЕСТЫ. Драйвер по умолчанию шифрование НЕ запрашивает, а облачная
   * база соединение без него принимает. Проверено на живой базе: запрос
   * проходит, ошибки нет — и ничто не сообщает, что пароль и данные гостей
   * только что ушли через интернет открытым текстом.
   *
   * Отказ такого рода нельзя заметить глазами: он выглядит как успех.
   * Поэтому он проверяется здесь.
   */
  it('до удалённой базы соединение шифруется', () => {
    const { poolConfig } = buildSchemaBoundConfig(
      'postgresql://user:pass@db.example.supabase.co:5432/postgres',
      'loyalty',
    )

    expect(poolConfig.ssl).not.toBe(false)
  })

  it('до местной базы шифрование не навязывается', () => {
    // Локальный postgres из docker-compose сертификата не имеет, и требовать
    // от него шифрования значит сломать разработку ради ничего.
    const { poolConfig } = buildSchemaBoundConfig(CONNECTION, 'public')

    expect(poolConfig.ssl).toBe(false)
  })

  it('без сертификата подлинность сервера не проверяется — и это видно', () => {
    // Шифрование без проверки защищает от подслушивания, но не от подмены.
    // Тест фиксирует именно это состояние, чтобы оно оставалось осознанным.
    const { poolConfig } = buildSchemaBoundConfig(
      'postgresql://user:pass@db.example.supabase.co:5432/postgres',
      'loyalty',
    )

    expect(poolConfig.ssl).toEqual({ rejectUnauthorized: false })
  })

  it('с сертификатом подлинность сервера проверяется', () => {
    const ca = '-----BEGIN CERTIFICATE----- тест -----END CERTIFICATE-----'

    const { poolConfig } = buildSchemaBoundConfig(
      'postgresql://user:pass@db.example.supabase.co:5432/postgres',
      'loyalty',
      ca,
    )

    expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true, ca })
  })

  it('неразбираемый адрес считается удалённым: ошибаемся в сторону шифрования', () => {
    const { poolConfig } = buildSchemaBoundConfig('это не адрес', 'loyalty')

    expect(poolConfig.ssl).not.toBe(false)
  })

  it('сегодняшнее поведение сохраняется на схеме public', () => {
    const { poolConfig, adapterOptions } = buildSchemaBoundConfig(CONNECTION, 'public')

    expect(adapterOptions.schema).toBe('public')
    expect(poolConfig.options).toBe('-c search_path=public')
  })
})
