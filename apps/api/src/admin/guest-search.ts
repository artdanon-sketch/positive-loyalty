import type { AdminGuestFilters } from '@positive/contracts'

import type { Prisma } from '../generated/prisma/client'

/**
 * Условие поиска гостя по одной строке. docs/10, раздел 5.2.
 *
 * Строка проверяется сразу на всё, что гость может сказать у стойки, и гость
 * попадает в выдачу, если совпало хоть что-то:
 *
 * - имя — по вхождению, без учёта регистра: «анна» находит «Анна Ковалёва»;
 * - номер чека — точное совпадение с номером на операции;
 * - последние цифры телефона — от четырёх цифр, пробелы и плюс не мешают;
 * - промокод — точное совпадение, регистр не важен: гость диктует как видит.
 *
 * ПОЧЕМУ ТЕЛЕФОН ОТ ЧЕТЫРЁХ ЦИФР. Три последние цифры совпадают у каждого
 * тысячного номера, а в базе кафе их тысячи — выдача превратилась бы в список
 * случайных людей. Четыре — ровно столько, сколько менеджер и так видит в маске.
 *
 * ИЗОЛЯЦИЮ ДЕРЖИТ НЕ ЭТОТ ФИЛЬТР. Условие добавляется к `tenantId` участия,
 * а промокоды дополнительно ограничены своим заведением: без этого гость нашёлся
 * бы по коду, выданному ему соседом. Второй рубеж — RLS.
 */

const PHONE_TAIL_MIN = 4

/** Алфавит кодов — латиница и цифры; дефис бывает в кодах, заведённых руками. */
const CODE_PATTERN = /^[A-Za-z0-9-]{4,32}$/

/** Пробелы, скобки, плюс, точки и дефисы, которыми люди разбивают номер. */
const PHONE_NOISE = /[\s()+.-]/g

export const guestSearchWhere = (
  tenantId: string,
  raw: string | undefined,
): Prisma.MembershipWhereInput => {
  const q = raw?.trim() ?? ''

  if (q === '') {
    return {}
  }

  const anyOf: Prisma.MembershipWhereInput[] = [
    { guest: { displayName: { contains: q, mode: 'insensitive' } } },
    { ledgerEntries: { some: { refId: q } } },
  ]

  const digits = q.replace(PHONE_NOISE, '')

  if (/^\d+$/.test(digits) && digits.length >= PHONE_TAIL_MIN) {
    anyOf.push({ guest: { phoneE164: { endsWith: digits } } })
  }

  if (CODE_PATTERN.test(q)) {
    anyOf.push({ guest: { offerGrants: { some: { tenantId, code: q.toUpperCase() } } } })
  }

  return { OR: anyOf }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Фильтры списка — через «и», поверх поиска. docs/11, У4.
 *
 * «СПЯЩИЕ» — ТЕ, КТО БЫЛ, но не заходил дольше указанного. Гость без единого
 * визита не спит — он ещё не пришёл; для него отдельный фильтр «не покупали».
 *
 * Статус — сохранённый в участии. Он пересчитывается после каждого чека и сразу
 * после правки лестницы, поэтому совпадает с тем, что показывает карточка.
 */
export const guestFilterWhere = (
  tenantId: string,
  filters: AdminGuestFilters,
  now: Date,
): Prisma.MembershipWhereInput => {
  const and: Prisma.MembershipWhereInput[] = [guestSearchWhere(tenantId, filters.q)]

  if (filters.mode !== undefined) {
    and.push({ guest: { mode: filters.mode } })
  }

  if (filters.tier !== undefined) {
    and.push({ tierId: filters.tier })
  }

  if (filters.source !== undefined) {
    and.push({ source: filters.source })
  }

  if (filters.sleeping !== undefined) {
    and.push({
      lastVisitAt: { not: null, lt: new Date(now.getTime() - filters.sleeping * DAY_MS) },
    })
  }

  if (filters.buyers === 'none') {
    and.push({ visitsTotal: 0 })
  }

  return { AND: and }
}
