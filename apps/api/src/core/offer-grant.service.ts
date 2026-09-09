import { randomBytes, randomUUID } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from './prisma.service'

/**
 * Выдача и погашение промокодов — единственная точка обеих операций.
 *
 * ─── ПОЧЕМУ ЭТОТ СЕРВИС ВАЖЕН ДАЛЬШЕ, ЧЕМ КАЖЕТСЯ ───────────────────────────
 *
 * Железное правило 6 (CLAUDE.md) называет его поимённо: партнёрства между
 * заведениями обязаны выдавать и гасить награды ЧЕРЕЗ НЕГО, а не заводить
 * «партнёрские коды» рядом. Значит всё, что здесь заложено — проверки,
 * атомарность, коды ошибок, — достанется и партнёрствам даром, а всякая
 * дыра здесь достанется им точно так же.
 *
 * ─── АТОМАРНОСТЬ ПОГАШЕНИЯ — ГЛАВНОЕ В ЭТОМ ФАЙЛЕ ───────────────────────────
 *
 * docs/02, раздел 3.4 предписывает буквально: `UPDATE ... WHERE id = … AND
 * state = 'ISSUED'` с проверкой, что изменилась ровно одна строка. Соблазн
 * написать «прочитали, проверили, обновили» здесь смертелен: два кассира,
 * одновременно пробившие один код, оба прочитают ISSUED, оба решат, что можно,
 * и заведение отдаст товар дважды.
 *
 * Условие в самом UPDATE снимает вопрос без транзакций и блокировок: второй
 * запрос изменит ноль строк и получит отказ.
 *
 * ─── ПОРЯДОК ПРОВЕРОК ЗАДАН ТЗ, А НЕ УДОБСТВОМ ──────────────────────────────
 *
 * docs/02, раздел 3.4: код существует → не использован → не истёк → тенант
 * совпадает → окно по времени суток. Первая непройденная возвращает СВОЙ код
 * ошибки. Здесь это не утечка: кассир должен понимать, что сказать гостю,
 * а гость и так держит этот код в руках.
 *
 * Это сознательно иначе, чем во входе админа платформы, где все причины
 * отказа слиты в одну: там ответ читает тот, кто подбирает, здесь — тот,
 * кто обслуживает.
 */

/** Отказ в погашении. Код машиночитаемый — по нему касса рисует подсказку. */
export class GrantRedeemError extends Error {
  constructor(
    readonly code:
      | 'GRANT_NOT_FOUND'
      | 'GRANT_ALREADY_USED'
      | 'GRANT_EXPIRED'
      | 'GRANT_WRONG_TENANT'
      | 'GRANT_OUT_OF_WINDOW',
    message: string,
  ) {
    super(message)
    this.name = 'GrantRedeemError'
  }
}

export interface IssueGrantInput {
  readonly offerId: string
  readonly guestId: string
  readonly tenantId: string
  /** Сколько дней живёт код. Партнёрства передают своё значение из Term. */
  readonly validityDays: number
  /**
   * Ключ идемпотентности. Повтор с тем же ключом вернёт ПЕРВЫЙ промокод,
   * а не выдаст второй.
   *
   * Нужен партнёрствам: событие кассы может прийти дважды — при повторной
   * доставке, при перезапуске обработчика, при ретрае. Гость не должен
   * получить два подарка за одну покупку, а заведение-донор — платить дважды.
   *
   * Ложится в колонку nonce, у которой уже есть UNIQUE. Гарантию даёт база,
   * а не проверка в коде: два одновременных события прошли бы проверку оба.
   */
  readonly idempotencyKey?: string
  readonly now: Date
}

export interface RedeemGrantInput {
  readonly code: string
  readonly tenantId: string
  /** Кто гасит: сотрудник на кассе. Попадает в grant.redeemedBy. */
  readonly redeemedBy?: string | null
  readonly now: Date
}

export interface GrantView {
  readonly id: string
  readonly code: string
  readonly offerId: string
  readonly guestId: string
  readonly expiresAt: Date
  /**
   * Промокод не выдан заново, а возвращён по ключу идемпотентности.
   *
   * Вызывающему это важно: партнёрства не должны поднимать счётчик выдач
   * на повторе, иначе лимит «всего 200» исчерпается доставками событий,
   * а не гостями.
   */
  readonly replayed: boolean
}

