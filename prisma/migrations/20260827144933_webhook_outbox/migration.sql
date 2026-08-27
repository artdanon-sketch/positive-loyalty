-- ─────────────────────────────────────────────────────────────────────────────
-- Исходящие события к кассе. docs/02, раздел 4.3.
--
-- Таблица — исходящий журнал (outbox). Строка пишется в ТОЙ ЖЕ транзакции,
-- что и операция журнала баллов: иначе между коммитом и отправкой процесс
-- может умереть, и касса навсегда останется с устаревшим балансом.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "PosLink" ADD COLUMN     "callbackUrl" TEXT;

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_createdAt_idx" ON "WebhookDelivery"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

GRANT SELECT, INSERT, UPDATE ON TABLE "WebhookDelivery" TO positive_app;

ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "WebhookDelivery"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- Что пора отправить — через границу заведений.
--
-- Разгребатель очереди работает ВНЕ контекста заведения: он не знает заранее,
-- чьи события ждут отправки, и обойти для этого все заведения по очереди
-- значит опрашивать базу тем чаще, чем больше клиентов. Политика RLS такой
-- запрос не пропустит — `app.tenant_id` не объявлен, и это правильно.
--
-- Функция отдаёт РОВНО ТО, что нужно отправителю, и ничего больше: тело
-- события, адрес и счётчик попыток. Ни баланса, ни гостя, ни настроек
-- заведения через неё не видно. Дальше отправитель работает уже внутри
-- конкретного заведения — обновление статуса идёт обычным путём под RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.webhook_deliveries_due(p_limit int)
RETURNS TABLE (
  id text,
  "tenantId" text,
  "eventType" text,
  payload jsonb,
  "targetUrl" text,
  attempts int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.id, d."tenantId", d."eventType", d.payload, d."targetUrl", d.attempts
  FROM public."WebhookDelivery" d
  WHERE d.status = 'PENDING'
    AND d."nextAttemptAt" <= now()
  ORDER BY d."nextAttemptAt"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.webhook_deliveries_due(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webhook_deliveries_due(int) TO positive_app;

COMMENT ON FUNCTION public.webhook_deliveries_due(int) IS
  'Отдаёт исходящие события, которым пора уходить, поверх границы заведений. '
  'SECURITY DEFINER: обходит RLS намеренно. Расширять возвращаемое значение '
  'нельзя — это граница изоляции.';
