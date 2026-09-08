/**
 * ТЕСТ-СТРАЖ: журнал работает под РОЛЬЮ ПРИЛОЖЕНИЯ, а не под владельцем базы.
 *
 * ─── Что этот файл сторожит ──────────────────────────────────────────────────
 *
 * `LedgerService.runSerializable` открывает СВОЮ транзакцию, а `SET LOCAL` живёт
 * ровно внутри той транзакции, где выполнен. Значит объявить тенанта снаружи,
 * обёрткой `PrismaService.forTenant`, невозможно в принципе: до транзакции журнала
 * то объявление не долетает. Пока журнал не выставлял `app.tenant_id` первой же
 * строкой своей транзакции, под ролью positive_app ЛЮБОЕ начисление падало с
 * «new row violates row-level security policy»: политики сравнивали `tenantId`
 * с NULL, и WITH CHECK не пропускал вставку.
 *
 * Починка — одна строка в `runSerializable`. Цена её потери — неработающая касса,
 * поэтому у неё должен быть свой тест, а не устное обещание.
 *
 * ─── Почему семь существующих тестов журнала этого не ловили ─────────────────
 *
 * И не могли поймать. Все они поднимают контекст по `DATABASE_URL_TEST`, а это
 * роль postgres — ВЛАДЕЛЕЦ таблиц. Владелец политики RLS игнорирует ровно так же,
 * как игнорирует REVOKE: `FORCE ROW LEVEL SECURITY` на таблицах не включён и
 * включён не будет — под ним перестают работать миграции и seed (миграция
 * 20260826120000_tenant_isolation_rls, там же разобрана и отклонена альтернатива).
 *
 * То есть в тех семи файлах RLS физически не участвует: начисление проходит
 * одинаково и с объявленным тенантом, и без него. Дописать восьмую проверку
 * в любой из них — значит дописать ещё одну зелёную строку, которая ничего
 * не проверяет.
 *
 * Единственный тест, ходящий под ролью приложения, — tenant-isolation. Он
 * доказывает, что чужое НЕ видно, и делает это сырым SQL. Про то, что СВОЁ обязано
 * записаться через `LedgerService`, в нём нет ничего — и ровно в эту щель баг прошёл.
 *
 * ─── Отсюда устройство файла ─────────────────────────────────────────────────
 *
 * Два контекста. Данные готовит ВЛАДЕЛЕЦ: заведение и участие создаются до всякого
 * начисления, и проверять на них RLS — отдельная задача, не предмет этого файла.
 * А само НАЧИСЛЕНИЕ идёт под positive_app — под той ролью, под которой API работает
 * в бою. Проверки результата тоже читает владелец: ему видно всё, включая то,
 * что роль приложения по ошибке могла записать не туда.
 *
 * Первый тест доказывает, что соединение действительно подчиняется политикам.
 * Без него весь файл был бы той самой зелёной проверкой, которая ничего не проверяет:
 * достаточно указать `DATABASE_URL_TEST_APP_ROLE` на владельца, и страж уснёт.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  countByIdempotencyKey,
  countEntries,
  createLedgerTestContext,
  createMembershipFixture,
  expectLedgerError,
  idempotencyKey,
  POS_ORIGIN,
  readBalance,
  readCounters,
  readLedgerSum,
  type LedgerTestContext,
  type MembershipFixture,
} from './ledger-test-context'

/**
 * Строка подключения под ролью positive_app.
 *
 * Приём взят из tenant-isolation дословно, включая отказ вместо пропуска.
 * Причина там же: если роль в тестовой базе не заведена, блок ЧЕСТНО падает
 * с инструкцией, а не пропускается молча. Пропущенная проверка изоляции хуже
 * красной — она выглядит как отсутствие проблемы.
 */
const appRoleUrl = (): string => {
  const explicit = process.env['DATABASE_URL_TEST_APP_ROLE']
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit
  }
  throw new Error(
    'Не задан DATABASE_URL_TEST_APP_ROLE — строка подключения под ролью positive_app. ' +
      'Без неё RLS не проверяется: тесты ходят владельцем, а владельца политики не касаются. ' +
      'Как завести роль локально — в prisma/README.md.',
  )
}

/**
 * Поднимает тот же контекст, что и остальные тесты журнала, но под ролью приложения.
 *
 * `PrismaService` читает строку подключения из `process.env.DATABASE_URL` в
 * конструкторе и другого входа для неё не имеет. Поэтому переменная подменяется
 * ровно на время сборки модуля: под positive_app поднимается НАСТОЯЩИЙ провайдер
 * приложения — со схемой, TLS и пулом, — а не его копия с другим конструктором.
 * Копия рано или поздно разъехалась бы с оригиналом, и страж начал бы сторожить
 * не то, что работает в проде.
 *
 * Возврат переменной в `finally`: следующий вызов `createLedgerTestContext()`
 * в этом же прогоне обязан снова попасть к владельцу.
 */
const createAppRoleContext = async (): Promise<LedgerTestContext> => {
  const previous = process.env['DATABASE_URL']
  process.env['DATABASE_URL'] = appRoleUrl()

  try {
    return await createLedgerTestContext()
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL']
    } else {
      process.env['DATABASE_URL'] = previous
    }
  }
}

