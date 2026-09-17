import { Injectable, Logger } from '@nestjs/common'

import { Prisma } from '../generated/prisma/client'

import { PrismaService } from './prisma.service'

/**
 * AuditService — единственная точка записи в AuditLog.
 *
 * ЗАЧЕМ ЭТО ЕСТЬ. docs/05, раздел 9 требует отдельную таблицу, а не общие логи,
 * и перечисляет, что обязано в неё попадать: изменение конфига программы, ручная
 * правка баланса, отмена операции, просмотр полного телефона, экспорт базы, вход
 * админа платформы, impersonate. Логи ротируются и теряются; запись «поддержка
 * смотрела телефоны чужих гостей» теряться не должна.
 *
 * ПОЧЕМУ ЗДЕСЬ $executeRaw, А НЕ prisma.auditLog.create(). Приложению выдан ровно
 * INSERT: SELECT и UPDATE отобраны миграцией 20260909100000, DELETE не выдавался.
 * А Prisma после create() ВСЕГДА читает строку обратно через RETURNING — то есть
 * create() упал бы на отсутствии SELECT.
 *
 * Это не обходной путь, а прямое следствие права «только дописывать»: тот, кто
 * пишет в аудит, не должен уметь его читать. Соблазн «выдать SELECT, чтобы Prisma
 * заработала» надо гасить сразу — он превращает журнал наблюдений в обычную
 * таблицу, которую выгрузит первая же ошибка в обычном API.
 *
 * ПОЧЕМУ ЗАПИСЬ НЕ ЛОМАЕТ ВЫЗЫВАЮЩЕГО. Аудит пишется вне транзакции основного
 * действия и его провал не откатывает само действие: отменить кассиру операцию
 * из-за недоступности журнала — хуже, чем потерять одну строку наблюдения.
 * Но провал обязан быть громким, поэтому он логируется уровнем error и в этом
 * же виде уезжает в алерты. Тихо проглоченный аудит — это отсутствующий аудит.
 *
 * ИСКЛЮЧЕНИЕ ИЗ ЭТОГО ПРАВИЛА — impersonate. Там запись обязана предшествовать
 * действию и её провал обязан отменить вход: смотреть чужие данные без следа
 * нельзя. Для этого есть writeOrThrow.
 */

/** Кто совершил действие. Повторяет AuditActorType из схемы. */
export type AuditActorType = 'SYSTEM' | 'GUEST' | 'CASHIER' | 'MANAGER' | 'OWNER' | 'PLATFORM_ADMIN'

/**
 * Что произошло. Машиночитаемый список, а не свободная строка: по нему строятся
 * выборки при разборе инцидента, и опечатка в одном месте сделала бы событие
 * невидимым для поиска.
 *
 * Список открыт для пополнения, но новое значение добавляется сюда, а не
 * передаётся строкой мимо типа.
 */
export type AuditAction =
  /** Админ платформы вошёл под владельцем заведения. Причина обязательна. */
  | 'IMPERSONATE_START'
  | 'IMPERSONATE_END'
  /** Показан полный телефон гостя — docs/05, матрица доступа. */
  | 'PHONE_REVEALED'
  /** Ручная правка баланса владельцем. */
  | 'BALANCE_ADJUSTED'
  /** Отмена операции с причиной. */
  | 'OPERATION_REVERSED'
  /** Изменён конфиг программы лояльности. */
  | 'PROGRAM_CONFIG_CHANGED'
  /** Экспорт базы гостей. */
  | 'DATABASE_EXPORTED'
  /** Вход админа платформы в свой контур. */
  | 'PLATFORM_ADMIN_SIGNED_IN'
  /** Перевыпуск доступа админа платформы: пароль, второй фактор, коды. */
  | 'PLATFORM_CREDENTIALS_REISSUED'
  /** Владелец добавил сотрудника. */
  | 'STAFF_CREATED'
  /** Изменены имя, роль или доступ сотрудника. Отключение — тоже здесь. */
  | 'STAFF_UPDATED'
  /** Сотруднику задан новый PIN, его сессии отозваны. */
  | 'STAFF_PIN_RESET'
  /** Гостю подарен промокод из карточки — с причиной. */
  | 'GIFT_ISSUED'
  /** Заведение пожаловалось на приглашение как на спам — docs/07, раздел 6.2. */
  | 'INVITE_SPAM_REPORTED'
  /** Админ платформы разобрал жалобы на спам — приостановка приглашений снята. */
  | 'INVITE_COMPLAINTS_REVIEWED'
  /** Владелец собрал акцию в конструкторе — правила целиком. */
  | 'OFFER_CREATED'
  /** Акция запущена, поставлена на паузу или завершена. */
  | 'OFFER_STATUS_CHANGED'
  /** Владелец назначил гостю статус вручную или вернул на лестницу — с причиной. */
  | 'GUEST_TIER_CHANGED'
  /** Владелец завёл шаблон сертификата — docs/11, У9. */
  | 'CERTIFICATE_CREATED'
  /** Шаблон сертификата переименован, выключен или снова включён. */
  | 'CERTIFICATE_UPDATED'
  /** Ответ на отзыв гостя — владельца или менеджера. docs/11, У10. */
  | 'REVIEW_REPLIED'
  /** Владелец написал новость для гостей. docs/11, У13. */
  | 'NEWS_CREATED'
  /** Новость поправлена, опубликована или снята с публикации. */
  | 'NEWS_UPDATED'
  /** Ответ на жалобу или предложение гостя. */
  | 'GUEST_MESSAGE_REPLIED'
  /** Владелец создал рассылку: сообщение уходит всей выбранной базе. */
  | 'BROADCAST_CREATED'
  /** Включён, выключен или изменён автоматический сценарий рассылки. */
  | 'AUTOMATION_CHANGED'

