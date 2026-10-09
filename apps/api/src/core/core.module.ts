import { Global, Module } from '@nestjs/common'

import { AuditService } from './audit.service'
import { BirthdayService } from './birthday.service'
import { LedgerEventsService } from './ledger-events.service'
import { StaffRewardsService } from './staff-rewards.service'
import { StaffRewardsSweeper } from './staff-rewards.sweeper'
import { LedgerService } from './ledger.service'
import { MembershipRulesService } from './membership-rules.service'
import { OfferGrantService } from './offer-grant.service'
import { PointsExpiryService } from './points-expiry.service'
import { PointsExpirySweeper } from './points-expiry.sweeper'
import { PrismaService } from './prisma.service'
import { ReferralSharesService } from './referral-shares.service'

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
 *
 * `AuditService` — в ядре по той же причине, что и Prisma: писать в аудит обязаны
 * все контуры без исключения. Касса при отмене операции, бэк-офис при правке
 * конфига, будущая админка платформы при входе под владельцем. Модуль, в который
 * аудит пришлось бы импортировать, рано или поздно забудут импортировать —
 * и пропажа следа обнаружится ровно тогда, когда след понадобится.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    LedgerService,
    LedgerEventsService,
    StaffRewardsService,
    StaffRewardsSweeper,
    PointsExpiryService,
    PointsExpirySweeper,
    AuditService,
    OfferGrantService,
    MembershipRulesService,
    ReferralSharesService,
    BirthdayService,
  ],
  exports: [
    PrismaService,
    LedgerService,
    LedgerEventsService,
    StaffRewardsService,
    PointsExpiryService,
    AuditService,
    OfferGrantService,
    MembershipRulesService,
    ReferralSharesService,
    BirthdayService,
  ],
})
export class CoreModule {}
