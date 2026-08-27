-- ─────────────────────────────────────────────────────────────────────────────
-- Время выборки «кому пора» становится явным параметром.
--
-- Было так: функция фильтровала по `now()` базы, а код отправки принимал момент
-- аргументом. Два источника времени в одном решении — и они расходились:
-- расписание повторов считалось от переданного момента, а выбирались события
-- по часам сервера. Проверить расписание было нечем, а на проде сдвиг часов
-- между процессом и базой давал бы повторы не тогда, когда задумано.
--
-- Теперь момент один и приходит снаружи. Заодно это делает расписание
-- повторов проверяемым: тест двигает время сам, не трогая часы машины.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.webhook_deliveries_due(int);

CREATE FUNCTION public.webhook_deliveries_due(p_limit int, p_now timestamptz)
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
AS $$
  SELECT d.id, d."tenantId", d."eventType", d.payload, d."targetUrl", d.attempts
  FROM public."WebhookDelivery" d
  WHERE d.status = 'PENDING'
    AND d."nextAttemptAt" <= p_now
  ORDER BY d."nextAttemptAt"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.webhook_deliveries_due(int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webhook_deliveries_due(int, timestamptz) TO positive_app;

COMMENT ON FUNCTION public.webhook_deliveries_due(int, timestamptz) IS
  'Исходящие события, которым пора уходить, поверх границы заведений. '
  'Момент приходит параметром: время решения обязано быть одним. '
  'SECURITY DEFINER: обходит RLS намеренно.';
