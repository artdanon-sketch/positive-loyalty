-- ─────────────────────────────────────────────────────────────────────────────
-- Исходящее событие выводится из журнала, а не пишется рядом с ним.
--
-- Очевидный ход — писать строку доставки в той же транзакции, что и операцию.
-- Он даёт нужную гарантию, но требует, чтобы LedgerService знал про кассу: где
-- взять адрес, каким ключом подписать, слать ли вообще. Ядро начало бы зависеть
-- от прикладного модуля, а такую зависимость потом не разорвать.
--
-- Журнал уже append-only и долговечен, поэтому разгребатель сам находит
-- операции, о которых касса ещё не знает. Гарантия та же — операция есть,
-- значит и событие о ней появится, — а ядро не трогается вовсе.
--
-- КОЛОНКА ДОБАВЛЯЕТСЯ СРАЗУ NOT NULL, вопреки общему правилу репозитория
-- про обратимо совместимые миграции. Правило защищает таблицы с данными;
-- эта таблица создана соседней миграцией в этом же изменении и на любой базе
-- пуста. Заполнять нечего, а нullable-колонка осталась бы навсегда — вместе
-- с ветками кода, проверяющими NULL, которого не бывает.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "WebhookDelivery" ADD COLUMN "ledgerEntryId" TEXT NOT NULL;

-- UNIQUE работает здесь вместо ключа идемпотентности: два прохода
-- разгребателя, столкнувшись на одной операции, не заведут две доставки.
-- Вторая вставка упрётся в базу, а не в удачу.
CREATE UNIQUE INDEX "WebhookDelivery_ledgerEntryId_key" ON "WebhookDelivery"("ledgerEntryId");

-- ─────────────────────────────────────────────────────────────────────────────
-- Операции, о которых касса ещё не знает.
--
-- Разгребатель работает ВНЕ контекста заведения: он не знает заранее, чьи
-- операции ждут отправки. Обходить все заведения по очереди значит опрашивать
-- базу тем чаще, чем больше клиентов.
--
-- Отбираются только заведения с подключённой кассой и названным адресом:
-- копить недоставляемое бессмысленно. Операции от самой кассы пропускаются —
-- о них она знает и без нас, а лишнее событие лишь повод рассинхронизироваться.
--
-- Функция отдаёт РОВНО ТО, из чего собирается событие. Ни имени гостя,
-- ни телефона, ни настроек заведения через неё не видно.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ledger_entries_awaiting_delivery(p_limit int)
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
  ORDER BY l."createdAt"
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.ledger_entries_awaiting_delivery(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ledger_entries_awaiting_delivery(int) TO positive_app;

COMMENT ON FUNCTION public.ledger_entries_awaiting_delivery(int) IS
  'Операции, о которых касса ещё не знает, поверх границы заведений. '
  'SECURITY DEFINER: обходит RLS намеренно. Расширять возвращаемое значение '
  'нельзя — это граница изоляции.';
