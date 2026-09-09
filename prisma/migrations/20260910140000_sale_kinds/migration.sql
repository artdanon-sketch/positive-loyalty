-- ─────────────────────────────────────────────────────────────────────────────
-- 20260910140000_sale_kinds
--
-- Вид продажи: что именно заведение продало гостю.
--
-- ЗАЧЕМ. Партнёрство «купил абонемент — получи ролл в подарок» невозможно
-- построить на одной сумме: ужин на 5 000 ฿ и абонемент на 5 000 ฿ для журнала
-- неотличимы, и ресторан-донор раздавал бы подарки за крупные счета, которых
-- не ждал. Это головной пример docs/07, и до сих пор он не работал.
--
-- СПИСОК ВЕДЁТ САМО ЗАВЕДЕНИЕ. У студии танцев это «абонемент на 10 занятий»
-- и «разовое занятие», у проката — «сутки» и «неделя». Общий справочник
-- на всех означал бы, что каждый новый вид бизнеса ждёт нашего релиза.
--
-- НЕ ЗАВИСИТ ОТ КАССЫ. Вид выбирает кассир, когда проводит начисление в нашем
-- приложении (source = STAFF_MANUAL, он уже есть). Партнёру не нужен
-- POSitive POS: у него своя касса для денег, наше приложение — для лояльности.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "SaleKind" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleKind_pkey" PRIMARY KEY ("id")
);

-- Два одинаковых названия в одном заведении — верный способ выбрать не то.
CREATE UNIQUE INDEX "SaleKind_tenantId_name_key" ON "SaleKind"("tenantId", "name");

CREATE INDEX "SaleKind_tenantId_isActive_sortOrder_idx"
  ON "SaleKind"("tenantId", "isActive", "sortOrder");

ALTER TABLE "SaleKind"
  ADD CONSTRAINT "SaleKind_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Колонка в журнале.
--
-- NULLABLE И БЕЗ ЗАПОЛНЕНИЯ СТАРЫХ СТРОК — так требует CLAUDE.md: сначала
-- добавляем nullable, деплоим, и только потом, если понадобится, ужесточаем.
-- Здесь не понадобится никогда: список видов ведут не все заведения, и NULL
-- у операции означает ровно то, что должен, — «не сказано».
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ КОЛОНКА, А НЕ refType. refType отвечает на вопрос «чем эта
-- запись вызвана» (чек, промокод, реферал) и участвует в отмене чека и в трёх
-- отчётах по выручке. Записать туда «package» значило бы: отмена такой продажи
-- перестала бы находить свои строки, а выручка — считать эту продажу выручкой.
-- Тихо и в самом неудобном месте.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "LedgerEntry" ADD COLUMN "saleKindId" TEXT;

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_saleKindId_fkey"
  FOREIGN KEY ("saleKindId") REFERENCES "SaleKind"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Под выборку партнёрских триггеров: она ищет операции по виду продажи.
CREATE INDEX "LedgerEntry_saleKindId_idx" ON "LedgerEntry"("saleKindId");

COMMENT ON COLUMN "LedgerEntry"."saleKindId" IS
  'Что именно продали, если заведение ведёт список видов. NULL — не сказано. '
  'Не путать с refType: тот отвечает, чем запись вызвана.';

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению
-- SELECT, INSERT и UPDATE. Здесь это ровно то, что нужно: заведение заводит
-- виды, переименовывает и выключает их само.
--
-- DELETE не выдан никому и не будет: вид продажи, на который ссылается журнал,
-- исчезнуть не может — иначе по журналу нельзя разобрать ни отчёт, ни спор.
-- Ненужное выключается через isActive.

GRANT SELECT, INSERT, UPDATE ON TABLE "SaleKind" TO positive_app;

