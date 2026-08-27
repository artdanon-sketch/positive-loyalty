import { Global, Module } from '@nestjs/common'

import { LedgerEventsService } from './ledger-events.service'
import { LedgerService } from './ledger.service'
import { PrismaService } from './prisma.service'

/**
 * Ядро: доступ к базе и журнал баллов.
 *
 * Модуль помечен `@Global` сознательно. PrismaService — единственное соединение с базой
 * на весь процесс, и альтернатива глобальности здесь одна: импортировать CoreModule в
 * каждый доменный модуль (rules, identity, risk, comms, integrations, admin, pos,
 * platform). Через месяц кто-нибудь забудет импорт и заведёт второй PrismaClient рядом —
 * а это второй пул соединений к Supabase и вторая правда о том, кто держит транзакцию.
 *
 * `LedgerService` экспортируется отсюда и только отсюда: он единственная точка, через
 * которую в системе меняются баллы (CLAUDE.md, железное правило 1).
 *
 * `LedgerEventsService` живёт здесь же, а не в модуле бэк-офиса, ради направления
 * зависимостей: журнал публикует событие, бэк-офис на него подписывается. Если бы
 * издатель лежал в `admin`, ядро зависело бы от прикладного модуля — и подписаться
 * на журнал из кассы или из воркера стало бы нельзя, не потащив за собой бэк-офис.
 */
@Global()
@Module({
  providers: [PrismaService, LedgerService, LedgerEventsService],
  exports: [PrismaService, LedgerService, LedgerEventsService],
})
export class CoreModule {}
