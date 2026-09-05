-- ─────────────────────────────────────────────────────────────────────────────
-- Функции перестают быть прибитыми к схеме public.
--
-- ЗАЧЕМ. База может быть общей с чужим продуктом: у нас своя схема, у соседа
-- своя. До этой миграции четыре функции SECURITY DEFINER создавались с явным
-- префиксом `public.` — то есть на чужой базе легли бы прямо в схему соседа.
-- Одна из них, pos_link_for_merchant, отдаёт секрет подписи вебхуков.
--
-- ПОЧЕМУ ЧЕРЕЗ format() И current_schema(), А НЕ ПРОСТО ЗАМЕНОЙ ИМЕНИ.
-- Миграция обязана работать в ЛЮБОЙ целевой схеме: на существующих базах это
-- public, на новой — своя. Зашить второе имя значило бы повторить ту же ошибку
-- с другой константой. current_schema() возвращает первую схему из search_path,
-- а его Prisma выставляет по параметру ?schema= при накатывании миграций.
--
-- ПОЧЕМУ ВНУТРИ ФУНКЦИЙ ОСТАЁТСЯ SET search_path = ''. Это не противоречие.
-- Пустой search_path у SECURITY DEFINER — защита от подмены: иначе вызывающий
-- подсовывает свою схему с одноимёнными таблицами и выполняет свой код с правами
-- владельца. Поэтому имена внутри тела остаются полностью квалифицированными —
-- просто теперь квалифицируются НАСТОЯЩЕЙ схемой, а не константой public.
--
-- Старые версии сносятся ТОЛЬКО если наша схема и есть public: там это те же
-- самые функции. На общей базе в public лежит чужое, и трогать его нельзя.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  -- ── Права на саму схему ───────────────────────────────────────────────────
  --
  -- Без USAGE на схему роль приложения не видит в ней НИЧЕГО, сколько бы прав
  -- на таблицы ей ни выдали. В первой миграции изоляции это было прибито
  -- к public — то есть на общей базе роль получала бы доступ к схеме соседа.
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO positive_app', target_schema);

  -- ── Уборка исторических версий ────────────────────────────────────────────
  --
  -- ТОЛЬКО если наша схема и есть public. Раньше эти DROP выполнялись всегда —
  -- и на общей базе снесли бы одноимённую функцию СОСЕДА: молча и необратимо.
  -- А убирать там нечего: исторические миграции на чужой схеме не выполняются,
  -- значит наших функций в public не появлялось ни разу.
  IF target_schema = 'public' THEN
    DROP FUNCTION IF EXISTS public.auth_tenant_for_device(text);
    DROP FUNCTION IF EXISTS public.pos_link_for_merchant(text);
    DROP FUNCTION IF EXISTS public.webhook_deliveries_due(int, timestamptz);
    DROP FUNCTION IF EXISTS public.ledger_entries_awaiting_delivery(int, timestamptz);
  END IF;

  -- ── Разрешение устройства кассы в заведение, до аутентификации ────────────
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.auth_tenant_for_device(p_device_id text)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT d."tenantId"
      FROM %I."StaffDevice" d
      JOIN %I."Staff" s ON s.id = d."staffId"
      WHERE d."deviceId" = p_device_id
        AND d."isActive"
        AND d."revokedAt" IS NULL
        AND s."isActive"
      LIMIT 1;
    $body$
  $fmt$, target_schema, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.auth_tenant_for_device(text) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.auth_tenant_for_device(text) TO positive_app',
    target_schema
  );

  -- ── Разрешение кассового заведения в наше, до всякой авторизации ──────────
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.pos_link_for_merchant(p_merchant_id text)
    RETURNS TABLE ("tenantId" text, "webhookSecret" text)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT l."tenantId", l."webhookSecret"
      FROM %I."PosLink" l
      WHERE l."posMerchantId" = p_merchant_id
        AND l."isActive"
        AND l."revokedAt" IS NULL
      LIMIT 1;
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.pos_link_for_merchant(text) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.pos_link_for_merchant(text) TO positive_app',
    target_schema
  );

  -- ── Исходящие события, которым пора уходить ───────────────────────────────
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.webhook_deliveries_due(p_limit int, p_now timestamptz)
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
    AS $body$
      SELECT d.id, d."tenantId", d."eventType", d.payload, d."targetUrl", d.attempts
      FROM %I."WebhookDelivery" d
      WHERE d.status = 'PENDING'
        AND d."nextAttemptAt" <= p_now
      ORDER BY d."nextAttemptAt"
      LIMIT p_limit;
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.webhook_deliveries_due(int, timestamptz) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.webhook_deliveries_due(int, timestamptz) TO positive_app',
    target_schema
  );

  -- ── Операции, о которых касса ещё не знает ────────────────────────────────
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.ledger_entries_awaiting_delivery(
      p_limit int,
      p_now timestamptz
    )
    RETURNS TABLE (
      id text,
      "tenantId" text,
      "guestId" text,
      amount int,
      "balanceAfter" int,
      "occurredAt" timestamp(3),
      "createdAt" timestamp(3),
      "targetUrl" text
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT l.id, l."tenantId", l."guestId", l.amount, l."balanceAfter",
             l."occurredAt", l."createdAt", k."callbackUrl"
      FROM %I."LedgerEntry" l
      JOIN %I."PosLink" k
        ON k."tenantId" = l."tenantId"
       AND k."isActive"
       AND k."revokedAt" IS NULL
       AND k."callbackUrl" IS NOT NULL
      LEFT JOIN %I."WebhookDelivery" d ON d."ledgerEntryId" = l.id
      WHERE d.id IS NULL
        AND l.source <> 'POS_WEBHOOK'
        AND l."createdAt" > k."linkedAt"
        AND (l."createdAt" AT TIME ZONE 'UTC') > p_now - interval '1 day'
      ORDER BY l."createdAt"
      LIMIT p_limit;
    $body$
  $fmt$, target_schema, target_schema, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.ledger_entries_awaiting_delivery(int, timestamptz) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.ledger_entries_awaiting_delivery(int, timestamptz) TO positive_app',
    target_schema
  );
