-- ─────────────────────────────────────────────────────────────────────────────
-- 20260915120000_pos_queue_items
--
-- Застрявшие чеки у владельца. docs/10, разделы 5.7 и 6.10.
--
-- ЗАЧЕМ. Очередь отложенных чеков живёт на планшете кассы, и владелец о ней
-- не знает. Чек, который не доходит второй час, — это гость без баллов, и узнать
-- об этом владелец должен не от гостя.
--
-- ЭТО СНИМОК, А НЕ ВТОРАЯ ОЧЕРЕДЬ. Планшет присылает, что у него лежит, и сервер
-- по этим строкам ничего не проводит. Проведёт планшет — тем же ключом
-- идемпотентности, когда появится связь. Две очереди с правом проводить
-- однажды провели бы один чек дважды.
--
-- ПОЛНОГО ТЕЛЕФОНА ЗДЕСЬ НЕТ. Если гостя искали по номеру, хранится маска:
-- владельцу хватит «+66 •• •• 4821», чтобы узнать гостя.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "PosQueueItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "staffId" TEXT,
    "receiptId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "receiptNumber" TEXT,
    "membershipId" TEXT,
    "guestHint" TEXT,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "PosQueueItem_pkey" PRIMARY KEY ("id")
);

-- Один чек — одна строка в заведении: снимки разных попыток её обновляют.
CREATE UNIQUE INDEX "PosQueueItem_tenantId_receiptId_key"
  ON "PosQueueItem"("tenantId", "receiptId");

-- Под список владельца: неснятые, по времени постановки.
CREATE INDEX "PosQueueItem_tenantId_clearedAt_queuedAt_idx"
  ON "PosQueueItem"("tenantId", "clearedAt", "queuedAt");

-- Под снимок планшета: снять всё, чего в новом снимке уже нет.
CREATE INDEX "PosQueueItem_tenantId_terminalId_idx"
  ON "PosQueueItem"("tenantId", "terminalId");

ALTER TABLE "PosQueueItem"
  ADD CONSTRAINT "PosQueueItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- SELECT, INSERT и UPDATE приезжают сами (ALTER DEFAULT PRIVILEGES, миграция
-- 20260828100000) и здесь ровно нужны: планшет заводит и обновляет строки,
-- владелец читает. DELETE не выдан: ушедший чек помечается clearedAt, а не
-- исчезает — по снимкам разбирают, сколько гость ждал баллов.

GRANT SELECT, INSERT, UPDATE ON TABLE "PosQueueItem" TO positive_app;
GRANT SELECT ON TABLE "PosQueueItem" TO positive_platform;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "PosQueueItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "PosQueueItem"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY platform_reads_all ON "PosQueueItem"
  FOR SELECT TO positive_platform USING (true);

COMMENT ON TABLE "PosQueueItem" IS
  'Снимок очереди отложенных чеков планшета кассы. Сервер по нему ничего не проводит: '
  'проведёт планшет тем же ключом, когда появится связь. Полного телефона нет — маска.';
