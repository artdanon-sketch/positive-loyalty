-- Вход владельца и менеджера по почте и паролю.
--
-- Раньше в бэк-офис входили все одинаково: код устройства + PIN. Для кассира
-- за планшетом это удобно, для владельца за ноутбуком — чужая логика. Теперь
-- у сотрудника может быть почта и пароль; кассир остаётся на устройстве + PIN.
--
-- Колонки nullable — миграция обратимо совместима: у существующих сотрудников
-- почты нет, они входят по-прежнему.

ALTER TABLE "Staff" ADD COLUMN "email" TEXT;
ALTER TABLE "Staff" ADD COLUMN "passwordHash" TEXT;

-- Почта уникальна глобально: по ней вход определяет заведение, и два
-- сотрудника с одним адресом сделали бы это определение неоднозначным.
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- Разрешение почты в tenantId ДО аутентификации — как auth_tenant_for_device.
-- SECURITY DEFINER: намеренно обходит RLS и отдаёт ровно один идентификатор.
-- Сравнение по нижнему регистру: почта регистронезависима, и «Ivan@» и «ivan@»
-- должны вести в одно заведение.
CREATE OR REPLACE FUNCTION public.auth_tenant_for_email(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s."tenantId"
  FROM public."Staff" s
  WHERE lower(s."email") = lower(p_email)
    AND s."isActive"
    AND s."passwordHash" IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_tenant_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_tenant_for_email(text) TO positive_app;

COMMENT ON FUNCTION public.auth_tenant_for_email(text) IS
  'Разрешает почту сотрудника в tenantId до аутентификации. '
  'SECURITY DEFINER: обходит RLS намеренно и отдаёт только один идентификатор. '
  'Расширять возвращаемое значение нельзя — это граница изоляции.';
