-- Уведомления в приложении гостя (Web Push).
--
-- Второй канал связи после Telegram: гость, поставивший карту на телефон,
-- но не открывавший Telegram, до сих пор считался недостижимым.

CREATE TABLE "PushSubscription" (
  "id"         TEXT PRIMARY KEY,
  "guestId"    TEXT NOT NULL REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSentAt" TIMESTAMP(3),
  "goneAt"     TIMESTAMP(3)
);

-- Одно устройство — одна строка: повторная подписка с того же телефона
-- приходит с тем же адресом и обязана обновлять, а не задваивать.
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_guestId_goneAt_idx" ON "PushSubscription"("guestId", "goneAt");

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;

-- Гость распоряжается своими подписками: подписаться и отписаться.
-- Заведение их не видит вовсе — адрес устройства не его дело; отправку
-- делает сервер ролью владельца базы, как и отправку в Telegram.
CREATE POLICY guest_push ON "PushSubscription"
  USING ("guestId" = current_setting('app.guest_id', true))
  WITH CHECK ("guestId" = current_setting('app.guest_id', true));
