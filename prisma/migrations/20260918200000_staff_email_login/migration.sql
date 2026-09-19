-- Вход владельца и менеджера по почте и паролю.
--
-- Раньше в бэк-офис входили все одинаково: код устройства + PIN. Для кассира
-- за планшетом это удобно, для владельца за ноутбуком — чужая логика. Теперь
-- у сотрудника может быть почта и пароль; кассир остаётся на устройстве + PIN.
--
-- Колонки nullable — миграция обратимо совместима: у существующих сотрудников
-- почты нет, они входят по-прежнему. Имена таблиц здесь неквалифицированы
-- намеренно: Prisma накатывает миграцию с search_path на нашу схему, поэтому
-- «Staff» разрешается в неё, а не в чужой public на общей базе.

ALTER TABLE "Staff" ADD COLUMN "email" TEXT;
ALTER TABLE "Staff" ADD COLUMN "passwordHash" TEXT;

-- Почта уникальна глобально: по ней вход определяет заведение, и два
-- сотрудника с одним адресом сделали бы это определение неоднозначным.
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- Разрешение почты в tenantId ДО аутентификации — как auth_tenant_for_device.
-- SECURITY DEFINER: намеренно обходит RLS и отдаёт ровно один идентификатор.
-- Сравнение по нижнему регистру: почта регистронезависима, и «Ivan@» и «ivan@»
-- должны вести в одно заведение.
--
-- Функция создаётся через format() и current_schema(), а не с префиксом public.
-- База может быть общей с чужим продуктом: у нас своя схема, у соседа своя, и
-- прибитая к public функция легла бы в схему соседа, читая при этом его «Staff».
-- Тело остаётся полностью квалифицированным настоящей схемой — при пустом
-- search_path это единственная защита от подмены таблиц вызывающим.
-- (см. 20260828100000_schema_agnostic_functions — та же логика для остальных.)
DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION %I.auth_tenant_for_email(p_email text)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT s."tenantId"
      FROM %I."Staff" s
      WHERE lower(s."email") = lower(p_email)
        AND s."isActive"
        AND s."passwordHash" IS NOT NULL
      LIMIT 1;
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.auth_tenant_for_email(text) FROM PUBLIC',
    target_schema
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.auth_tenant_for_email(text) TO positive_app',
    target_schema
  );

  EXECUTE format($fmt$
    COMMENT ON FUNCTION %I.auth_tenant_for_email(text) IS
      'Разрешает почту сотрудника в tenantId до аутентификации. '
      'SECURITY DEFINER: обходит RLS намеренно и отдаёт только один идентификатор. '
      'Расширять возвращаемое значение нельзя — это граница изоляции.'
  $fmt$, target_schema);
END
$migration$;