/**
 * Алфавит кода.
 *
 * Без 0, O, 1, I и L: код читают вслух у стойки и набирают руками с экрана
 * телефона. Экономия на различимости оборачивается спором с гостем, которого
 * «не пускает рабочий купон».
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/**
 * Двенадцать знаков вместо требуемых ТЗ восьми.
 *
 * docs/01 раздел 4.5 задаёт минимум восемь. На нашем алфавите из 31 символа
 * восемь знаков — это около 10^12 вариантов: для кода, который живёт неделю
 * и не имеет счётчика попыток на стороне кассы, маловато. Двенадцать дают
 * 10^18 и ничего не стоят: их всё равно не набирают руками, а сканируют.
 */
const CODE_LENGTH = 12

@Injectable()
export class OfferGrantService {
  private readonly logger = new Logger(OfferGrantService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Выдать гостю промокод по акции.
   *
   * Тенант передаётся отдельным полем и сверяется с акцией: выдать промокод
   * чужой акции нельзя даже случайной опечаткой в offerId.
   */
  async issue(input: IssueGrantInput): Promise<GrantView> {
    return this.prisma.forTenant(input.tenantId, async (tx) => {
      const offer = await tx.offer.findFirst({
        where: { id: input.offerId, tenantId: input.tenantId },
        select: { id: true },
      })

      if (offer === null) {
        // Политика RLS и так не отдала бы чужую акцию, но явная проверка
        // превращает «пусто» в понятную ошибку вместо загадочного отказа.
        throw new Error(`Акция ${input.offerId} не найдена в этом заведении`)
      }

      const expiresAt = new Date(input.now.getTime() + input.validityDays * 24 * 60 * 60 * 1000)

      const nonce = input.idempotencyKey ?? randomUUID()

      try {
        const created = await tx.offerGrant.create({
          data: {
            offerId: input.offerId,
            tenantId: input.tenantId,
            guestId: input.guestId,
            code: generateCode(),
            nonce,
            issuedAt: input.now,
            expiresAt,
          },
          select: { id: true, code: true, offerId: true, guestId: true, expiresAt: true },
        })

        return { ...created, replayed: false }
      } catch (error) {
        // Повтор по ключу — не ошибка, а норма: событие пришло дважды.
        // Возвращаем ПЕРВЫЙ промокод, как это делает журнал баллов с
        // idempotencyKey (docs/02, раздел 0).
        if (input.idempotencyKey === undefined || !isUniqueViolation(error)) {
          throw error
        }

        const existing = await tx.offerGrant.findUnique({
          where: { nonce },
          select: { id: true, code: true, offerId: true, guestId: true, expiresAt: true },
        })

        if (existing === null) {
          // Нарушен другой UNIQUE — например, код случайно совпал.
          // Проглотить это значило бы выдать вместо промокода загадку.
          throw error
        }

        this.logger.debug(`Повтор выдачи по ключу: возвращён промокод ${existing.id}`)
        return { ...existing, replayed: true }
      }
    })
  }

  /**
   * Погасить промокод на кассе.
   *
   * Возвращает погашенный промокод. Повторное погашение того же кода —
   * это GRANT_ALREADY_USED, а не молчаливый успех: касса обязана сказать
   * кассиру, что купон уже использован, иначе товар отдадут второй раз.
   */
  async redeem(input: RedeemGrantInput): Promise<GrantView> {
    const code = input.code.trim().toUpperCase()

    return this.prisma.forTenant(input.tenantId, async (tx) => {
      // Ищем БЕЗ фильтра по тенанту, чтобы отличить «нет такого кода» от
      // «код чужого заведения»: это разные подсказки кассиру. Политика RLS
      // при этом всё равно не отдаст чужую строку — значит чужой код здесь
      // выглядит как ненайденный, и различить их можно только по факту
      // существования, а не по содержимому. См. комментарий ниже.
      const grant = await tx.offerGrant.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          offerId: true,
          guestId: true,
          tenantId: true,
          state: true,
          expiresAt: true,
          offer: { select: { schedule: true } },
        },
      })

      if (grant === null) {
        // Под RLS сюда попадает и «кода нет вовсе», и «код чужого заведения»:
        // чужую строку политика не отдаёт. Отдельный GRANT_WRONG_TENANT
        // остаётся в перечне ошибок ради honest-контракта с кассой, но
        // достижим он только там, где чтение идёт без изоляции.
        throw new GrantRedeemError('GRANT_NOT_FOUND', 'Такого кода нет')
      }

      if (grant.tenantId !== input.tenantId) {
        throw new GrantRedeemError('GRANT_WRONG_TENANT', 'Код выдан другим заведением')
      }

      if (grant.state !== 'ISSUED') {
        throw new GrantRedeemError(
          'GRANT_ALREADY_USED',
          grant.state === 'REDEEMED' ? 'Код уже погашен' : 'Код аннулирован',
        )
      }

      if (grant.expiresAt <= input.now) {
        throw new GrantRedeemError('GRANT_EXPIRED', 'Срок действия кода истёк')
      }

      if (!withinWindow(grant.offer.schedule, input.now)) {
        throw new GrantRedeemError('GRANT_OUT_OF_WINDOW', 'Код действует не в это время суток')
      }

      // ВОТ РАДИ ЭТОЙ СТРОКИ ВСЁ ОСТАЛЬНОЕ.
      //
      // Условие state = ISSUED стоит В САМОМ UPDATE, а не в проверке выше.
      // Проверки выше нужны, чтобы объяснить кассиру причину; гарантию даёт
      // только эта строка. Два кассира, пробившие код одновременно, оба
      // пройдут проверки — но обновит строку ровно один.
      const updated = await tx.offerGrant.updateMany({
        where: { id: grant.id, state: 'ISSUED' },
        data: { state: 'REDEEMED', redeemedAt: input.now, redeemedBy: input.redeemedBy ?? null },
      })

      if (updated.count !== 1) {
        this.logger.warn(`Гонка на погашении кода: промокод ${grant.id} уже погашен`)
        throw new GrantRedeemError('GRANT_ALREADY_USED', 'Код уже погашен')
      }

      return {
        id: grant.id,
        code: grant.code,
        offerId: grant.offerId,
        guestId: grant.guestId,
        expiresAt: grant.expiresAt,
        // Погашение не бывает повтором: второе отвергается выше.
        replayed: false,
      }
    })
  }
}

