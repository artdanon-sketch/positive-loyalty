-- ─────────────────────────────────────────────────────────────────────────────
-- 20260907120000_guest_social_identity
--
-- Вход гостя через Google, LINE и Telegram.
--
-- ГЛАВНОЕ ЗДЕСЬ — НЕ НОВАЯ ТАБЛИЦА, А СНЯТИЕ NOT NULL С ТЕЛЕФОНА.
-- В docs/01 (раздел 4.2) телефон назван первичным идентификатором гостя.
-- Ни один из трёх поставщиков входа номера не отдаёт: Google даёт почту,
-- LINE — свой идентификатор и иногда почту, Telegram — только свой
-- идентификатор. Требовать номер после входа через аккаунт значит вернуть
-- то самое трение, ради устранения которого вход и добавлялся.
--
-- Цена решения названа вслух: кассир больше не может найти гостя набором
-- номера, только по QR-коду из приложения. Решение владельца от 7 сентября
-- 2026: QR достаточно.
--
-- СОВМЕСТИМОСТЬ. Снятие NOT NULL обратимо совместимо: старый код, который
-- всегда записывал телефон, продолжает работать, а прочитанный NULL появится
-- только у гостей, заведённых новым способом. Обратный порядок (сначала код,
-- потом схема) сломал бы работающее приложение (CLAUDE.md, «Как менять схему»).
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'LINE', 'TELEGRAM', 'PHONE');

-- AlterTable
ALTER TABLE "Guest" ALTER COLUMN "phoneE164" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GuestIdentity" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "GuestIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestIdentity_guestId_idx" ON "GuestIdentity"("guestId");

-- CreateIndex
CREATE INDEX "GuestIdentity_email_idx" ON "GuestIdentity"("email");

-- CreateIndex
CREATE UNIQUE INDEX "GuestIdentity_provider_externalId_key" ON "GuestIdentity"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "GuestIdentity" ADD CONSTRAINT "GuestIdentity_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Права и доступ ───────────────────────────────────────────────────────────
--
-- Таблица адресуется не заведением, а парой «поставщик + идентификатор
-- аккаунта», которую предъявляет сам поставщик входа. Тот же случай, что
-- у OtpRequest и GuestSession: строку невозможно найти, не зная, что искать,
-- и объявленного заведения в этот момент ещё нет — гость только входит.
--
-- Поэтому политика пропускающая, но RLS ВКЛЮЧЁН. Это не формальность:
-- включённый RLS без политики запрещает всё, а выключенный — разрешает всё
-- и молча переживёт добавление любой будущей политики мимо этой таблицы.

GRANT SELECT, INSERT, UPDATE ON TABLE "GuestIdentity" TO positive_app;

ALTER TABLE "GuestIdentity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY credential_addressed ON "GuestIdentity"
  USING (true) WITH CHECK (true);

COMMENT ON TABLE "GuestIdentity" IS
  'Через что гость входит: Google, LINE, Telegram. Не путать с каналами '
  'доставки сообщений (docs/01, GuestChannel) — это разные сущности.';