END
$migration$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Права по умолчанию для будущих таблиц.
--
-- Без этого каждая новая таблица приезжает без GRANT для роли приложения,
-- и про них вспоминают уже после того, как API ответил «нет доступа».
-- Хуже другое: соблазн выдать права широким мазком в спешке. Пусть лучше
-- умолчание будет узким и заданным один раз.
--
-- LedgerEntry под это правило НЕ попадает: журнал append-only, и UPDATE ему
-- не положен ни при каких обстоятельствах. Его права выданы точечно в первой
-- миграции и там же отозваны лишние.
-- ─────────────────────────────────────────────────────────────────────────────

DO $defaults$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE ON TABLES TO positive_app',
    target_schema
  );
END
$defaults$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Самопроверка: в чужой схеме нет наших следов.
--
-- Более ранние миграции создавали эти функции с жёстким префиксом `public.`
-- Теперь те блоки условны и на чужой схеме не выполняются вовсе, так что
-- появиться там нашим объектам неоткуда. Но «неоткуда» — это рассуждение,
-- а проверка — факт.
--
-- Если после всех действий в public нашлась хоть одна функция с нашим именем,
-- накат падает целиком и откатывается. Два случая, когда это сработает:
-- база досталась в наследство от старого наката в public, либо у соседа
-- оказалась функция с таким же именем. Оба требуют человека — и оба лучше
-- увидеть при накате, чем через месяц.
--
-- Обратите внимание: миграция НЕ убирает найденное сама. Удалять что-либо
-- в схеме соседа она права не имеет, даже если имя совпало с нашим.
-- ─────────────────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  target_schema text := current_schema();
  stray_count int;
  stray_names text;
BEGIN
  IF target_schema = 'public' THEN
    -- Своя схема и есть public: убирать нечего, проверять нечего.
    RETURN;
  END IF;

  SELECT count(*), string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO stray_count, stray_names
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'auth_tenant_for_device',
      'pos_link_for_merchant',
      'webhook_deliveries_due',
      'ledger_entries_awaiting_delivery',
      'ledger_entry_append_only'
    );

  IF stray_count > 0 THEN
    RAISE EXCEPTION
      'В схеме public остались функции системы лояльности: %. Ожидалась схема %.',
      stray_names, target_schema
      USING HINT =
        'Уберите их вручную и повторите накат. Объектам лояльности не место '
        'в общей схеме: там живёт другой продукт.';
  END IF;
END
$verify$;