/**
 * Нарушение UNIQUE — по коду Prisma или по коду PostgreSQL.
 *
 * Проверяются оба: адаптер драйвера не всегда доносит код Postgres наверх,
 * и полагаться на что-то одно означает, что повтор однажды перестанет
 * распознаваться и превратится в отказ на ровном месте.
 */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const record = error as { code?: unknown; cause?: { code?: unknown } }

  return record.code === 'P2002' || record.code === '23505' || record.cause?.code === '23505'
}

/** Криптостойкий код без смещения выборки: байты из неполного диапазона отброшены. */
const generateCode = (): string => {
  const out: string[] = []
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length

  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) {
        continue
      }

      out.push(CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length))

      if (out.length === CODE_LENGTH) {
        break
      }
    }
  }

  return out.join('')
}

/**
 * Окно по времени суток из Offer.schedule.
 *
 * Расписания нет или окно не задано — считаем, что действует круглосуточно.
 * Отсутствие ограничения не должно превращаться в запрет: «завтрак с 8 до 11»
 * задаёт тот, кому это нужно, остальные акции работают весь день.
 *
 * Сравнение идёт по времени СЕРВЕРА, и это осознанное упрощение первой версии:
 * у заведения есть Tenant.timezone, и правильнее считать по нему. Пока все
 * заведения на Пхукете, разница нулевая; при выходе за пределы Таиланда это
 * место придётся починить, и лучше, чтобы оно было названо, чем найдено.
 */
const withinWindow = (schedule: unknown, at: Date): boolean => {
  if (typeof schedule !== 'object' || schedule === null) {
    return true
  }

  const window = (schedule as Record<string, unknown>)['timeWindow']

  if (typeof window !== 'object' || window === null) {
    return true
  }

  const from = (window as Record<string, unknown>)['from']
  const to = (window as Record<string, unknown>)['to']

  if (typeof from !== 'string' || typeof to !== 'string') {
    return true
  }

  const minutes = at.getHours() * 60 + at.getMinutes()
  const start = parseMinutes(from)
  const end = parseMinutes(to)

  if (start === null || end === null) {
    return true
  }

  // Окно через полночь — «с 22:00 до 02:00» — это два отрезка, а не один.
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end
}

const parseMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())

  if (match === null) {
    return null
  }

  const hours = Number(match[1])
  const mins = Number(match[2])

  return hours <= 23 && mins <= 59 ? hours * 60 + mins : null
}
