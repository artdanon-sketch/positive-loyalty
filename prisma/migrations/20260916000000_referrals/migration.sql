-- Приглашения друзей. docs/11, У6 · docs/02, раздел 2.5.
--
-- 1. Код приглашения на участии: восемь знаков, уникален в пределах заведения.
--    NULL у всех, кто ещё не открывал «Пригласить друга», — таких строк сколько угодно.
-- 2. Внешний ключ на "referredById": до сих пор колонка была просто строкой.
-- 3. Индекс (заведение, пригласивший): карточка гостя и условие статуса
--    «привёл друзей» считают приглашённых на каждом чеке.
--
-- Политики RLS не меняются: таблица "Membership" уже под tenant_isolation,
-- новые колонки защищены вместе с ней.

-- Страховка перед ключом: ссылка на участие, которого нет, или на участие в чужом
-- заведении ключ не пропустил бы, и миграция упала бы на проде. Код такие ссылки
-- никогда не писал — запрос должен ничего не изменить.
UPDATE "Membership" AS m
SET "referredById" = NULL
WHERE m."referredById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Membership" AS r
    WHERE r.id = m."referredById"
      AND r."tenantId" = m."tenantId"
  );

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "referralCode" TEXT;

-- CreateIndex
CREATE INDEX "Membership_tenantId_referredById_idx" ON "Membership"("tenantId", "referredById");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_referralCode_key" ON "Membership"("tenantId", "referralCode");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
