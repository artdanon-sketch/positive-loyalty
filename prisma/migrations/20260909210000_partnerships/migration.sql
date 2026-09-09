-- ─────────────────────────────────────────────────────────────────────────────
-- 20260909210000_partnerships
--
-- Партнёрства между заведениями. docs/07.
--
-- Два заведения договариваются напрямую и дают бонусы гостям друг друга.
-- Платформа в договорённости не участвует и денег между ними не гоняет
-- никогда — иначе это расчёты между юрлицами и регуляторный риск.
--
-- ─── ГЛАВНОЕ В ЭТОЙ МИГРАЦИИ: У ПАРТНЁРСТВА ДВА ХОЗЯИНА ─────────────────────
--
-- Все прежние таблицы принадлежат одному заведению, и политика RLS сравнивает
-- одну колонку с current_setting('app.tenant_id'). Здесь так нельзя: строку
-- обязаны видеть ОБЕ стороны, и ни одна из них не «главнее».
--
-- Поэтому политики проверяют ДВЕ колонки через ИЛИ. Это единственное место
-- в базе, устроенное так, и ошибиться в нём легко двумя способами:
--
--   забыть вторую половину условия — партнёр не видит собственного партнёрства,
--                                    и жалоба придёт не сразу, а когда он
--                                    впервые откроет раздел;
--   написать USING (true)          — партнёрство А↔B увидит постороннее C,
--                                    то есть узнает, кто с кем договорился
--                                    и на каких условиях. Это чужая
--                                    коммерческая тайна.
--
-- Оба случая закрыты тестом: «тенант C не читает партнёрство A↔B» и «обе
-- стороны видят своё».
--
-- ─── ПОЧЕМУ У СООБЩЕНИЯ ЕСТЬ ПОЛУЧАТЕЛЬ, КОТОРОГО НЕТ В НАБРОСКЕ ТЗ ─────────
--
-- В наброске у PartnershipMessage только отправитель. Тогда политику пришлось
-- бы писать подзапросом к Partnership — единственная такая среди всех.
-- Получатель к тому же нужен по существу: по нему считаются непрочитанные
-- и уходят уведомления. Поле не служебное.
--
-- ─── БЛОКИРОВКУ ВИДИТ ТОЛЬКО ТОТ, КТО ЗАБЛОКИРОВАЛ ─────────────────────────
--
-- Знание «меня заблокировали» само по себе сведение: по нему подбирают обход,
-- меняя лицо. Политика InviteBlock отдаёт строку только блокирующей стороне.
--
-- ─── ЦЕНЫ И КВОТЫ ЧИТАЮТ ВСЕ, МЕНЯЕТ ПЛАТФОРМА ─────────────────────────────
--
-- PartnershipPricing — это прайс: заведение обязано видеть, сколько стоит
-- лишнее приглашение, до того как нажмёт кнопку. Менять его может только
-- админ платформы, поэтому приложению выдан лишь SELECT.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateEnum
CREATE TYPE "PartnershipStatus" AS ENUM ('PROPOSED', 'NEGOTIATING', 'ACTIVE', 'PAUSED', 'ENDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('DRAFT', 'PROPOSED', 'ACCEPTED', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('INVITE', 'TEXT', 'TERM_PROPOSED', 'TERM_ACCEPTED', 'TERM_REJECTED', 'SYSTEM');

-- CreateTable
CREATE TABLE "Partnership" (
    "id" TEXT NOT NULL,
    "initiatorTenantId" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "status" "PartnershipStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "endReason" TEXT,

    CONSTRAINT "Partnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipTerm" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "triggerTenantId" TEXT NOT NULL,
    "rewardTenantId" TEXT NOT NULL,
    "offerId" TEXT,
    "trigger" JSONB NOT NULL,
    "reward" JSONB NOT NULL,
    "validityDays" INTEGER NOT NULL DEFAULT 7,
    "limits" JSONB NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'DRAFT',
    "proposedBy" TEXT NOT NULL,
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "grantsIssued" INTEGER NOT NULL DEFAULT 0,
    "grantsRedeemed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PartnershipTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnershipMessage" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "fromTenantId" TEXT NOT NULL,
    "toTenantId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "text" TEXT NOT NULL,
    "sourceLang" TEXT NOT NULL,
    "translations" JSONB NOT NULL,
    "termId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "PartnershipMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteQuota" (
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "freeUsed" INTEGER NOT NULL DEFAULT 0,
    "paidUsed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InviteQuota_pkey" PRIMARY KEY ("tenantId","date")
);

-- CreateTable
CREATE TABLE "InviteBlock" (
    "blockerTenantId" TEXT NOT NULL,
    "blockedTenantId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteBlock_pkey" PRIMARY KEY ("blockerTenantId","blockedTenantId")
);

-- CreateTable
CREATE TABLE "PartnershipPricing" (
    "id" TEXT NOT NULL,
    "vertical" "Vertical",
    "freeInvitesPerDay" INTEGER NOT NULL DEFAULT 3,
    "extraInvitePrice" INTEGER NOT NULL DEFAULT 0,
    "maxActivePartnerships" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Partnership_partnerTenantId_status_idx" ON "Partnership"("partnerTenantId", "status");

-- CreateIndex
CREATE INDEX "Partnership_initiatorTenantId_status_idx" ON "Partnership"("initiatorTenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Partnership_initiatorTenantId_partnerTenantId_key" ON "Partnership"("initiatorTenantId", "partnerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnershipTerm_offerId_key" ON "PartnershipTerm"("offerId");

-- CreateIndex
CREATE INDEX "PartnershipTerm_triggerTenantId_status_idx" ON "PartnershipTerm"("triggerTenantId", "status");

-- CreateIndex
CREATE INDEX "PartnershipTerm_rewardTenantId_status_idx" ON "PartnershipTerm"("rewardTenantId", "status");

-- CreateIndex
CREATE INDEX "PartnershipTerm_partnershipId_idx" ON "PartnershipTerm"("partnershipId");

-- CreateIndex
CREATE INDEX "PartnershipMessage_partnershipId_createdAt_idx" ON "PartnershipMessage"("partnershipId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnershipMessage_toTenantId_readAt_idx" ON "PartnershipMessage"("toTenantId", "readAt");

-- CreateIndex
CREATE INDEX "InviteBlock_blockedTenantId_idx" ON "InviteBlock"("blockedTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnershipPricing_vertical_key" ON "PartnershipPricing"("vertical");

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_initiatorTenantId_fkey" FOREIGN KEY ("initiatorTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PartnershipTerm" ADD CONSTRAINT "PartnershipTerm_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PartnershipTerm" ADD CONSTRAINT "PartnershipTerm_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PartnershipMessage" ADD CONSTRAINT "PartnershipMessage_partnershipId_fkey" FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InviteQuota" ADD CONSTRAINT "InviteQuota_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InviteBlock" ADD CONSTRAINT "InviteBlock_blockerTenantId_fkey" FOREIGN KEY ("blockerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "InviteBlock" ADD CONSTRAINT "InviteBlock_blockedTenantId_fkey" FOREIGN KEY ("blockedTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ── Права ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON TABLE "Partnership" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "PartnershipTerm" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "PartnershipMessage" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "InviteQuota" TO positive_app;

-- Блокировку можно снять — это не след инцидента, а решение владельца,
-- которое он вправе передумать. А вот ПРАВИТЬ её бессмысленно: у неё нет
-- изменяемых полей, кроме причины. UPDATE отбираем по той же причине, что
-- и у прайса: он приехал бы сам, а неиспользуемое право однажды используют.
REVOKE ALL ON TABLE "InviteBlock" FROM positive_app;
GRANT SELECT, INSERT, DELETE ON TABLE "InviteBlock" TO positive_app;

-- ПРАЙС ПРИЛОЖЕНИЕ ТОЛЬКО ЧИТАЕТ — И ЛИШНЕЕ ПРИХОДИТСЯ ОТБИРАТЬ.
--
-- Поймано прогоном этой миграции вхолостую: выдав один GRANT SELECT, я получил
-- у positive_app INSERT, SELECT и UPDATE. Лишнее приехало само из
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000), которое выдаёт права
-- на КАЖДУЮ новую таблицу.
--
-- Последствие было бы не косметическим: заведение переписало бы прайс
-- платформы — поставило себе тысячу бесплатных приглашений или цену ноль.
-- RLS это и так не пропустит (политика ниже разрешает только SELECT), но
-- держать открытым первый рубеж в расчёте на второй — ровно та беспечность,
-- из-за которой в этом проекте уже дважды текла изоляция.
REVOKE ALL ON TABLE "PartnershipPricing" FROM positive_app;
GRANT SELECT ON TABLE "PartnershipPricing" TO positive_app;

-- Платформа: читает всё (панель показывает, кто с кем сотрудничает)
-- и правит только прайс — это её собственная настройка.
GRANT SELECT ON TABLE "Partnership" TO positive_platform;
GRANT SELECT ON TABLE "PartnershipTerm" TO positive_platform;
GRANT SELECT ON TABLE "InviteQuota" TO positive_platform;
GRANT SELECT ON TABLE "InviteBlock" TO positive_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE "PartnershipPricing" TO positive_platform;

-- ПЕРЕПИСКА ПЛАТФОРМЕ НЕ ВЫДАНА, И ЭТО РЕШЕНИЕ, А НЕ ЗАБЫВЧИВОСТЬ.
--
-- Панели нужно знать, КТО с кем сотрудничает и на каких условиях — это видно
-- из Partnership и PartnershipTerm. Читать деловую переписку двух заведений
-- ей незачем: там частный разговор, а не факт партнёрства. Понадобится для
-- разбора жалобы — доступ выдаётся отдельной миграцией и осознанно.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "Partnership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnershipTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnershipMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InviteQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InviteBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PartnershipPricing" ENABLE ROW LEVEL SECURITY;

-- Обе стороны видят своё партнёрство. Посторонний — ничего.
CREATE POLICY both_sides ON "Partnership"
  USING (
    "initiatorTenantId" = current_setting('app.tenant_id', true)
    OR "partnerTenantId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    "initiatorTenantId" = current_setting('app.tenant_id', true)
    OR "partnerTenantId" = current_setting('app.tenant_id', true)
  );

-- У условия свои две стороны: где событие и кто даёт награду.
CREATE POLICY both_sides ON "PartnershipTerm"
  USING (
    "triggerTenantId" = current_setting('app.tenant_id', true)
    OR "rewardTenantId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    "triggerTenantId" = current_setting('app.tenant_id', true)
    OR "rewardTenantId" = current_setting('app.tenant_id', true)
  );

-- Сообщение видят отправитель и получатель.
CREATE POLICY both_sides ON "PartnershipMessage"
  USING (
    "fromTenantId" = current_setting('app.tenant_id', true)
    OR "toTenantId" = current_setting('app.tenant_id', true)
  )
  WITH CHECK ("fromTenantId" = current_setting('app.tenant_id', true));

-- Своя квота — обычная односторонняя политика.
CREATE POLICY tenant_isolation ON "InviteQuota"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Блокировку видит и снимает только тот, кто её поставил.
CREATE POLICY blocker_only ON "InviteBlock"
  USING ("blockerTenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("blockerTenantId" = current_setting('app.tenant_id', true));

-- Прайс общий: его обязано видеть каждое заведение.
CREATE POLICY pricing_is_public ON "PartnershipPricing"
  FOR SELECT USING (true);

-- Платформа читает всё, что ей выдано.
CREATE POLICY platform_reads_all ON "Partnership"
  FOR SELECT TO positive_platform USING (true);
CREATE POLICY platform_reads_all ON "PartnershipTerm"
  FOR SELECT TO positive_platform USING (true);
CREATE POLICY platform_reads_all ON "InviteQuota"
  FOR SELECT TO positive_platform USING (true);
CREATE POLICY platform_reads_all ON "InviteBlock"
  FOR SELECT TO positive_platform USING (true);
CREATE POLICY platform_manages_pricing ON "PartnershipPricing"
  TO positive_platform USING (true) WITH CHECK (true);

COMMENT ON TABLE "Partnership" IS
  'Связь двух заведений. Единственная таблица с двусторонней политикой RLS.';
COMMENT ON TABLE "InviteBlock" IS
  'Блокировку видит только заблокировавший: знание о ней помогает её обойти.';
