-- ─────────────────────────────────────────────────────────────────────────────
-- Предрасчёт кассы. docs/02, раздел 3.2.
--
-- Хранится в Postgres, а не в Redis: предрасчёт это финансовое намерение,
-- по нему через минуту спишут баллы. Потеря записи при перезапуске кеша
-- означала бы «касса подтвердила, а система забыла, что обещала».
--
-- RLS для новой таблицы включается ЗДЕСЬ ЖЕ. Автоматически он не появляется:
-- политики назначаются поимённо, а diff Prisma про них не знает. Без этого
-- блока роль приложения читала бы предрасчёты всех заведений — то есть суммы
-- чужих чеков и балансы чужих гостей.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateTable
CREATE TABLE "TransactionPreview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "redeemRequested" INTEGER NOT NULL DEFAULT 0,
    "redeem" INTEGER NOT NULL,
    "pointsToEarn" INTEGER NOT NULL,
    "amountToPay" INTEGER NOT NULL,
    "balanceAtPreview" INTEGER NOT NULL,
    "receiptNumber" TEXT,
    "locationId" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "TransactionPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionPreview_tenantId_expiresAt_idx" ON "TransactionPreview"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "TransactionPreview_membershipId_createdAt_idx" ON "TransactionPreview"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "TransactionPreview" ADD CONSTRAINT "TransactionPreview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TransactionPreview" ADD CONSTRAINT "TransactionPreview_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


GRANT SELECT, INSERT, UPDATE ON TABLE "TransactionPreview" TO positive_app;

ALTER TABLE "TransactionPreview" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "TransactionPreview"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
