-- ─────────────────────────────────────────────────────────────────────────────
-- 20260917160000_automation_rules
--
-- Автоматические сценарии рассылок. docs/02, раздел 5.4.1 · docs/03, раздел 5.
--
-- СЦЕНАРИЙ НЕ ШЛЁТ САМ, А СОЗДАЁТ РАССЫЛКУ. Второй способ отправлять сообщения
-- гостю означал бы, что ограничение «не больше четырёх в месяц» считается только
-- по одному из них — и гость получает восемь.
--
-- ОДИН СЦЕНАРИЙ КАЖДОГО ВИДА НА ЗАВЕДЕНИЕ (UNIQUE): два «давно не заходил»
-- с разными порогами — это два письма одному человеку в один день.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "AutomationKind" AS ENUM ('SLEEPING', 'JOINED_NO_PURCHASE', 'SPENT_TOTAL');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AutomationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_tenantId_kind_key" ON "AutomationRule"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "AutomationRule_enabled_lastRunAt_idx" ON "AutomationRule"("enabled", "lastRunAt");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся: сценарий выключают, а не стирают —
-- иначе из истории пропадёт, почему гостю пришло письмо.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "AutomationRule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "AutomationRule"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
