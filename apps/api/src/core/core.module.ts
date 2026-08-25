import { Global, Module } from '@nestjs/common'

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
 */
@Global()
@Module({
  providers: [PrismaService, LedgerService],
  exports: [PrismaService, LedgerService],
})
export class CoreModule {}
