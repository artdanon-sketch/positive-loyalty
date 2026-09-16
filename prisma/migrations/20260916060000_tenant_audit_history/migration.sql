-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916060000_tenant_audit_history
--
-- История действий своего заведения для экрана «Безопасность». docs/11, У12 ·
-- docs/02, раздел 5.13 · docs/05, раздел 9.
--
-- ПОЧЕМУ ФУНКЦИЯ. У роли приложения на AuditLog только INSERT (миграция
-- 20260909100000): тот, кто пишет в аудит, не должен уметь его выгрузить. Владельцу
-- заведения нужна своя история — поэтому чтение идёт через SECURITY DEFINER, которая
-- отдаёт ровно одно: события объявленного заведения, без значений «было / стало».
--
-- ЗАВЕДЕНИЕ — ИЗ app.tenant_id, А НЕ ПАРАМЕТРОМ. Параметр можно подставить по ошибке;
-- объявленное заведение выставляет forTenant из токена. Без него — пусто.
--
-- ВРЕМЯ ОТДАЁТСЯ СТРОКОЙ ISO в UTC: колонка без зоны, и драйвер иначе прочитал бы её
-- в часовом поясе процесса.
--
-- Схема — текущая, как у остальных функций (миграция 20260828100000). Схема базы
-- не меняется: миграция только добавляет функцию.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE FUNCTION %I.tenant_audit_history(p_before timestamptz, p_limit int)
    RETURNS TABLE (
      id text,
      "occurredAt" text,
      action text,
      "actorType" text,
      "actorId" text,
      "entityType" text,
      "entityId" text,
      reason text
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT
        a.id,
        to_char(a."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        a.action,
        a."actorType"::text,
        a."actorId",
        a."entityType",
        a."entityId",
        a.reason
      FROM %I."AuditLog" a
      WHERE coalesce(current_setting('app.tenant_id', true), '') <> ''
        AND a."tenantId" = current_setting('app.tenant_id', true)
        AND a."occurredAt" < (p_before AT TIME ZONE 'UTC')
      ORDER BY a."occurredAt" DESC, a.id DESC
      LIMIT least(greatest(p_limit, 1), 100);
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.tenant_audit_history(timestamptz, int) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.tenant_audit_history(timestamptz, int) TO positive_app',
    target_schema
  );
END
$migration$;
