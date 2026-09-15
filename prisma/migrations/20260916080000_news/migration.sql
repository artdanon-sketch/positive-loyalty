-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916080000_news
--
-- Новости заведения для гостей. docs/11, У13 · docs/02, разделы 2.9 и 5.14.
--
-- News — заголовок, текст, опубликована ли и когда впервые. Не удаляется, а снимается
-- с публикации.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "News_tenantId_createdAt_idx" ON "News"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "News_tenantId_isPublished_publishedAt_idx" ON "News"("tenantId", "isPublished", "publishedAt");

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся намеренно: новость снимают с публикации.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "News" ENABLE ROW LEVEL SECURITY;

-- Заведение: пишет, правит и читает свои новости.
CREATE POLICY tenant_isolation ON "News"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость: только опубликованные новости заведений, где у него есть участие.
-- Писать и менять гостю не разрешает ни одна политика.
CREATE POLICY guest_news ON "News"
  FOR SELECT
  USING (
    "isPublished"
    AND EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "News"."tenantId"
        AND m."guestId" = current_setting('app.guest_id', true)
    )
  );