export interface AuditEntry {
  readonly action: AuditAction
  readonly actorType: AuditActorType
  /** `null` для SYSTEM: у фонового задания нет субъекта. */
  readonly actorId?: string | null
  /** `null` — действие вне заведения: вход админа платформы, общий прайсинг. */
  readonly tenantId?: string | null
  readonly entityType?: string | null
  readonly entityId?: string | null
  readonly oldValue?: Prisma.InputJsonValue | null
  readonly newValue?: Prisma.InputJsonValue | null
  /** Обязательна для impersonate — проверяется здесь, а не ограничением таблицы. */
  readonly reason?: string | null
  readonly ip?: string | null
  readonly userAgent?: string | null
  readonly requestId?: string | null
}

/** Действия, у которых причина текстом обязательна (docs/02, раздел 6). */
const REASON_REQUIRED: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'IMPERSONATE_START',
  'BALANCE_ADJUSTED',
  'DATABASE_EXPORTED',
  'GUEST_TIER_CHANGED',
])

/** Причина не может быть пробелом ради галочки. */
const MIN_REASON_LENGTH = 8

export class AuditReasonRequiredError extends Error {
  constructor(action: AuditAction) {
    super(
      `Действие ${action} требует причину текстом длиной не менее ${MIN_REASON_LENGTH} ` +
        'символов: без неё запись в аудите не объясняет, зачем это делали.',
    )
    this.name = 'AuditReasonRequiredError'
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Записать наблюдение. Провал не пробрасывается — но и не замалчивается.
   *
   * Применять для действий, которые уже совершились: отмена операции, правка
   * конфига. Для impersonate нужен writeOrThrow.
   */
  async write(entry: AuditEntry): Promise<void> {
    try {
      await this.writeOrThrow(entry)
    } catch (error) {
      // Уровень error, а не warn: пропущенная запись аудита — это инцидент,
      // по которому положен разбор, а не строчка, которую пролистывают.
      this.logger.error(
        `Не записано в аудит: ${entry.action}, ` +
          `субъект ${entry.actorType}${entry.actorId === undefined || entry.actorId === null ? '' : ` ${entry.actorId}`}, ` +
          `заведение ${entry.tenantId ?? '—'}`,
        error instanceof Error ? error.stack : undefined,
      )
    }
  }

  /**
   * Записать наблюдение или упасть.
   *
   * Для случаев, где действие без следа недопустимо: вход под владельцем.
   * Провал обязан отменить само действие, а не остаться строчкой в логе.
   */
  async writeOrThrow(entry: AuditEntry): Promise<void> {
    this.assertReason(entry)

    // Сырой INSERT без RETURNING: у роли приложения нет SELECT на этой таблице,
    // и Prisma create() упал бы, попытавшись прочитать строку обратно.
    await this.prisma.$executeRaw`
      INSERT INTO "AuditLog" (
        "id", "tenantId", "actorType", "actorId", "action",
        "entityType", "entityId", "oldValue", "newValue",
        "reason", "ip", "userAgent", "requestId"
      ) VALUES (
        gen_random_uuid(),
        ${entry.tenantId ?? null},
        ${entry.actorType}::"AuditActorType",
        ${entry.actorId ?? null},
        ${entry.action},
        ${entry.entityType ?? null},
        ${entry.entityId ?? null},
        ${entry.oldValue === undefined || entry.oldValue === null ? null : JSON.stringify(entry.oldValue)}::jsonb,
        ${entry.newValue === undefined || entry.newValue === null ? null : JSON.stringify(entry.newValue)}::jsonb,
        ${entry.reason ?? null},
        ${entry.ip ?? null},
        ${entry.userAgent ?? null},
        ${entry.requestId ?? null}
      )
    `
  }

  private assertReason(entry: AuditEntry): void {
    if (!REASON_REQUIRED.has(entry.action)) {
      return
    }

    const reason = entry.reason?.trim() ?? ''

    if (reason.length < MIN_REASON_LENGTH) {
      throw new AuditReasonRequiredError(entry.action)
    }
  }
}
