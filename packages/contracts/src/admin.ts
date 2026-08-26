import { z } from 'zod'

import { LedgerSource, LedgerType } from './ledger.js'

/**
 * Контракты бэк-офиса заведения.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ tenantId НИ В ОДНОМ ВХОДЕ. Он берётся только из токена
 * (CLAUDE.md, железное правило 2). Поле во входной схеме означало бы, что
 * заведение может назвать чужой идентификатор и получить чужие данные —
 * ровно та дыра, ради закрытия которой существует изоляция тенантов.
 */

/** Одна операция в журнале — то, что видно в списке операций. */
export const AdminLedgerEntry = z
  .object({
    id: z.uuid(),
    type: LedgerType,
    source: LedgerSource,
    /** Знаковое: плюс начисление, минус списание. Целое, в баллах. */
    amount: z.number().int(),
    balanceAfter: z.number().int(),
    /** Сумма чека в минорных единицах. Может отсутствовать: не всякая операция от чека. */
    basisAmount: z.number().int().nonnegative().nullable(),
    membershipId: z.uuid(),
    guestId: z.uuid(),
    /** Номер чека или иной внешний идентификатор источника. */
    refId: z.string().nullable(),
    /** Заполнено у компенсаций: какую операцию отменяет. */
    reversalOfId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type AdminLedgerEntry = z.infer<typeof AdminLedgerEntry>

export const AdminLedgerList = z
  .object({
    items: z.array(AdminLedgerEntry),
    /** Сколько всего операций у заведения. Нужно для постраничной навигации. */
    total: z.number().int().nonnegative(),
  })
  .strict()

export type AdminLedgerList = z.infer<typeof AdminLedgerList>

/** Участие гостя в программе заведения. */
export const AdminMembership = z
  .object({
    id: z.uuid(),
    guestId: z.uuid(),
    /**
     * Кэш баланса. Источник истины — журнал; расхождение ловит ежесуточная сверка.
     */
    pointsBalance: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    spentTotal: z.number().int().nonnegative(),
    /** Гость в контрольной группе: баллы ему не начисляются, и он об этом знает. */
    isControlGroup: z.boolean(),
    lastVisitAt: z.iso.datetime().nullable(),
  })
  .strict()

export type AdminMembership = z.infer<typeof AdminMembership>

/** Постраничный запрос списка. Верхняя граница жёсткая: без неё это выгрузка базы. */
export const AdminListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

export type AdminListQuery = z.infer<typeof AdminListQuery>

/** Гость в списке бэк-офиса — участие плюс витринные поля гостя. */
export const AdminGuestRow = z
  .object({
    /** Идентификатор участия: все действия на экране адресуются к нему. */
    membershipId: z.uuid(),
    guestId: z.uuid(),
    displayName: z.string().nullable(),
    /**
     * Телефон. Менеджеру приходит маскированным («+66 •• •• 4821»), владельцу —
     * целиком: матрица прав docs/05, раздел 3 разрешает полный номер только ему.
     * Решение о маскировании принимает сервер по роли из токена — клиент
     * ничего не «домаскирует», у него просто нет полного значения.
     */
    phone: z.string().min(1),
    mode: z.enum(['TOURIST', 'RESIDENT']),
    pointsBalance: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    /** Сумма покупок в минорных единицах. */
    spentTotal: z.number().int().nonnegative(),
    lastVisitAt: z.iso.datetime().nullable(),
    isControlGroup: z.boolean(),
  })
  .strict()

export type AdminGuestRow = z.infer<typeof AdminGuestRow>

export const AdminGuestsList = z
  .object({
    items: z.array(AdminGuestRow),
    total: z.number().int().nonnegative(),
  })
  .strict()

export type AdminGuestsList = z.infer<typeof AdminGuestsList>
