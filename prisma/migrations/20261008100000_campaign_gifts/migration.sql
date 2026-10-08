-- Подарки в рассылках и автосценариях. docs/02, разделы 5.4 и 5.4.1.
--
-- Рассылка и сценарий умеют не только написать, но и подарить: баллы или
-- сертификат — той же формой, что подарок ко дню рождения. Все колонки
-- добавляются пустыми или со значением по умолчанию: старый код их просто
-- не замечает, поведение существующих рассылок не меняется.

ALTER TABLE "Broadcast" ADD COLUMN "gift" JSONB;

ALTER TABLE "AutomationRule" ADD COLUMN "gift" JSONB;

-- Учёт подарка отдельно от доставки: подарок получает и тот, до кого сообщение
-- не дошло. giftAt — обработан (выдан или пропущен), giftSkipped — пропущен
-- намеренно: контрольная группа или выключенный шаблон сертификата.
ALTER TABLE "BroadcastRecipient"
  ADD COLUMN "giftAt" TIMESTAMP(3),
  ADD COLUMN "giftSkipped" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "BroadcastRecipient_broadcastId_giftAt_idx" ON "BroadcastRecipient"("broadcastId", "giftAt");

-- Кому сценарий уже сработал: один раз на гостя за эпизод. Без этого спящий
-- гость получал «соскучились» каждый день, пока не упрётся в усталость, —
-- а с подарком ещё и баллы каждый день.
CREATE TABLE "AutomationHit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AutomationKind" NOT NULL,
    "guestId" TEXT NOT NULL,
    "episode" TEXT NOT NULL,
    "broadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationHit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationHit_tenantId_kind_guestId_episode_key" ON "AutomationHit"("tenantId", "kind", "guestId", "episode");

CREATE INDEX "AutomationHit_tenantId_kind_idx" ON "AutomationHit"("tenantId", "kind");

ALTER TABLE "AutomationHit" ADD CONSTRAINT "AutomationHit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AutomationHit" ADD CONSTRAINT "AutomationHit_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Таблица заведения — та же изоляция, что у остальных: чужие отметки не видны
-- и не пишутся.
ALTER TABLE "AutomationHit" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "AutomationHit"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
