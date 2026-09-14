-- ─────────────────────────────────────────────────────────────────────────────
-- Условия партнёрства: пауза и статистика. docs/07, разделы 5 и 8.
-- ─────────────────────────────────────────────────────────────────────────────

-- КТО ПОСТАВИЛ УСЛОВИЕ НА ПАУЗУ.
--
-- Приостановить условие может любая сторона, в один тап и без объяснений
-- (docs/07, раздел 5, правило 2). А снять паузу — только та, что её поставила.
-- Иначе ресторан, которому выгодны гости студии, снимал бы паузу, которую
-- студия поставила, чтобы её гостям перестали приходить чужие предложения.
-- Согласие одной стороны не должно отменяться решением другой.
ALTER TABLE "PartnershipTerm" ADD COLUMN "pausedBy" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- СТАТИСТИКА УСЛОВИЯ: СКОЛЬКО ВЫДАНО И СКОЛЬКО ПОГАШЕНО.
--
-- Обе стороны должны видеть, работает ли договорённость (docs/07, раздел 8,
-- шаг 6). Но промокоды принадлежат дающему подарок, и политика на "OfferGrant"
-- второй стороне их не покажет — и правильно: там гости и коды.
--
-- Счётчик в самом условии пришлось бы поднимать из погашения на кассе, то есть
-- научить ядро про партнёрства. Вместо этого функция считает по промокодам —
-- цифры всегда точные — и отдаёт наружу только два числа на условие, и только
-- сторонам этого партнёрства. Ни кодов, ни гостей, ни дат.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE FUNCTION %I.partnership_term_stats(p_partnership text)
    RETURNS TABLE (
      "termId" text,
      issued int,
      redeemed int
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT
        t.id,
        count(g.id)::int,
        (count(g.id) FILTER (WHERE g.state = 'REDEEMED'))::int
      FROM %I."PartnershipTerm" t
      JOIN %I."Partnership" p ON p.id = t."partnershipId"
      LEFT JOIN %I."OfferGrant" g ON g."offerId" = t."offerId"
      WHERE t."partnershipId" = p_partnership
        AND coalesce(current_setting('app.tenant_id', true), '') <> ''
        AND current_setting('app.tenant_id', true) IN (p."initiatorTenantId", p."partnerTenantId")
      GROUP BY t.id;
    $body$
  $fmt$, target_schema, target_schema, target_schema, target_schema);

  EXECUTE format('REVOKE ALL ON FUNCTION %I.partnership_term_stats(text) FROM PUBLIC', target_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.partnership_term_stats(text) TO positive_app', target_schema);
END
$migration$;
