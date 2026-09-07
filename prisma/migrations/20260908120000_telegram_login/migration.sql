-- ─────────────────────────────────────────────────────────────────────────────
-- 20260908120000_telegram_login
--
-- Вход гостя через Telegram.
--
-- ЧТО ЗДЕСЬ ХРАНИТСЯ. Не сам вход, а НЕЗАВЕРШЁННАЯ попытка входа: приложение
-- начало обмен, гость ещё не подтвердил. Готовый вход ложится в GuestIdentity
-- рядом с Google — новых сущностей для него не нужно, поставщик TELEGRAM
-- в перечислении есть с миграции 20260907120000.
--
-- ПОЧЕМУ СОСТОЯНИЕ В БАЗЕ, А НЕ В ПАМЯТИ ПРОЦЕССА. Подтверждение приходит
-- не от того, кто начал вход: приложение начинает, Telegram подтверждает,
-- приложение забирает. Между шагами проходят десятки секунд, и перезапуск
-- сервера в этот момент обязан ломать одну попытку входа, а не все сразу.
--
-- Строки одноразовые и короткоживущие. Чистятся не заданием по расписанию,
-- а попутно, при начале следующего входа: отдельный джоб ради таблицы,
-- в которой за сутки набирается несколько десятков строк, — лишняя деталь.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "TelegramLoginRequest" (
    "id" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "claimSecretHash" TEXT NOT NULL,
    "telegramUserId" TEXT,
    "displayName" TEXT,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramLoginRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Уникальность по хешу кода — не украшение: она и есть защита от того, что
-- один и тот же одноразовый код окажется у двух начатых входов.
CREATE UNIQUE INDEX "TelegramLoginRequest_nonceHash_key" ON "TelegramLoginRequest"("nonceHash");

-- CreateIndex
CREATE INDEX "TelegramLoginRequest_expiresAt_idx" ON "TelegramLoginRequest"("expiresAt");

-- ── Права и доступ ───────────────────────────────────────────────────────────
--
-- Тот же случай, что у OtpRequest, GuestSession и GuestIdentity: строка
-- адресуется предъявленным секретом, а не заведением и не гостем. Объявлять
-- в этот момент некого — гость только входит и ещё неизвестен.
--
-- Поэтому политика пропускающая, но RLS ВКЛЮЧЁН. Разница принципиальная:
-- включённый RLS без политики запрещает всё, выключенный — разрешает всё
-- и молча переживёт добавление любой будущей политики мимо этой таблицы.
--
-- DELETE выдан намеренно: приложение само подчищает истёкшие строки.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TelegramLoginRequest" TO positive_app;

ALTER TABLE "TelegramLoginRequest" ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_addressed ON "TelegramLoginRequest"
  USING (true) WITH CHECK (true);

COMMENT ON TABLE "TelegramLoginRequest" IS
  'Незавершённая попытка входа через Telegram: приложение начало, гость ещё '
  'не подтвердил. Завершённый вход живёт в GuestIdentity.';
