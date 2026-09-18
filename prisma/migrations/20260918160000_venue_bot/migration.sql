-- Свой Telegram-бот у заведения.
--
-- Сообщение от «POSitive Loyalty» гость читает как рассылку сервиса, о котором
-- он не помнит; сообщение от «Kata Beach Kitchen» — как письмо от знакомого
-- кафе. От имени отправителя зависит, откроют его или отпишутся.

CREATE TABLE "VenueBot" (
  "id"       TEXT PRIMARY KEY,
  -- Одно заведение — один бот: второй означал бы, что гость получает
  -- два одинаковых сообщения из разных чатов.
  "tenantId" TEXT NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Ключ от @BotFather. Настоящий секрет: наружу уходит только хвост.
  "token"    TEXT NOT NULL,
  -- Имя бота для ссылки t.me/<имя>.
  "username" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Кто из гостей запустил бота заведения. Telegram не даёт писать первым:
-- пока гость не нажал «Запустить», сообщение ему не уйдёт.
CREATE TABLE "VenueBotChat" (
  "id"        TEXT PRIMARY KEY,
  "tenantId"  TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "guestId"   TEXT NOT NULL REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Идентификатор чата у ЭТОГО бота.
  "chatId"    TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Когда бот получил отказ «гость заблокировал»: таким больше не пишем.
  "blockedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "VenueBotChat_tenantId_guestId_key" ON "VenueBotChat"("tenantId", "guestId");
CREATE INDEX "VenueBotChat_tenantId_blockedAt_idx" ON "VenueBotChat"("tenantId", "blockedAt");

ALTER TABLE "VenueBot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueBot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VenueBotChat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VenueBotChat" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "VenueBot"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "VenueBotChat"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
