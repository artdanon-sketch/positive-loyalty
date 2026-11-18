import type { Prisma } from '../generated/prisma/client'

/**
 * Подарки первой покупки — приветственные баллы и разовая награда пригласившему.
 * docs/05, раздел 6.6.
 *
 * Решение владельца 14.11.2026: ОТМЕНА ПЕРВОЙ ПОКУПКИ ЗАБИРАЕТ ПОДАРКИ, А СЛЕДУЮЩАЯ
 * НАСТОЯЩАЯ ПОКУПКА ВЫДАЁТ ИХ СНОВА. Иначе «провести и отменить» дарило баллы гостю
 * и его другу без покупки, а гость, чей чек отменили по ошибке кассира, терял подарок
 * навсегда.
 *
 * КЛЮЧ — ОДИН НА ПОПЫТКУ. Первая выдача пишется прежним ключом (`welcome:{участие}`,
 * `referral:{участие друга}`): записи, сделанные до этого решения, остаются первыми
 * попытками. Каждая следующая — тем же ключом с номером: `welcome:{участие}:1`, `:2`…
 * Номер — число уже выданных, включая отменённые. Две кассы одного гостя в одну секунду
 * считают одинаково и упираются в тот же ключ, поэтому второго подарка не будет.
 *
 * ДЕЙСТВУЮЩИЙ подарок — выданный и не отменённый: только он мешает выдать ещё один.
 */

export const giftKey = (base: string, attempt: number): string =>
  attempt === 0 ? base : `${base}:${String(attempt)}`

/** Все попытки подарка по базовому ключу: сам ключ и он же с номером. */
export const giftAttemptsWhere = (base: string): Prisma.LedgerEntryWhereInput => ({
  OR: [{ idempotencyKey: base }, { idempotencyKey: { startsWith: `${base}:` } }],
})

export interface GiftAttempts {
  /** Выданный и не отменённый подарок, если есть. */
  active: { id: string; amount: number } | null
  /** Номер следующей попытки. */
  next: number
}

export const readGiftAttempts = async (
  tx: Prisma.TransactionClient,
  tenantId: string,
  base: string,
): Promise<GiftAttempts> => {
  const attempts = await tx.ledgerEntry.findMany({
    where: { tenantId, type: 'GRANT', ...giftAttemptsWhere(base) },
    select: { id: true, amount: true, reversedBy: { select: { id: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const active = attempts.find((attempt) => attempt.reversedBy === null) ?? null

  return {
    active: active === null ? null : { id: active.id, amount: active.amount },
    next: attempts.length,
  }
}