describe('LedgerService под ролью приложения', () => {
  /** Владелец таблиц: готовит данные и читает результат — ему видно всё. */
  let owner: LedgerTestContext
  /** positive_app: под ней идут сами начисления, и только они. */
  let appRole: LedgerTestContext
  let fixture: MembershipFixture

  beforeAll(async () => {
    owner = await createLedgerTestContext()
    appRole = await createAppRoleContext()
  })

  afterAll(async () => {
    // beforeAll мог упасть на первом же контексте — тогда второго не существует,
    // и настоящую причину падения не должен перекрывать TypeError из teardown.
    await appRole?.close()
    await owner?.close()
  })

  // Своё участие на каждый тест: чистое состояние без удаления чужих строк
  // (журнал append-only, см. шапку ledger-test-context).
  beforeEach(async () => {
    fixture = await createMembershipFixture(owner.prisma)
  })

  it('оснастка не вырождена: соединение теста действительно под политиками RLS', async () => {
    // Запись делает ВЛАДЕЛЕЦ — здесь проверяется не начисление, а видимость.
    await owner.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 100,
        idempotencyKey: idempotencyKey('app-role-probe'),
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(await countEntries(owner.prisma, fixture.membershipId)).toBe(1)

    // А роль приложения без объявленного тенанта не видит эту строку вовсе:
    // `current_setting('app.tenant_id', true)` возвращает NULL, сравнение с NULL
    // даёт NULL, то есть «не видно». Если здесь окажется единица — переменная
    // DATABASE_URL_TEST_APP_ROLE указывает на владельца, и оба теста ниже
    // доказывают ровно ничего.
    expect(await countEntries(appRole.prisma, fixture.membershipId)).toBe(0)
  })

  it('начисление под ролью приложения проходит и двигает баланс', async () => {
    const key = idempotencyKey('app-role-earn')

    // ВОТ ЭТА СТРОКА И ЕСТЬ ТЕСТ. До починки `runSerializable` она падала с
    // «new row violates row-level security policy»: транзакция журнала своя,
    // тенант в ней не объявлен, WITH CHECK вставку не пропускает.
    const result = await appRole.ledger.earn(
      {
        membershipId: fixture.membershipId,
        amount: 500,
        basisAmount: 69_000, // 690,00 ฿ в сатангах: минорные единицы, никаких float
        idempotencyKey: key,
        ...POS_ORIGIN,
      },
      fixture.scope,
    )

    expect(result.replayed).toBe(false)
    expect(result.entry.amount).toBe(500)
    expect(result.entry.tenantId).toBe(fixture.tenantId)

    // Читаем владельцем: если бы роль приложения записала строку не туда,
    // проверка под тем же RLS этого не показала бы — чужое ей просто не видно.
    expect(await readBalance(owner.prisma, fixture.membershipId)).toBe(500)
    expect(await readLedgerSum(owner.prisma, fixture.membershipId)).toBe(500)
    expect(await countEntries(owner.prisma, fixture.membershipId)).toBe(1)
    expect(await readCounters(owner.prisma, fixture.membershipId)).toStrictEqual({
      visitsTotal: 1,
      spentTotal: 69_000,
    })

    // И то же самое глазами приложения: с объявленным тенантом запись видна.
    // Это доказывает, что в `tenantId` строки лежит именно наш тенант, а не пусто:
    // при любом другом значении политика её бы скрыла.
    const visibleToApp = await appRole.prisma.forTenant(fixture.tenantId, (tx) =>
      tx.ledgerEntry.count({ where: { membershipId: fixture.membershipId } }),
    )
    expect(visibleToApp).toBe(1)
  })

  it('начисление на участие соседнего заведения не находит участия', async () => {
    // Соседний мерчант: свой тенант, свой гость, своё участие.
    const neighbour = await createMembershipFixture(owner.prisma)
    const key = idempotencyKey('app-role-foreign')

    // Под ролью приложения у кросс-тенантной защиты два рубежа, и они не должны
    // подменять друг друга: фильтр по tenantId в `loadMembership` (рубеж 1) и
    // политика на Membership (рубеж 2). Оба дают один и тот же исход — участия
    // не существует, — и это правильный исход: 404 MEMBERSHIP_NOT_FOUND, а не 403.
    // 403 подтверждает существование участия и сам по себе утечка (docs/02, раздел 0).
    await expectLedgerError(
      () =>
        appRole.ledger.earn(
          {
            membershipId: neighbour.membershipId,
            amount: 100,
            idempotencyKey: key,
            ...POS_ORIGIN,
          },
          fixture.scope, // тенант ПЕРВОГО заведения
        ),
      'MEMBERSHIP_NOT_FOUND',
    )

    // Отказ не должен ничего дописать — ни соседу, ни себе.
    expect(await countEntries(owner.prisma, neighbour.membershipId)).toBe(0)
    expect(await readBalance(owner.prisma, neighbour.membershipId)).toBe(0)
    expect(await countByIdempotencyKey(owner.prisma, key)).toBe(0)
    expect(await countEntries(owner.prisma, fixture.membershipId)).toBe(0)
  })
})