-- Платформе — чтение: в панели видно, чем торгуют заведения и на чём строятся
-- партнёрства. Личных данных здесь нет.
GRANT SELECT ON TABLE "SaleKind" TO positive_platform;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "SaleKind" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "SaleKind"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- ПАРТНЁР ВИДИТ НАЗВАНИЯ ВИДОВ ТОЙ СТОРОНЫ, С КОТОРОЙ ДОГОВОРИЛСЯ.
--
-- Без этого ресторан, соглашаясь на условие «за абонемент — ролл в подарок»,
-- видел бы вместо «абонемента» голый идентификатор и соглашался вслепую.
--
-- Только SELECT и только при ДЕЙСТВУЮЩЕМ партнёрстве: чужие виды продаж — это
-- сведения о том, чем торгует конкурент, и раздавать их всем подряд нельзя.
-- Форма проверки та же, что у двусторонней видимости самого партнёрства
-- (миграция 20260909210000): строку видят обе стороны, посторонний не видит.
CREATE POLICY partner_reads ON "SaleKind"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "Partnership" p
      WHERE p.status = 'ACTIVE'
        AND (
          (p."initiatorTenantId" = "SaleKind"."tenantId"
             AND p."partnerTenantId" = current_setting('app.tenant_id', true))
          OR
          (p."partnerTenantId" = "SaleKind"."tenantId"
             AND p."initiatorTenantId" = current_setting('app.tenant_id', true))
        )
    )
  );

CREATE POLICY platform_reads_all ON "SaleKind"
  FOR SELECT TO positive_platform USING (true);

COMMENT ON TABLE "SaleKind" IS
  'Вид продажи заведения: абонемент, разовое занятие, товар. Ведёт заведение, '
  'выбирает кассир, ссылаются партнёрские условия.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Выборка партнёрских триггеров теперь отдаёт и вид продажи.
--
-- DROP, а не CREATE OR REPLACE: у функции меняется набор возвращаемых колонок,
-- а замена с другим типом результата в Postgres запрещена. Функция наша,
-- заведена соседней миграцией в этой же схеме — чужого здесь снести нечем.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format(
    'DROP FUNCTION IF EXISTS %I.ledger_entries_awaiting_partnership(int, timestamptz)',
    target_schema
  );

  EXECUTE format($fmt$
    CREATE FUNCTION %I.ledger_entries_awaiting_partnership(
      p_limit int,
      p_now timestamptz
    )
    RETURNS TABLE (
      id text,
      "tenantId" text,
      "guestId" text,
      "refType" text,
      "saleKindId" text,
      "basisAmount" int,
      "visitsTotal" int,
      "membershipCreated" boolean,
      "occurredAt" timestamp(3),
      "createdAt" timestamp(3)
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT
        l.id,
        l."tenantId",
        l."guestId",
        l."refType",
        l."saleKindId",
        l."basisAmount",
        (
          SELECT count(*)::int
          FROM %I."LedgerEntry" v
          WHERE v."membershipId" = l."membershipId"
            AND v.type = 'EARN'
            AND v."refType" = 'receipt'
            AND (v."createdAt", v.id) <= (l."createdAt", l.id)
        ) AS "visitsTotal",
        NOT EXISTS (
          SELECT 1
          FROM %I."LedgerEntry" f
          WHERE f."membershipId" = l."membershipId"
            AND (f."createdAt", f.id) < (l."createdAt", l.id)
        ) AS "membershipCreated",
        l."occurredAt",
        l."createdAt"
      FROM %I."LedgerEntry" l
      JOIN (
        SELECT DISTINCT t."triggerTenantId"
        FROM %I."PartnershipTerm" t
        WHERE t.status = 'ACTIVE'
          AND t."offerId" IS NOT NULL
      ) src ON src."triggerTenantId" = l."tenantId"
      LEFT JOIN %I."PartnershipTriggerRun" r ON r."ledgerEntryId" = l.id
      WHERE r.id IS NULL
        AND l.type = 'EARN'
        AND (l."createdAt" AT TIME ZONE 'UTC') > p_now - interval '1 day'
      ORDER BY l."createdAt"
      LIMIT p_limit;
    $body$
  $fmt$, target_schema, target_schema, target_schema, target_schema,
        target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.ledger_entries_awaiting_partnership(int, timestamptz) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.ledger_entries_awaiting_partnership(int, timestamptz) TO positive_app',
    target_schema
  );
END
$migration$;
