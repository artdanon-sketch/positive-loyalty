-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916020000_acquisition_channels
--
-- Источники трафика. docs/11, У7 · docs/02, разделы 2.6 и 5.9.
--
-- AcquisitionChannel — именованная ссылка заведения со своим кодом: табличка на столе,
-- Instagram. Membership.channelId — по ссылке какого источника гость вступил.
-- Membership.createdAt — когда гость стал гостем заведения: без даты не посчитать,
-- сколько гостей источник привёл за период. У строк, заведённых до миграции, дата —
-- момент миграции: честнее даты нет, а в отчёт по источникам такие гости попадают
-- строкой «без источника», где точный день вступления не решает ничего.
--
-- Новая таблица и колонки со значением по умолчанию: старый код о них не знает,
-- миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AcquisitionChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcquisitionChannel_tenantId_isActive_idx" ON "AcquisitionChannel"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionChannel_tenantId_code_key" ON "AcquisitionChannel"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Membership_tenantId_channelId_idx" ON "Membership"("tenantId", "channelId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "AcquisitionChannel"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AcquisitionChannel" ADD CONSTRAINT "AcquisitionChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся намеренно: источник не удаляют, а выключают —
-- на него ссылаются гости, пришедшие по нему.

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Только своё заведение. Гостевого контура нет: вступление по ссылке идёт тенантным
-- контуром (identity/guest-join.service.ts), а гостю сам справочник не нужен.

ALTER TABLE "AcquisitionChannel" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "AcquisitionChannel"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
