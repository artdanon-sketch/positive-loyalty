-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916140000_news_views
--
-- Просмотры новостей: сколько гостей увидело новость. docs/02, разделы 2.9 и 5.14.
--
-- ПРОСМОТР — ГОСТЬ, А НЕ ПОКАЗ. UNIQUE на пару «новость + гость»: гость, открывший
-- карту пять раз за день, не должен превращаться в пять просмотров. Владелец смотрит
-- на это число, чтобы понять, дошла ли новость, — накрутка показами обманула бы его.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "NewsView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsView_newsId_guestId_key" ON "NewsView"("newsId", "guestId");

-- CreateIndex
CREATE INDEX "NewsView_tenantId_seenAt_idx" ON "NewsView"("tenantId", "seenAt");

-- AddForeignKey
ALTER TABLE "NewsView" ADD CONSTRAINT "NewsView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "NewsView" ADD CONSTRAINT "NewsView_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "NewsView" ADD CONSTRAINT "NewsView_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. Просмотр не редактируется и не удаляется — это отметка о факте.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "NewsView" ENABLE ROW LEVEL SECURITY;

-- Заведение считает просмотры своих новостей.
CREATE POLICY tenant_isolation ON "NewsView"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость отмечает просмотр только за себя и только на новости, которую ему видно:
-- вложенный SELECT по "News" сам идёт под гостевой политикой `guest_news`, поэтому
-- чужая или неопубликованная новость сюда не пройдёт.
CREATE POLICY guest_news_views_insert ON "NewsView"
  FOR INSERT
  WITH CHECK (
    "guestId" = current_setting('app.guest_id', true)
    AND EXISTS (
      SELECT 1 FROM "News" n
      WHERE n.id = "NewsView"."newsId"
        AND n."tenantId" = "NewsView"."tenantId"
    )
  );

-- Гость видит свои отметки: без SELECT вставка с ON CONFLICT DO NOTHING не смогла бы
-- отличить «уже отмечено» от «не разрешено».
CREATE POLICY guest_news_views_select ON "NewsView"
  FOR SELECT
  USING ("guestId" = current_setting('app.guest_id', true));
