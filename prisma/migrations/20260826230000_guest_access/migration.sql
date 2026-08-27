-- ─────────────────────────────────────────────────────────────────────────────
-- Гостевой доступ: OTP-запросы, сессии гостя и второй контур политик RLS.
-- docs/02, разделы 1.1–1.2 и 2.1 · docs/05, раздел 2.
--
-- ДВА КОНТУРА ДОСТУПА К ОДНИМ ТАБЛИЦАМ. Тенантный контур уже есть: заведение
-- видит свои строки через app.tenant_id. Гостевой добавляется здесь: гость
-- видит СВОИ строки через app.guest_id — свой профиль, свои участия во ВСЕХ
-- заведениях (кошелёк, docs/02 раздел 2.1), свою историю операций. Политики
-- одной таблицы объединяются по ИЛИ, контуры не мешают друг другу: касса
-- работает под тенантом и не видит чужих гостей, гость работает под собой
-- и не видит чужих заведений целиком.
--
-- OtpRequest и GuestSession — вне обоих контуров: их строки адресуются только
-- секретом (хеш кода, хеш refresh-токена), знание которого и есть право
-- доступа. Политика для роли приложения поэтому разрешающая, и это осознанно:
-- ограничивать нечем — ни тенанта, ни установленного гостя в момент входа
-- ещё не существует. Ровно тот же случай, что вход кассира по устройству.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateTable
CREATE TABLE "OtpRequest" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'DEV',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "OtpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "parentId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpRequest_phoneE164_createdAt_idx" ON "OtpRequest"("phoneE164", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_parentId_key" ON "GuestSession"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_refreshTokenHash_key" ON "GuestSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_guestId_familyId_idx" ON "GuestSession"("guestId", "familyId");

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ── Права и RLS новых таблиц ────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON TABLE "OtpRequest" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "GuestSession" TO positive_app;

ALTER TABLE "OtpRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestSession" ENABLE ROW LEVEL SECURITY;

-- Адресация секретом: см. шапку. RLS включён, чтобы таблицы не выпадали из
-- общего правила «каждая таблица под политикой», а не ради фильтра строк.
CREATE POLICY credential_addressed ON "OtpRequest"
  USING (true) WITH CHECK (true);
CREATE POLICY credential_addressed ON "GuestSession"
  USING (true) WITH CHECK (true);

-- ── Гостевой контур на существующих таблицах ────────────────────────────────

-- Свой профиль: чтение и правка (язык, имя, lastSeenAt).
CREATE POLICY guest_self ON "Guest"
  USING (id = current_setting('app.guest_id', true));

-- Свои участия во всех заведениях — это и есть кошелёк.
CREATE POLICY guest_memberships ON "Membership"
  FOR SELECT
  USING ("guestId" = current_setting('app.guest_id', true));

-- Своя история операций.
CREATE POLICY guest_ledger ON "LedgerEntry"
  FOR SELECT
  USING ("guestId" = current_setting('app.guest_id', true));

-- Витрины заведений, где гость участвует: имя, вертикаль — для кошелька.
CREATE POLICY guest_tenants ON "Tenant"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "Tenant".id
        AND m."guestId" = current_setting('app.guest_id', true)
    )
  );
