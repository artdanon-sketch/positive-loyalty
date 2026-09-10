-- ─────────────────────────────────────────────────────────────────────────────
-- 20260910120000_partnership_trigger_runs
--
-- Долговечная доставка партнёрских триггеров.
--
-- ЧЕГО НЕ ХВАТАЛО. Слушатель триггеров умеет превратить событие в промокод,
-- но его надо кто-то позвать. Зов из кассового пути дал бы простую и неверную
-- гарантию: между записью в журнал и выдачей награды процесс может умереть,
-- и подарок потеряется молча — узнать о нём будет неоткуда, потому что нигде
-- не записано, что он был должен.
--
-- ОТКУДА РЕШЕНИЕ. Ровно эта задача уже решена в репозитории для исходящих
-- событий к кассе (миграция 20260827150000): СОБЫТИЕ ВЫВОДИТСЯ ИЗ ЖУРНАЛА,
-- А НЕ ПИШЕТСЯ РЯДОМ С НИМ. Журнал append-only и долговечен; значит «операция
-- есть, а награда не выдана» — состояние, из которого всегда можно доехать:
-- следующий проход разгребателя его увидит.
--
-- Цена та же: награда приходит не мгновенно, а в ближайший проход. Для подарка
-- от соседнего заведения это приемлемо куда больше, чем для баланса на кассе.
--
-- ПОЧЕМУ ОТМЕТКА, А НЕ ВОДЯНОЙ ЗНАК. Соблазн хранить «разобрано до такого-то
-- момента» одной строкой велик, но операции приходят не строго по времени:
-- транзакция, начавшаяся раньше, может записаться позже. Знак проехал бы
-- мимо, и награда потерялась бы — тихо и невоспроизводимо. Отметка на каждую
-- операцию таких дыр не оставляет, а UNIQUE делает повторный проход
-- безопасным без единой блокировки.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "PartnershipTriggerRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "grantsIssued" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipTriggerRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnershipTriggerRun_ledgerEntryId_key"
  ON "PartnershipTriggerRun"("ledgerEntryId");

CREATE INDEX "PartnershipTriggerRun_tenantId_processedAt_idx"
  ON "PartnershipTriggerRun"("tenantId", "processedAt");

ALTER TABLE "PartnershipTriggerRun"
  ADD CONSTRAINT "PartnershipTriggerRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению
-- SELECT, INSERT и UPDATE на эту таблицу автоматически. UPDATE здесь лишний:
-- отметка ставится один раз и больше не меняется. Отбираем всё и выдаём
-- ровно нужное — правило то же, что и с прайсом партнёрств.

REVOKE ALL ON TABLE "PartnershipTriggerRun" FROM positive_app;
GRANT SELECT, INSERT ON TABLE "PartnershipTriggerRun" TO positive_app;

-- Панели платформы отметки нужны: по ним видно, разбираются ли события вообще,
-- или разгребатель встал. Без этого «партнёрство не работает» превращается
-- в гадание.
GRANT SELECT ON TABLE "PartnershipTriggerRun" TO positive_platform;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "PartnershipTriggerRun" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "PartnershipTriggerRun"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY platform_reads_all ON "PartnershipTriggerRun"
  FOR SELECT TO positive_platform USING (true);

COMMENT ON TABLE "PartnershipTriggerRun" IS
  'Отметка о разборе операции журнала на партнёрские условия. Ставится ПОСЛЕ '
  'выдачи наград: повторный разбор безвреден, потерянная награда — нет.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Операции, которые ещё не разобраны на партнёрские условия.
--
-- SECURITY DEFINER по той же причине, что и у соседних функций: разгребатель
-- обязан видеть операции ВСЕХ заведений, а роль приложения по политике видит
-- только объявленное. Пустой search_path — защита от подмены схемы.
--
-- ЧТО ОТДАЁТ, КРОМЕ КОЛОНОК ЖУРНАЛА. Двух вещей, нужных условиям, в журнале
-- нет как полей, и обе восстанавливаются из него же:
--
--   visitsTotal — каким по счёту стал этот визит. Считается по самому журналу:
--     начисления по чекам того же участия до этой записи включительно.
--     Сравнение идёт парой (createdAt, id), а не одним временем: две записи
--     в одну миллисекунду иначе дали бы обеим одинаковый номер.
--
--   membershipCreated — участие началось этим событием. Определяем как «раньше
--     у участия не было ни одной записи». Это не то же самое, что «строка
--     Membership создана сейчас», но ближе к смыслу условия: гость впервые
--     что-то сделал, а не впервые был заведён в базу.
--
-- ТОЛЬКО НАЧИСЛЕНИЯ. Списания и отмены наград не порождают: подарок за то,
-- что гость потратил баллы, — не то, о чём договариваются заведения.
--
-- ОКНО В СУТКИ — как у исходящих. Разгребатель, простоявший дольше суток,
-- пропущенное не догоняет: выдать вчерашний подарок гостю, который уже ушёл,
-- хуже, чем не выдать. Разбор такого простоя — работа человека, а не цикла.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.ledger_entries_awaiting_partnership(
      p_limit int,
      p_now timestamptz
    )
    RETURNS TABLE (
      id text,
      "tenantId" text,
      "guestId" text,
      "refType" text,
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
