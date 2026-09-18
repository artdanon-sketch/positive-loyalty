-- Каталог товаров и услуг: витрина, а не склад.
--
-- Остатков, штрихкодов и поставщиков здесь нет — за это отвечает касса.
-- Нам нужно ровно одно: показать гостю, что у заведения есть и что из этого
-- можно взять за баллы.

CREATE TABLE "CatalogItem" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  -- Цена деньгами в минорных единицах. NULL — цену не показываем.
  "priceMinor"  INTEGER,
  -- Цена в баллах. NULL — за баллы не отдаём, позиция просто в витрине.
  "pointsPrice" INTEGER,
  "imageUrl"    TEXT,
  -- Выключенная позиция остаётся у владельца и исчезает у гостя: удаления нет,
  -- иначе из отчёта пропадает то, что когда-то продавали.
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CatalogItem_tenantId_sortOrder_idx" ON "CatalogItem"("tenantId", "sortOrder");
CREATE INDEX "CatalogItem_tenantId_isActive_idx" ON "CatalogItem"("tenantId", "isActive");

ALTER TABLE "CatalogItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogItem" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "CatalogItem"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость видит включённые позиции заведений, где он участвует: витрина
-- открывается вместе с картой, а не по чужой ссылке.
CREATE POLICY guest_catalog ON "CatalogItem"
  FOR SELECT
  USING (
    "isActive"
    AND EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "CatalogItem"."tenantId"
        AND m."guestId" = current_setting('app.guest_id', true)
    )
  );
