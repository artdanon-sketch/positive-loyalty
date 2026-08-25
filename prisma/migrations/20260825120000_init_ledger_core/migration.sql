-- ─────────────────────────────────────────────────────────────────────────────
-- 20260825120000_init_ledger_core
--
-- Первая миграция POSitive Loyalty: ядро ledger-контура.
-- Tenant, Guest, Membership, LedgerEntry + перечисления, индексы и внешние ключи.
--
-- Совместимость: миграция только создаёт объекты. Ни одна существующая колонка
-- не переименовывается, не сужается и не удаляется, поэтому старый код,
-- работающий на пустой базе, ею не ломается (CLAUDE.md, «Как менять схему базы»).
--
-- Часть 1 — структура, сгенерирована `prisma migrate diff` из prisma/schema.prisma.
-- Часть 2 — append-only контур на LedgerEntry, дописана руками. Читай её целиком
--           перед тем, как что-то там менять: там объяснено, почему механизмов два.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ Часть 1. Структура ══════════════════════════════════════════════════════

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('RESTAURANT', 'SPA', 'RENTAL', 'RETAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAUSED', 'CHURNED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'NETWORK');

-- CreateEnum
CREATE TYPE "GuestMode" AS ENUM ('TOURIST', 'RESIDENT');

-- CreateEnum
CREATE TYPE "AcquisitionSource" AS ENUM ('ORGANIC', 'CATALOG', 'REFERRAL', 'STAFF', 'IMPORT');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL', 'GRANT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('POS_WEBHOOK', 'POS_SYNC', 'SIGNED_QR', 'STAFF_MANUAL', 'PAYMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'STAFF', 'OWNER', 'GUEST');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "legalName" TEXT,
    "vertical" "Vertical" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "locale" TEXT NOT NULL DEFAULT 'th',
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "seasonMode" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "displayName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "mode" "GuestMode" NOT NULL DEFAULT 'TOURIST',
    "modeLockedBy" TEXT,
    "birthday" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "stampsCount" INTEGER NOT NULL DEFAULT 0,
    "tierId" TEXT,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "visitsTotal" INTEGER NOT NULL DEFAULT 0,
    "spentTotal" INTEGER NOT NULL DEFAULT 0,
    "source" "AcquisitionSource" NOT NULL DEFAULT 'ORGANIC',
    "referredById" TEXT,
    "isControlGroup" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "basisAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "source" "LedgerSource" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "offerId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "locationId" TEXT,
    "deviceId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guest_phoneE164_key" ON "Guest"("phoneE164");

-- CreateIndex
CREATE INDEX "Membership_tenantId_lastVisitAt_idx" ON "Membership"("tenantId", "lastVisitAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_guestId_tenantId_key" ON "Membership"("guestId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversalOfId_key" ON "LedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_createdAt_idx" ON "LedgerEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_membershipId_createdAt_idx" ON "LedgerEntry"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_guestId_createdAt_idx" ON "LedgerEntry"("guestId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ═══ Часть 2. LedgerEntry — append-only ══════════════════════════════════════
--
-- docs/01 раздел 4.4 и docs/05 раздел 5: единственная разрешённая операция над
-- журналом баллов — INSERT. Отмена начисления делается встречной записью REVERSAL
-- со ссылкой reversalOfId, а не правкой исходной строки.
--
-- ПОЧЕМУ ЗАЩИТ ДВЕ, А НЕ ОДНА. Каждая по отдельности обходится:
--
--   • REVOKE снимает права у ролей приложения, но НЕ действует на владельца
--     таблицы и на суперпользователя: у владельца привилегии подразумеваются,
--     и он в любой момент может сделать GRANT сам себе. Миграции и seed ходят
--     в базу как раз владельцем — то есть под ним REVOKE не защищает вообще.
--
--   • Триггер срабатывает на кого угодно, включая владельца, но владелец же
--     может его выключить: ALTER TABLE ... DISABLE TRIGGER, DROP TRIGGER.
--
-- Вместе они дают то, чего нет по отдельности: чтобы стереть строку журнала,
-- нужно осознанно выполнить отдельный DDL под привилегированной ролью. Случайный
-- `DELETE FROM "LedgerEntry" WHERE ...` из кода, миграции или psql-сессии
-- разработчика не пройдёт ни при каких обстоятельствах.
--
-- Тут же закрыт TRUNCATE: он не UPDATE и не DELETE, построчные триггеры на нём
-- не срабатывают, и без отдельного правила он бы вынес весь журнал одной командой.

-- ── 2.1 Функция-страж ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "ledger_entry_append_only"()
  RETURNS trigger
  LANGUAGE plpgsql
  -- Фиксированный search_path: иначе вызывающий может подсунуть свою схему
  -- с одноимёнными объектами и изменить поведение функции.
  SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION
    'LedgerEntry is append-only: % is forbidden. Journal rows are never modified.', TG_OP
    USING
      ERRCODE = '42501', -- insufficient_privilege
      HINT = 'To cancel an operation insert a REVERSAL row referencing the original via "reversalOfId". See docs/01 section 4.4.';
END;
$$;

COMMENT ON FUNCTION "ledger_entry_append_only"() IS
  'Страж append-only журнала баллов. Безусловно роняет любой UPDATE, DELETE и TRUNCATE на LedgerEntry.';

-- ── 2.2 Триггеры ─────────────────────────────────────────────────────────────

-- Построчный: ловит UPDATE и DELETE, в том числе выполненные владельцем таблицы.
CREATE TRIGGER "ledger_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_entry_append_only"();

-- Пооператорный: TRUNCATE построчные триггеры не вызывает вообще.
CREATE TRIGGER "ledger_entry_no_truncate"
  BEFORE TRUNCATE ON "LedgerEntry"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "ledger_entry_append_only"();

-- ENABLE ALWAYS, а не ENABLE (значение по умолчанию): обычные триггеры молча
-- перестают срабатывать при session_replication_role = 'replica'. Эту настройку
-- ставят инструменты репликации и массовой загрузки — и вместе с ней получают
-- право переписать журнал. Здесь такой лазейки быть не должно.
ALTER TABLE "LedgerEntry" ENABLE ALWAYS TRIGGER "ledger_entry_no_update_delete";
ALTER TABLE "LedgerEntry" ENABLE ALWAYS TRIGGER "ledger_entry_no_truncate";

-- ── 2.3 Права ────────────────────────────────────────────────────────────────

-- Роль приложения на LedgerEntry имеет ровно два права: SELECT и INSERT.
-- PUBLIC сносим в любом случае: даже если кто-то когда-то сделает GRANT ... TO PUBLIC,
-- на эту таблицу оно распространяться не будет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "LedgerEntry" FROM PUBLIC;

-- Ролей приложения в разных окружениях разный набор: локально docker-postgres
-- с одной ролью, в Supabase — authenticated / anon / service_role.
-- Перебираем известные имена и трогаем только те, что реально существуют,
-- иначе миграция падала бы на каждой среде, где роли названы иначе.
DO $$
DECLARE
  role_name text;
BEGIN
  -- Снять UPDATE/DELETE/TRUNCATE со всех ролей, которые встречаются в наших окружениях.
  FOREACH role_name IN ARRAY ARRAY[
    'positive_app',   -- роль приложения POSitive Loyalty
    'positive_admin', -- роль бэк-офиса
    'authenticated',  -- Supabase: авторизованный клиент
    'anon',           -- Supabase: анонимный клиент
    'service_role'    -- Supabase: сервисная роль, обходит RLS — тем важнее ей запретить
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I', 'LedgerEntry', role_name);
    END IF;
  END LOOP;

  -- Выдать SELECT и INSERT — только собственным ролям приложения.
  -- anon, authenticated и service_role сюда НЕ попадают: RLS появится только
  -- в Задаче 3, и до неё раздавать INSERT публичным ролям Supabase нельзя.
  FOREACH role_name IN ARRAY ARRAY['positive_app', 'positive_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO %I', 'LedgerEntry', role_name);
    END IF;
  END LOOP;
END;
$$;

-- ── 2.4 Документирующие комментарии в самой базе ──────────────────────────────
-- Тот, кто откроет таблицу в psql или Studio, должен увидеть правила там же,
-- а не идти за ними в репозиторий.

COMMENT ON TABLE "LedgerEntry" IS
  'Журнал операций с баллами. APPEND-ONLY: разрешён только INSERT. UPDATE, DELETE и TRUNCATE запрещены триггером ledger_entry_append_only и снятыми правами. Отмена операции — новая строка type=REVERSAL со ссылкой reversalOfId.';

COMMENT ON COLUMN "LedgerEntry"."amount" IS
  'Знаковое целое в баллах: плюс — начисление, минус — списание. Дробных баллов не бывает.';

COMMENT ON COLUMN "LedgerEntry"."balanceAfter" IS
  'Снапшот баланса после операции. Пишется в той же Serializable-транзакции, что и строка.';

COMMENT ON COLUMN "LedgerEntry"."basisAmount" IS
  'Сумма чека в минорных единицах валюты тенанта (сатанги для THB). Целое, никаких float.';

COMMENT ON COLUMN "LedgerEntry"."idempotencyKey" IS
  'Ключ идемпотентности финансовой операции. UNIQUE — последний рубеж защиты от двойного начисления.';

COMMENT ON COLUMN "LedgerEntry"."reversalOfId" IS
  'Ссылка на отменяемую запись. UNIQUE — одну операцию нельзя отменить дважды.';

COMMENT ON COLUMN "Membership"."pointsBalance" IS
  'КЭШ баланса. Источник истины — SUM(LedgerEntry.amount) по этому membership. Пишется только LedgerService и только внутри транзакции с ledger-записью. Ночной джоб reconcile сверяет и алертит на расхождение.';

COMMENT ON COLUMN "Membership"."spentTotal" IS
  'Накопленная сумма чеков в минорных единицах (сатанги). Целое.';

COMMENT ON COLUMN "Membership"."isControlGroup" IS
  'Контрольная группа (~5% участников): баллы не начисляются, нужна для доказательства эффекта программы. Задним числом не восстанавливается.';
