import { describe, expect, it } from 'vitest'

import { assertMigrated, checkMigrations } from './assert-migrated'
import type { AppliedMigration } from './assert-migrated'

/**
 * Отказ стартовать против непромигрированной базы.
 *
 * ─── Что здесь сторожится ────────────────────────────────────────────────────
 *
 * Разница между «не сходится» и «не смог посмотреть». Первое обязано
 * останавливать запуск, второе — обязано его пропускать. Спутать их в любую
 * сторону одинаково плохо:
 *
 *   пропустить несовпадение      вернуть 10 сентября: сервис отвечает ok
 *                                на /health и падает на каждом чтении журнала;
 *   упасть на невозможности       пустая локальная база, тест, первая секунда
 *   проверить                     после переезда — запуск ломается без причины.
 */

const rows = (...names: string[]): AppliedMigration[] =>
  names.map((migration_name) => ({ migration_name }))

const ALL = ['20260101000000_first', '20260202000000_second'] as const

describe('Сверка миграций', () => {
  it('всё применено — запуск разрешён', async () => {
    const result = await checkMigrations(ALL, () => Promise.resolve(rows(...ALL)))

    expect(result).toEqual({ ok: true, missing: [], skippedBecause: null })
  })

  it('НЕ ХВАТАЕТ МИГРАЦИИ — ЗАПУСК ЗАПРЕЩЁН, И НАЗВАНА ИМЕННО ОНА', async () => {
    const result = await checkMigrations(ALL, () => Promise.resolve(rows(ALL[0])))

    expect(result.ok).toBe(false)
    // Не просто «не сходится»: инженер, увидевший отказ ночью, должен узнать
    // из сообщения, что именно накатить.
    expect(result.missing).toEqual([ALL[1]])
  })

  it('лишняя миграция в базе запуску не мешает', async () => {
    // Откат кода на прошлый релиз — обычное дело: база впереди, и это норма.
    // Ругаться здесь значило бы запретить откаты.
    const result = await checkMigrations(ALL, () =>
      Promise.resolve(rows(...ALL, '20260303000000_newer')),
    )

    expect(result.ok).toBe(true)
  })

  it('НЕДОСТУПНЫЙ ЖУРНАЛ МИГРАЦИЙ — ПРОПУСК, А НЕ ОТКАЗ', async () => {
    // Ровно этот случай на первом выпуске: GRANT приезжает той же миграцией,
    // которую проверка и хочет увидеть.
    const result = await checkMigrations(ALL, () =>
      Promise.reject(new Error('permission denied for table _prisma_migrations')),
    )

    expect(result.ok).toBe(true)
    expect(result.skippedBecause).toContain('permission denied')
    expect(result.missing).toEqual([])
  })

  it('СПИСКА МИГРАЦИЙ НЕТ — ПРОПУСК, А НЕ «ОЖИДАЕМ НИЧЕГО»', async () => {
    // Отсутствие списка не должно превращаться в проверку, которая всегда
    // довольна: молчаливое «всё сошлось» здесь опаснее отсутствия проверки,
    // потому что выглядит как работающая защита.
    const result = await checkMigrations(null, () => Promise.resolve(rows()))

    expect(result.ok).toBe(true)
    expect(result.skippedBecause).not.toBeNull()
  })

  it('база не отвечает — запуск не блокируется', async () => {
    const result = await checkMigrations(ALL, () => Promise.reject(new Error('connect ETIMEDOUT')))

    expect(result.ok).toBe(true)
  })

  it('незаконченная миграция применённой не считается', async () => {
    // Запрос отбирает строки с finished_at IS NOT NULL, поэтому прерванная
    // миграция до сверки не доезжает и попадает в недостающие.
    let asked = ''
    const result = await checkMigrations(ALL, (sql) => {
      asked = sql
      return Promise.resolve(rows(ALL[0]))
    })

    expect(asked).toContain('finished_at IS NOT NULL')
    expect(result.missing).toEqual([ALL[1]])
  })
})

describe('Остановка запуска', () => {
  it('БРОСАЕТ, КОГДА БАЗА ОТСТАЛА', async () => {
    // В точке входа это падение роняет процесс — и для Railway становится
    // неудачной выкаткой: прежняя версия продолжает обслуживать людей.
    await expect(assertMigrated(() => Promise.resolve(rows(ALL[0])), ALL)).rejects.toThrow(
      /не применены миграции/,
    )
  })

  it('молчит, когда проверить не удалось', async () => {
    await expect(
      assertMigrated(() => Promise.reject(new Error('permission denied')), ALL),
    ).resolves.toBeUndefined()
  })
})
