import { randomBytes } from 'node:crypto'

/**
 * Коды, которые люди читают вслух и набирают руками: промокоды подарков
 * и приглашения друзей. Один генератор на оба — два алфавита однажды разошлись бы,
 * и код, который гость видит у себя, у стойки бы не приняли.
 *
 * Алфавит без 0, O, 1, I и L: экономия на различимости оборачивается спором
 * с гостем, которого «не пускает рабочий купон».
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Криптостойкий код без смещения выборки: байты из неполного диапазона отброшены. */
export const randomCode = (length: number): string => {
  const out: string[] = []
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length

  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) {
        continue
      }

      out.push(CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length))

      if (out.length === length) {
        break
      }
    }
  }

  return out.join('')
}

/**
 * Нарушение UNIQUE — по коду Prisma или по коду PostgreSQL.
 *
 * Проверяются оба: адаптер драйвера не всегда доносит код Postgres наверх,
 * и полагаться на что-то одно означает, что повтор однажды перестанет
 * распознаваться и превратится в отказ на ровном месте.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const record = error as { code?: unknown; cause?: { code?: unknown } }

  return record.code === 'P2002' || record.code === '23505' || record.cause?.code === '23505'
}
