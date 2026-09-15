-- ─────────────────────────────────────────────────────────────────────────────
-- 20260915220000_guest_tags
--
-- Теги гостей. docs/11, У5 · docs/02, раздел 5.2.5.
--
-- Tag — пометка заведения для себя: «VIP», «аллергия», «блогер». GuestTag — тег
-- на госте; tenantId в нём отдельной колонкой, как у OfferGrant: политика RLS
-- сравнивает колонку напрямую. Удалили тег — он сходит со всех гостей (каскад).
--
-- Новые таблицы: старый код о них не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "TagColor" AS ENUM ('slate', 'mint', 'sky', 'amber', 'rose', 'violet');

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'slate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestTag" (
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestTag_pkey" PRIMARY KEY ("membershipId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_name_key" ON "Tag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "GuestTag_tenantId_tagId_idx" ON "GuestTag"("tenantId", "tagId");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GuestTag" ADD CONSTRAINT "GuestTag_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GuestTag" ADD CONSTRAINT "GuestTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE — явно: тег удаляют, а с гостя его снимают. В отличие
-- от видов продаж, на теги не ссылается журнал, и удалять их безопасно.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Tag" TO positive_app;
GRANT SELECT, INSERT, DELETE ON TABLE "GuestTag" TO positive_app;

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Только своё заведение. Гостевого контура и чтения платформой нет: теги —
-- пометки заведения для себя, гость их не видит, панели платформы они не нужны.

ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestTag" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Tag"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "GuestTag"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
