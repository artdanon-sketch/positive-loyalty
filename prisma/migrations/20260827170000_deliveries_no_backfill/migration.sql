-- ─────────────────────────────────────────────────────────────────────────────
-- Исходящие не выгружают историю.
--
-- Обнаружено живым прогоном: подключение кассы к заведению, у которого уже есть
-- журнал, отправляло ей ВСЕ прошлые операции — четыреста двадцать одно событие
-- на демо-данных. В проде это означало бы: подключили кассу — и она получила
-- месяцы уведомлений об изменениях баланса, каждое из которых давно неактуально.
--
-- Две границы, и обе про одно: `guest.balance_changed` — это ПОДСКАЗКА для
-- показа, а не источник истины. Актуальный баланс касса и так спрашивает
-- при опознании гостя (GET /v1/pos/guest). Поэтому устаревшую подсказку
-- правильнее не слать вовсе, чем слать с опозданием на неделю.
--
--   1. Не старше момента подключения. Что было до кассы — не её дело.
--   2. Не старше суток. Защита от простоя разгребателя: вернувшись через
--      неделю, он не должен выплюнуть недельную пачку неактуального.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.ledger_entries_awaiting_delivery(int);

CREATE FUNCTION public.ledger_entries_awaiting_delivery(p_limit int, p_now timestamptz)
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
AS $$
  SELECT l.id, l."tenantId", l."guestId", l.amount, l."balanceAfter",
         l."occurredAt", l."createdAt", k."callbackUrl"
  FROM public."LedgerEntry" l
  JOIN public."PosLink" k
    ON k."tenantId" = l."tenantId"
   AND k."isActive"
   AND k."revokedAt" IS NULL
   AND k."callbackUrl" IS NOT NULL
  LEFT JOIN public."WebhookDelivery" d ON d."ledgerEntryId" = l.id
  WHERE d.id IS NULL
    AND l.source <> 'POS_WEBHOOK'
    -- Что было до подключения кассы — не её дело.
    AND l."createdAt" > k."linkedAt"
    -- И не старше суток: неактуальную подсказку лучше не слать вовсе.
    AND (l."createdAt" AT TIME ZONE 'UTC') > p_now - interval '1 day'
  ORDER BY l."createdAt"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.ledger_entries_awaiting_delivery(int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ledger_entries_awaiting_delivery(int, timestamptz) TO positive_app;

COMMENT ON FUNCTION public.ledger_entries_awaiting_delivery(int, timestamptz) IS
  'Операции, о которых касса ещё не знает, поверх границы заведений. '
  'Историю до подключения и старше суток не отдаёт: balance_changed — '
  'подсказка для показа, а не источник истины. SECURITY DEFINER.';
