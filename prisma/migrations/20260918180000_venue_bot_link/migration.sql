-- Приглашение гостя в бота заведения.
--
-- Telegram не даёт боту писать первым: пока гость не нажал «Запустить»,
-- сообщение ему не уйдёт. Ссылка t.me/<бот>?start=<код> — единственный способ
-- связать чат у бота кафе с картой гостя.

CREATE TABLE "VenueBotLink" (
  "id"       TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "guestId"  TEXT NOT NULL REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,

  -- Хеш одноразового кода из ссылки. Сам код не хранится: он предъявляется
  -- вместо подписи, и в базе ему место только в виде хеша — та же логика,
  -- что у кодов входа через Telegram.
  "codeHash"  TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VenueBotLink_tenantId_guestId_idx" ON "VenueBotLink"("tenantId", "guestId");
CREATE INDEX "VenueBotLink_expiresAt_idx" ON "VenueBotLink"("expiresAt");

ALTER TABLE "VenueBotLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueBotLink" FORCE ROW LEVEL SECURITY;

-- Гость создаёт своё приглашение сам, из карты.
CREATE POLICY guest_bot_link ON "VenueBotLink"
  USING ("guestId" = current_setting('app.guest_id', true))
  WITH CHECK ("guestId" = current_setting('app.guest_id', true));

-- Заведение своих приглашений не читает: код — это пароль на подключение чата,
-- и знать его не должен никто, кроме гостя.
