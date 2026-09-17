-- ─────────────────────────────────────────────────────────────────────────────
-- 20260917140000_staff_rewards
--
-- Мотивация кассиров: награда за проведённый чек. docs/03, раздел 6 ·
-- docs/01, раздел 4.6 · docs/05, раздел 6.1.
--
-- ОТДЕЛЬНО ОТ ЖУРНАЛА БАЛЛОВ. Баллы гостя — обязательство перед гостем, награда
-- кассира — перед сотрудником. В одной таблице они однажды перепутались бы:
-- отмена чека гостя обязана снимать награду, а отмена награды не должна трогать
-- баллы. Разные жизненные циклы — разные таблицы.
--
-- UNIQUE НА ЧЕКЕ. Один чек — одна награда: повторный проход разгребателя или
-- двойная запись вебхука не должны платить дважды.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "StaffRewardState" AS ENUM ('PENDING', 'VESTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StaffReward" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "state" "StaffRewardState" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vestedAt" TIMESTAMP(3),

    CONSTRAINT "StaffReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffReward_ledgerEntryId_key" ON "StaffReward"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "StaffReward_tenantId_staffId_createdAt_idx" ON "StaffReward"("tenantId", "staffId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffReward_tenantId_state_membershipId_idx" ON "StaffReward"("tenantId", "state", "membershipId");

-- AddForeignKey
ALTER TABLE "StaffReward" ADD CONSTRAINT "StaffReward_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
--
-- Награда ссылается на сам чек: «заплатили за операцию, которой нет» не должно
-- существовать даже теоретически. Restrict с обеих сторон, как и весь журнал.
ALTER TABLE "StaffReward" ADD CONSTRAINT "StaffReward_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся: снятая награда остаётся в истории —
-- сотрудник имеет право видеть, за что ему не заплатили.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "StaffReward" ENABLE ROW LEVEL SECURITY;

-- Только своё заведение. Гостю здесь делать нечего: это расчёты с сотрудником.
CREATE POLICY tenant_isolation ON "StaffReward"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
