-- ─────────────────────────────────────────────────────────────────────────────
-- 20260917080000_broadcasts
--
-- Рассылки заведения. docs/02, раздел 5.4 · docs/03, раздел 5.
--
-- АУДИТОРИЯ ФИКСИРУЕТСЯ СПИСКОМ ПОЛУЧАТЕЛЕЙ в момент создания. Пересчитывать её
-- на отправке значило бы, что «нашли 759» и «ушло 743» расходятся без объяснения:
-- гость мог за минуту сменить статус или перестать спать. Снимок честнее.
--
-- ПРОПУСКИ ХРАНЯТСЯ НАРАВНЕ С ОТПРАВЛЕННЫМ. «Устал» (четыре сообщения за месяц)
-- и «некуда слать» (нет Telegram) — разные вещи, и владельцу нужно знать, какая
-- именно съела половину аудитории. По этой же таблице считается сама усталость.
--
-- Новые таблицы: старый код о них не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BroadcastDelivery" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_FATIGUE', 'SKIPPED_NO_CHANNEL');

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "delivery" "BroadcastDelivery" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_tenantId_createdAt_idx" ON "Broadcast"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Broadcast_status_sendAt_idx" ON "Broadcast"("status", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_guestId_key" ON "BroadcastRecipient"("broadcastId", "guestId");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_tenantId_guestId_sentAt_idx" ON "BroadcastRecipient"("tenantId", "guestId", "sentAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_delivery_idx" ON "BroadcastRecipient"("broadcastId", "delivery");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся: отправленное не стирают — иначе исчезнет
-- и след усталости, по которому считается «не больше четырёх в месяц».

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "Broadcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BroadcastRecipient" ENABLE ROW LEVEL SECURITY;

-- Только заведение и только своё. Гостю в этих таблицах делать нечего:
-- он видит сообщение в Telegram, а не строку в журнале рассылки.
CREATE POLICY tenant_isolation ON "Broadcast"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "BroadcastRecipient"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
