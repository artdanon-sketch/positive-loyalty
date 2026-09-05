-- ─────────────────────────────────────────────────────────────────────────────
-- Изоляция тенантов, рубеж 2: Row Level Security.
-- docs/01_Архитектура_и_данные.md, раздел 5 · docs/05_Безопасность_и_антифрод.md, раздел 3.
--
-- Рубеж 1 (расширение Prisma, подставляющее tenantId) — страховка от забывчивости.
-- Рубеж 2 — граница. Даже если в коде забыли фильтр, написали сырой SQL или
-- ошиблись в расширении, база не отдаст чужое.
--
-- ГЛАВНОЕ РЕШЕНИЕ ЭТОЙ МИГРАЦИИ: приложение больше НЕ ходит в базу владельцем.
--
-- Владелец таблицы игнорирует политики RLS — ровно так же, как игнорирует REVOKE.
-- Пока приложение подключалось как postgres, включённый RLS не защищал ни от чего
-- и создавал ложную уверенность. Поэтому здесь заводится отдельная роль
-- positive_app, под которой работает API, а владелец остаётся для миграций и seed.
--
-- Роль создаётся БЕЗ пароля и без права входа: пароль выдаётся в каждой среде
-- отдельно и в репозиторий не попадает. Как включить локально — в prisma/README.md.
--
-- Альтернативу FORCE ROW LEVEL SECURITY (политики действуют и на владельца)
-- рассматривал и отклонил: под ней перестают работать миграции и seed, а обходить
-- их отдельной ролью пришлось бы всё равно.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Роль приложения ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'positive_app') THEN
    -- NOLOGIN намеренно: право входа и пароль выдаёт администратор среды.
    CREATE ROLE positive_app NOLOGIN;
  END IF;
END
$$;

-- Право на СВОЮ схему выдаётся в 20260828100000_schema_agnostic_functions,
-- где имя схемы вычисляется. Здесь оно было вписано буквой, и на общей базе
-- эта строка изменила бы права в схеме соседа. На чужой схеме — не выполняется.
DO $grant_usage$
BEGIN
  IF current_schema() = 'public' THEN
    GRANT USAGE ON SCHEMA public TO positive_app;
  END IF;
END
$grant_usage$;

GRANT SELECT, INSERT, UPDATE ON TABLE "Tenant" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "Guest" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "Membership" TO positive_app;
-- LedgerEntry только читаем и дописываем: журнал append-only,
-- UPDATE/DELETE/TRUNCATE отозваны и заблокированы триггерами в первой миграции.
GRANT SELECT, INSERT ON TABLE "LedgerEntry" TO positive_app;

-- ── Включение RLS ───────────────────────────────────────────────────────────

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Guest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;

-- ── Политики ────────────────────────────────────────────────────────────────
--
-- current_setting('app.tenant_id', true) возвращает NULL, если переменная не
-- выставлена. Сравнение с NULL даёт NULL, то есть «не видно» — и это правильное
-- умолчание: роль приложения без явно объявленного тенанта не видит НИЧЕГО.
-- Забытый вызов forTenant() проявится пустым списком сразу, а не утечкой потом.
--
-- Переменная выставляется через SET LOCAL внутри транзакции (PrismaService.forTenant).
-- Обычный SET здесь непригоден: соединения берутся из пула, и значение утекло бы
-- в следующий запрос другого заведения.

-- Tenant адресуется собственным id, а не внешним ключом.
CREATE POLICY tenant_isolation ON "Tenant"
  USING (id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "Membership"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "LedgerEntry"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Guest — особый случай.
--
-- У него НЕТ колонки tenantId, и это замысел, а не упущение: гость на острове
-- один, опознаётся телефоном и участвует сразу в нескольких заведениях
-- (docs/01, раздел 4.2). Добавить ему tenantId — значит размножить человека
-- на копию в каждом заведении и потерять всю идею сети.
--
-- Поэтому видимость гостя определяется участием: заведение видит гостя тогда и
-- только тогда, когда у гостя есть Membership в этом заведении.
CREATE POLICY tenant_isolation_select ON "Guest"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "Membership" m
      WHERE m."guestId" = "Guest".id
        AND m."tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- Регистрация нового гостя происходит ДО появления участия, поэтому вставка
-- разрешена без проверки принадлежности. Это не дыра: вставка не даёт доступа
-- к чужим данным, а телефон уникален — создать дубль существующего гостя нельзя.
CREATE POLICY tenant_isolation_insert ON "Guest"
  FOR INSERT
  WITH CHECK (true);

-- Обновление профиля (lastSeenAt, язык, режим) — только для своих гостей.
CREATE POLICY tenant_isolation_update ON "Guest"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "Membership" m
      WHERE m."guestId" = "Guest".id
        AND m."tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- ── Индекс под политику Guest ───────────────────────────────────────────────
-- Политика на Guest выполняет EXISTS по Membership на каждую строку.
-- Без индекса по (guestId, tenantId) это последовательный скан участий.
CREATE INDEX IF NOT EXISTS "Membership_guestId_tenantId_idx"
  ON "Membership" ("guestId", "tenantId");
