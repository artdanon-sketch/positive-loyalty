-- ─────────────────────────────────────────────────────────────────────────────
-- 20260909200000_offers
--
-- Акции и выданные по ним промокоды. docs/01, раздел 4.5.
--
-- ЗАЧЕМ ЭТО СЕЙЧАС. Партнёрства между заведениями (docs/07) по железному
-- правилу 6 обязаны быть надстройкой над акциями: PartnershipTerm при
-- активации порождает Offer, а выдача и погашение идут через тот же конвейер.
-- Без этих двух таблиц партнёрства пришлось бы делать параллельной системой
-- с собственными «партнёрскими кодами» — то, что ТЗ запрещает прямо.
--
-- Заодно это основная механика лояльности сама по себе: без акций у заведения
-- есть только баллы.
--
-- ─── ПОЧЕМУ У OfferGrant ЕСТЬ tenantId, КОТОРОГО НЕТ В НАБРОСКЕ ТЗ ──────────
--
-- Изоляция. Все политики RLS в этой базе сравнивают колонку таблицы с
-- current_setting('app.tenant_id'). Без своей колонки политику для промокодов
-- пришлось бы писать подзапросом к Offer — единственное исключение из общего
-- способа. Такие исключения и протекают: их не замечают при правке соседних
-- миграций.
--
-- К тому же docs/02 раздел 3.4 требует при погашении проверить, что «тенант
-- совпадает» — то есть промокод обязан знать своё заведение и без подзапроса.
--
-- ─── ПОЧЕМУ ЗНАЧЕНИЕ PARTNER ЗАВЕДЕНО СРАЗУ ─────────────────────────────────
--
-- Его добавляет docs/07 вместе с партнёрствами. Вводить значение перечисления
-- отдельной миграцией — лишний риск: ALTER TYPE ADD VALUE нельзя использовать
-- в той же транзакции, где его применяют, и это регулярный источник неприятных
-- сюрпризов на накате. Неиспользуемое значение не мешает никому.
--
-- ─── ПРАВА ──────────────────────────────────────────────────────────────────
--
-- positive_app  — полный набор: акции заводит и правит владелец заведения,
--                 промокоды выдаются и гасятся в его же контуре.
-- positive_platform — ТОЛЬКО ЧТЕНИЕ и только то, что не является личным:
--                 панель платформы показывает, у кого какие акции и сколько
--                 промокодов выдано, но менять чужие акции не может.
--
-- Отбирать лишнее у positive_app не нужно, а вот выдать платформе — нужно
-- явно: ALTER DEFAULT PRIVILEGES из 20260828100000 выдаёт права только
-- приложению, платформе по умолчанию не достаётся ничего. Это и правильно:
-- забытая таблица для роли, видящей всех, должна быть недоступна.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('CASHBACK', 'PROMO_ON_CHECK', 'FLASH_1DAY', 'TIME_WINDOW', 'STAMP_CARD', 'NETWORK_VOUCHER', 'REFERRAL', 'BIRTHDAY', 'WINBACK', 'PACKAGE', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('VENUE_ONLY', 'NETWORK', 'PARTNER');

-- CreateEnum
CREATE TYPE "GrantState" AS ENUM ('ISSUED', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "audience" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "reward" JSONB NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'VENUE_ONLY',
    "i18n" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferGrant" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "state" "GrantState" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedBy" TEXT,
    "nonce" TEXT NOT NULL,

    CONSTRAINT "OfferGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_tenantId_status_idx" ON "Offer"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OfferGrant_code_key" ON "OfferGrant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OfferGrant_nonce_key" ON "OfferGrant"("nonce");

-- CreateIndex
CREATE INDEX "OfferGrant_guestId_state_idx" ON "OfferGrant"("guestId", "state");

-- CreateIndex
CREATE INDEX "OfferGrant_offerId_state_idx" ON "OfferGrant"("offerId", "state");

-- CreateIndex
CREATE INDEX "OfferGrant_tenantId_state_idx" ON "OfferGrant"("tenantId", "state");

-- CreateIndex
CREATE INDEX "OfferGrant_expiresAt_idx" ON "OfferGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OfferGrant" ADD CONSTRAINT "OfferGrant_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OfferGrant" ADD CONSTRAINT "OfferGrant_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OfferGrant" ADD CONSTRAINT "OfferGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ── Права ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON TABLE "Offer" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "OfferGrant" TO positive_app;

-- Платформе — только чтение. Промокод гость показывает на кассе; его код
-- панели не нужен, но колонку исключать не станем: она не является личными
-- данными, а поколоночные права здесь только запутали бы.
GRANT SELECT ON TABLE "Offer" TO positive_platform;
GRANT SELECT ON TABLE "OfferGrant" TO positive_platform;

-- DELETE не выдан никому. Акция не удаляется, а переводится в ENDED;
-- промокод не удаляется, а гасится или помечается VOID. По таблицам,
-- из которых можно стереть строку, нельзя разобрать спор с гостем.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OfferGrant" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Offer"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "OfferGrant"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость видит СВОИ промокоды — тем же способом, что и свои участия и журнал
-- (миграция 20260826230000): по объявленному app.guest_id, без тенанта.
-- Иначе гостевое приложение не смогло бы показать человеку его же купон.
CREATE POLICY guest_grants ON "OfferGrant"
  FOR SELECT USING ("guestId" = current_setting('app.guest_id', true));

-- Гость видит акцию, по которой ему выдан промокод: без этого в приложении
-- вместо названия «Филадельфия в подарок» был бы голый код.
CREATE POLICY guest_offers ON "Offer"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "OfferGrant" g
      WHERE g."offerId" = "Offer"."id"
        AND g."guestId" = current_setting('app.guest_id', true)
    )
  );

-- Платформа читает всё: ради этого роль и заводилась (миграция 20260909140000).
CREATE POLICY platform_reads_all ON "Offer"
  FOR SELECT TO positive_platform USING (true);

CREATE POLICY platform_reads_all ON "OfferGrant"
  FOR SELECT TO positive_platform USING (true);

COMMENT ON TABLE "Offer" IS
  'Акция заведения. Партнёрства порождают такие же акции с visibility PARTNER.';
COMMENT ON TABLE "OfferGrant" IS
  'Выданный гостю промокод. Гасится атомарно: UPDATE ... WHERE state = ISSUED.';
