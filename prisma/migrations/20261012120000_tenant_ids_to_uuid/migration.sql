-- Заведения и сотрудники с идентификатором-словом переходят на UUID.
--
-- Вся система считает id заведения UUID: схема (Tenant.id @default(uuid())),
-- контракты (tenantId: z.uuid(), AuthSubject.staffId: z.uuid()) и маршруты
-- гостя (ParseUUIDPipe на /guest/venues/:tenantId/...). Один только provision.ts
-- (pnpm setup:business) заводил заведение словом — «kefir», «thainuki» — и его
-- владельца словом «kefir-owner». У такого заведения гость не мог вступить
-- в программу (400 на ссылке вступления), а журнал отказывал в каждом начислении:
-- строка записывалась, но результат не проходил схему LedgerEntryRecord.
--
-- Переводим, пока у этих заведений нет ни гостей, ни операций. На бою 12.10.2026
-- проверено чтением: только сами заведения, их владельцы, устройства входа и сессии.
-- Код устройства входа («owner-kefir») не меняется — владелец входит как раньше,
-- но заново: старые сессии несут прежние id и удаляются.
--
-- Журнал append-only. Если у заведения-слова операции всё-таки появятся до выкатки,
-- UPDATE журнала упадёт на его триггере, и миграция откатится целиком, ничего
-- не изменив, — это сознательно: такой случай разбирается руками, а не скриптом.
--
-- Где заведений-слов нет (локальные и тестовые базы), миграция ничего не делает.
--
-- Имена таблиц неквалифицированы намеренно: Prisma накатывает миграцию
-- с search_path на нашу схему, а база общая с чужим продуктом (см.
-- 20260918200000_staff_email_login).

DO $migration$
DECLARE
  uuid_re CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  old_staff record;
  old_tenant record;
  ref record;
  new_id text;
  kept_email text;
BEGIN
  -- Сотрудники первыми: пока их строки переезжают, заведение ещё на месте.
  FOR old_staff IN SELECT id, email FROM "Staff" WHERE id !~ uuid_re LOOP
    new_id := gen_random_uuid()::text;
    kept_email := old_staff.email;

    -- Сессия несёт id сотрудника внутри токена: перенести её нельзя, только забыть.
    DELETE FROM "Session" WHERE "staffId" = old_staff.id;

    -- Копия без почты: почта уникальна, и на время переезда её держит старая строка.
    INSERT INTO "Staff"
    SELECT (jsonb_populate_record(
      NULL::"Staff",
      to_jsonb(s) || jsonb_build_object('id', new_id, 'email', NULL)
    )).*
    FROM "Staff" s
    WHERE s.id = old_staff.id;

    -- Всё, что ссылается на сотрудника: внешние ключи и колонки staffId без ключа.
    FOR ref IN
      SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = '"Staff"'::regclass
      UNION
      SELECT format('%I', col.table_name), col.column_name::text
      FROM information_schema.columns col
      JOIN information_schema.tables tab USING (table_schema, table_name)
      WHERE col.table_schema = current_schema()
        AND tab.table_type = 'BASE TABLE'
        AND col.column_name = 'staffId'
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', ref.tbl, ref.col, ref.col)
        USING new_id, old_staff.id;
    END LOOP;

    DELETE FROM "Staff" WHERE id = old_staff.id;
    UPDATE "Staff" SET email = kept_email WHERE id = new_id;
  END LOOP;

  FOR old_tenant IN SELECT id FROM "Tenant" WHERE id !~ uuid_re LOOP
    new_id := gen_random_uuid()::text;

    DELETE FROM "Session" WHERE "tenantId" = old_tenant.id;

    INSERT INTO "Tenant"
    SELECT (jsonb_populate_record(NULL::"Tenant", to_jsonb(t) || jsonb_build_object('id', new_id))).*
    FROM "Tenant" t
    WHERE t.id = old_tenant.id;

    -- Всё тенантное: внешние ключи на заведение и колонки tenantId без ключа
    -- (журнал аудита пишет tenantId строкой). Только таблицы — не представления.
    FOR ref IN
      SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = '"Tenant"'::regclass
      UNION
      SELECT format('%I', col.table_name), col.column_name::text
      FROM information_schema.columns col
      JOIN information_schema.tables tab USING (table_schema, table_name)
      WHERE col.table_schema = current_schema()
        AND tab.table_type = 'BASE TABLE'
        AND col.column_name = 'tenantId'
        AND col.table_name <> 'Tenant'
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', ref.tbl, ref.col, ref.col)
        USING new_id, old_tenant.id;
    END LOOP;

    -- Если что-то ещё держит старый id, внешний ключ не даст удалить заведение,
    -- и миграция откатится целиком.
    DELETE FROM "Tenant" WHERE id = old_tenant.id;
  END LOOP;
END
$migration$;
