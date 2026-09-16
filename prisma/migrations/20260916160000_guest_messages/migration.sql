-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916160000_guest_messages
--
-- Жалобы и предложения: обращение гостя не по визиту. docs/02, разделы 2.10 и 5.15.
--
-- ОТДЕЛЬНО ОТ Review. Отзыв привязан к чеку (UNIQUE на ledgerEntryId) и оценивает визит.
-- Жалоба на сломанный кондиционер к чеку не относится, а гость может написать и в день,
-- когда ничего не покупал. Втискивать её в Review значило бы завести отзыв без чека
-- и без оценки — и сломать оба отчёта, которые на них стоят.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "GuestMessageKind" AS ENUM ('COMPLAINT', 'SUGGESTION');

-- CreateTable
CREATE TABLE "GuestMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "kind" "GuestMessageKind" NOT NULL,
    "text" TEXT NOT NULL,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestMessage_tenantId_createdAt_idx" ON "GuestMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "GuestMessage_guestId_createdAt_idx" ON "GuestMessage"("guestId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся: обращение не стирают — на него отвечают.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "GuestMessage" ENABLE ROW LEVEL SECURITY;

-- Заведение читает свои обращения и пишет в них ответ.
CREATE POLICY tenant_isolation ON "GuestMessage"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость видит только свои обращения — вместе с ответом заведения.
CREATE POLICY guest_messages_select ON "GuestMessage"
  FOR SELECT
  USING ("guestId" = current_setting('app.guest_id', true));

-- Гость пишет только за себя и только заведению, где у него есть участие: писать
-- незнакомому заведению нельзя, иначе обращения станут каналом рассылки для кого угодно.
-- Ответ гость проставить не может: reply и repliedAt обязаны быть пустыми.
CREATE POLICY guest_messages_insert ON "GuestMessage"
  FOR INSERT
  WITH CHECK (
    "guestId" = current_setting('app.guest_id', true)
    AND "reply" IS NULL
    AND "repliedAt" IS NULL
    AND "repliedBy" IS NULL
    AND EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "GuestMessage"."tenantId"
        AND m."guestId" = current_setting('app.guest_id', true)
    )
  );
