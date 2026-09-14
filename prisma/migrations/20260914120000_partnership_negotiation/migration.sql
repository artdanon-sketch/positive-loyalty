-- ─────────────────────────────────────────────────────────────────────────────
-- Партнёрства: договориться. docs/07, разделы 5, 6.2, 6.3, 9.
--
-- Таблицы партнёрств заведены давно, но договориться по ним было нельзя:
-- ни каталога, ни приглашения. Этой миграции не хватало трёх вещей.
--
--   1. Когда получатель отказал — для правила «повторное приглашение
--      не раньше чем через 30 дней».
--   2. Витрина сети. Политика на "Tenant" отдаёт заведению только его самого,
--      и это правильно: в строке заведения лежат настройки программы
--      и юридическое имя. Каталогу нужны три поля, а не строка целиком.
--   3. Ответ «заблокировал ли меня получатель». Саму блокировку видит только
--      заблокировавший (миграция 20260909210000), и так должно остаться.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Partnership" ADD COLUMN "declinedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- ВИДЫ ПРОДАЖ ПАРТНЁРА: С КАКОГО МОМЕНТА ИХ ВИДНО.
--
-- Было: только при ДЕЙСТВУЮЩЕМ партнёрстве. Тогда условие «за абонемент —
-- ролл в подарок» ресторан согласовывал бы вслепую: пока партнёрство
-- не действует, вместо «абонемента» он видел бы голый идентификатор.
--
-- Открыть на всех статусах тоже нельзя: партнёрство в статусе «предложено»
-- заводит ОТПРАВИТЕЛЬ, одним нажатием. Он читал бы ассортимент любого
-- заведения сети, просто отправив ему приглашение.
--
-- Поэтому видимость несимметрична и растёт вместе с согласием:
--   предложено — получатель видит виды пригласившего (тот сам пришёл
--                с предложением), пригласивший чужих не видит;
--   обсуждают, действует, на паузе — обе стороны видят друг друга;
--   отклонено, завершено — никто.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY partner_reads ON "SaleKind";

CREATE POLICY partner_reads ON "SaleKind"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "Partnership" p
      WHERE (
          p.status IN ('NEGOTIATING', 'ACTIVE', 'PAUSED')
          AND (
            (p."initiatorTenantId" = "SaleKind"."tenantId"
               AND p."partnerTenantId" = current_setting('app.tenant_id', true))
            OR
            (p."partnerTenantId" = "SaleKind"."tenantId"
               AND p."initiatorTenantId" = current_setting('app.tenant_id', true))
          )
        )
        OR (
          p.status = 'PROPOSED'
          AND p."initiatorTenantId" = "SaleKind"."tenantId"
          AND p."partnerTenantId" = current_setting('app.tenant_id', true)
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Функции. SECURITY DEFINER по той же причине, что и у соседних: политики
-- таблиц закрывают чужие строки целиком, а наружу нужно отдать малую их часть.
-- Пустой search_path — защита от подмены схемы. Заведение берётся из
-- app.tenant_id, а не из аргумента: назвать себя чужим заведением нельзя.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  -- ВИТРИНА СЕТИ. docs/07, раздел 6.3: название, категория, число гостей
  -- округлённо. Настроек программы, юридического имени, выручки и точного
  -- размера базы здесь нет и быть не может — это чужие коммерческие данные.
  --
  -- Закрытые заведения возвращаются с isOpen = false: в каталоге им не место,
  -- но у старого партнёрства должно оставаться имя собеседника.
  --
  -- Без объявленного заведения — пусто: функцию нельзя позвать «ни от кого»
  -- и получить весь список.
  EXECUTE format($fmt$
    CREATE FUNCTION %I.network_venues()
    RETURNS TABLE (
      id text,
      "brandName" text,
      vertical text,
      "isOpen" boolean,
      "guestsApprox" int
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT
        t.id,
        t."brandName",
        t.vertical::text,
        t.status IN ('TRIAL', 'ACTIVE') AS "isOpen",
        (
          SELECT (count(*) / 100 * 100)::int
          FROM %I."Membership" m
          WHERE m."tenantId" = t.id
        ) AS "guestsApprox"
      FROM %I."Tenant" t
      WHERE coalesce(current_setting('app.tenant_id', true), '') <> ''
        AND t.id <> current_setting('app.tenant_id', true)
      ORDER BY t."brandName";
    $body$
  $fmt$, target_schema, target_schema, target_schema);

  -- ЗАБЛОКИРОВАЛ ЛИ МЕНЯ ПОЛУЧАТЕЛЬ. Только «да» или «нет» и только про
  -- объявленное заведение: ни причины, ни даты, ни списка заблокировавших.
  EXECUTE format($fmt$
    CREATE FUNCTION %I.invite_blocked(p_recipient text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT EXISTS (
        SELECT 1
        FROM %I."InviteBlock" b
        WHERE b."blockerTenantId" = p_recipient
          AND b."blockedTenantId" = current_setting('app.tenant_id', true)
      );
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format('REVOKE ALL ON FUNCTION %I.network_venues() FROM PUBLIC', target_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.network_venues() TO positive_app', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.invite_blocked(text) FROM PUBLIC', target_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.invite_blocked(text) TO positive_app', target_schema);
END
$migration$;
