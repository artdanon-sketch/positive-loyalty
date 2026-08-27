-- ─────────────────────────────────────────────────────────────────────────────
-- Интеграция с POSitive POS: связь заведений и приём вебхуков.
-- docs/01, раздел 3 · docs/02, раздел 4
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "PosLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "posMerchantId" TEXT NOT NULL,
    "posLocationId" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PosLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosLink_posMerchantId_key" ON "PosLink"("posMerchantId");

-- CreateIndex
CREATE INDEX "PosLink_tenantId_idx" ON "PosLink"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookEvent_tenantId_receivedAt_idx" ON "WebhookEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_tenantId_externalId_key" ON "WebhookEvent"("tenantId", "externalId");

-- AddForeignKey
ALTER TABLE "PosLink" ADD CONSTRAINT "PosLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Изоляция: обе таблицы тенантные, политики те же, что у остального.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON TABLE "PosLink" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "WebhookEvent" TO positive_app;

ALTER TABLE "PosLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "PosLink"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "WebhookEvent"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- Разрешение кассового заведения в наше — до всякой авторизации.
--
-- ЗАДАЧА ТА ЖЕ, ЧТО У УСТРОЙСТВ КАССЫ. Вебхук приходит без токена: подписан он
-- ключом, который лежит в PosLink, а прочитать PosLink под ролью приложения
-- нельзя — политика требует объявленного `app.tenant_id`, а он и есть то, что
-- мы пытаемся узнать. Курица и яйцо.
--
-- Принимать tenantId телом запроса нельзя (железное правило 2), ходить
-- владельцем базы — значит ради одной строки открыть всё.
--
-- ФУНКЦИЯ ОТДАЁТ ДВА ЗНАЧЕНИЯ, И ОДНО ИЗ НИХ СЕКРЕТ. Это осознанно и это
-- граница: подпись невозможно проверить, не зная ключа, а ключ невозможно
-- прочитать до того, как известен тенант. Возвращать что-либо ещё отсюда
-- нельзя — ни настройки, ни состав заведения. Знание `posMerchantId` само
-- по себе секретом не является, поэтому ключ отдаётся только по точному
-- совпадению и только для действующей связи.
--
-- search_path пустой: иначе владелец схемы, подсунувший свою таблицу с именем
-- PosLink, выполнил бы свой код с правами владельца базы.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pos_link_for_merchant(p_merchant_id text)
RETURNS TABLE ("tenantId" text, "webhookSecret" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l."tenantId", l."webhookSecret"
  FROM public."PosLink" l
  WHERE l."posMerchantId" = p_merchant_id
    AND l."isActive"
    AND l."revokedAt" IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.pos_link_for_merchant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_link_for_merchant(text) TO positive_app;

COMMENT ON FUNCTION public.pos_link_for_merchant(text) IS
  'Разрешает posMerchantId в tenantId и ключ подписи до аутентификации. '
  'SECURITY DEFINER: обходит RLS намеренно. Расширять возвращаемое значение '
  'нельзя — это граница изоляции.';
