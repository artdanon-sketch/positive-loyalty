-- ─────────────────────────────────────────────────────────────────────────────
-- 20260915140000_invite_strikes
--
-- Антиспам приглашений: автоохлаждение и жалобы. docs/07, раздел 6.2.
--
-- ЗАЧЕМ ЖУРНАЛ. Отказ виден и по строке партнёрства, но повторное приглашение
-- той же паре переиспользует строку и стирает declinedAt. Считай мы отказы
-- оттуда, спамер укоротил бы себе охлаждение, пригласив снова одного из
-- отказавших. Приложение строки журнала не правит и не удаляет.
--
-- КТО ЧТО ВИДИТ.
--   Отказ — отказавший и тот, кому отказали: второй и так видит статус своего
--   приглашения, а охлаждение ему считается по датам отказов.
--   Жалобу — только пожаловавшийся. Обвинённый узнаёт лишь число неразобранных
--   жалоб через invite_complaints(): имя жалобщика стало бы поводом для ответной.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "InviteStrikeKind" AS ENUM ('DECLINED', 'SPAM');

CREATE TABLE "InviteStrike" (
    "id" TEXT NOT NULL,
    "kind" "InviteStrikeKind" NOT NULL,
    "fromTenantId" TEXT NOT NULL,
    "againstTenantId" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "InviteStrike_pkey" PRIMARY KEY ("id")
);

-- Под охлаждение и жалобы: следы против заведения по виду и дате.
CREATE INDEX "InviteStrike_againstTenantId_kind_createdAt_idx"
  ON "InviteStrike"("againstTenantId", "kind", "createdAt");

-- Под политику: свои следы пожаловавшегося.
CREATE INDEX "InviteStrike_fromTenantId_idx" ON "InviteStrike"("fromTenantId");

ALTER TABLE "InviteStrike"
  ADD CONSTRAINT "InviteStrike_fromTenantId_fkey"
  FOREIGN KEY ("fromTenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "InviteStrike"
  ADD CONSTRAINT "InviteStrike_againstTenantId_fkey"
  FOREIGN KEY ("againstTenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "InviteStrike"
  ADD CONSTRAINT "InviteStrike_partnershipId_fkey"
  FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ПРИЛОЖЕНИЕ ТОЛЬКО ДОПИСЫВАЕТ И ЧИТАЕТ. UPDATE приехал бы сам из ALTER DEFAULT
-- PRIVILEGES (миграция 20260828100000) — отбираем: отметку «жалоба разобрана»
-- ставит платформа, и заведение не должно уметь разобрать жалобу на себя.
REVOKE ALL ON TABLE "InviteStrike" FROM positive_app;
GRANT SELECT, INSERT ON TABLE "InviteStrike" TO positive_app;

-- Платформа читает всё и отмечает разбор.
GRANT SELECT, UPDATE ON TABLE "InviteStrike" TO positive_platform;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "InviteStrike" ENABLE ROW LEVEL SECURITY;

-- Свои следы — всегда; отказ себе — тоже. Жалобу на себя — никогда.
-- Записать след можно только от своего имени.
CREATE POLICY own_strikes ON "InviteStrike"
  USING (
    "fromTenantId" = current_setting('app.tenant_id', true)
    OR ("kind" = 'DECLINED' AND "againstTenantId" = current_setting('app.tenant_id', true))
  )
  WITH CHECK ("fromTenantId" = current_setting('app.tenant_id', true));

CREATE POLICY platform_reviews_all ON "InviteStrike"
  TO positive_platform USING (true) WITH CHECK (true);

-- ── Функция ─────────────────────────────────────────────────────────────────
--
-- СКОЛЬКО НЕРАЗОБРАННЫХ ЖАЛОБ НА МЕНЯ. Только число и только про объявленное
-- заведение: ни жалобщиков, ни причин, ни дат. Считаются разные заведения —
-- одно, пожаловавшееся дважды, приостановку не приблизит. SECURITY DEFINER
-- и пустой search_path — как у invite_blocked() (миграция 20260914120000).
DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($fmt$
    CREATE FUNCTION %I.invite_complaints()
    RETURNS int
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
      SELECT count(DISTINCT s."fromTenantId")::int
      FROM %I."InviteStrike" s
      WHERE s."againstTenantId" = current_setting('app.tenant_id', true)
        AND s.kind = 'SPAM'
        AND s."reviewedAt" IS NULL;
    $body$
  $fmt$, target_schema, target_schema);

  EXECUTE format('REVOKE ALL ON FUNCTION %I.invite_complaints() FROM PUBLIC', target_schema);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.invite_complaints() TO positive_app', target_schema);
END
$migration$;

COMMENT ON TABLE "InviteStrike" IS
  'Отказы и жалобы на приглашения: по ним остывает спамер. Жалобу видит только пожаловавшийся, '
  'обвинённый узнаёт лишь число неразобранных через invite_complaints().';
