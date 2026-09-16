-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916100000_tenant_audit_history_filters
--
-- Фильтры истории действий: день и сотрудник. docs/02, раздел 5.13 · docs/03, раздел 9.
--
-- ПОЧЕМУ НОВАЯ ФУНКЦИЯ, А НЕ ПРАВКА СТАРОЙ. Миграция едет на прод раньше кода: пока
-- выкладка не прошла, работающее приложение зовёт старую двухаргументную функцию.
-- Удали её сейчас — история упала бы на несколько минут. Поэтому рядом появляется
-- перегрузка на четыре аргумента, а двухаргументная снимается отдельной миграцией
-- после выкладки (правило репозитория: между удалением и кодом — хотя бы один деплой).
--
-- ДЕНЬ — ПО ЧАСАМ ЗАВЕДЕНИЯ. Владелец выбирает дату в календаре и ждёт свои сутки,
-- а не отрезок UTC. Зона берётся из Tenant той же функцией: параметром её можно
-- подставить по ошибке, а здесь она всегда та, что у объявленного заведения.
-- Отсюда двойной AT TIME ZONE: колонка без зоны хранит UTC (см. dashboard.service).
--
-- СОТРУДНИК — СОВПАДЕНИЕ actorId. Чужой идентификатор ничего не открывает: события
-- и так ограничены своим заведением.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE FUNCTION %I.tenant_audit_history(
      p_before timestamptz,
      p_limit int,
      p_actor_id text,
      p_day date
    )
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
      WITH venue AS (
        SELECT coalesce(t.timezone, 'UTC') AS zone
        FROM %I."Tenant" t
        WHERE coalesce(current_setting('app.tenant_id', true), '') <> ''
          AND t.id = current_setting('app.tenant_id', true)
      )
      SELECT
        a.id,
        to_char(a."occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        a.action,
        a."actorType"::text,
        a."actorId",
        a."entityType",
        a."entityId",
        a.reason
      FROM %I."AuditLog" a, venue v
      WHERE a."tenantId" = current_setting('app.tenant_id', true)
        AND a."occurredAt" < (p_before AT TIME ZONE 'UTC')
        AND (p_actor_id IS NULL OR a."actorId" = p_actor_id)
        AND (
          p_day IS NULL
          OR (
            (a."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE v.zone) >= p_day::timestamp
            AND (a."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE v.zone) < (p_day + 1)::timestamp
          )
        )
      ORDER BY a."occurredAt" DESC, a.id DESC
      LIMIT least(greatest(p_limit, 1), 100);
    $body$
  $fmt$, target_schema, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.tenant_audit_history(timestamptz, int, text, date) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.tenant_audit_history(timestamptz, int, text, date) TO positive_app',
    target_schema
  );
END
$migration$;
