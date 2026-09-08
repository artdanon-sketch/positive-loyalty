-- ─────────────────────────────────────────────────────────────────────────────
-- 20260909170000_platform_admin_auth
--
-- Вход в админку платформы: сам админ, его доверенные устройства, коды
-- восстановления и сессии.
--
-- ─── ПОЧЕМУ ОТДЕЛЬНЫЕ ТАБЛИЦЫ, А НЕ РОЛЬ ВНУТРИ Staff ────────────────────────
--
-- Не ради красоты. Staff.tenantId обязателен и является внешним ключом на
-- Tenant — сотрудник без заведения в этой схеме невыразим. Админ платформы
-- именно таков: он НАД всеми заведениями, а не внутри одного. То же и с
-- сессиями: Session.tenantId тоже обязателен и тоже FK.
--
-- ─── ГЛАВНОЕ В ЭТОЙ МИГРАЦИИ: positive_app СЮДА НЕ ХОДИТ ─────────────────────
--
-- Права основного приложения на все четыре таблицы отобраны ЦЕЛИКОМ. Оно
-- обслуживает владельцев заведений и кассиров, и у него не должно быть даже
-- теоретической возможности прочитать хеш пароля админа платформы, не говоря
-- о зашифрованном секрете второго фактора и о хешах доверенных устройств.
--
-- Отбирать приходится явно: ALTER DEFAULT PRIVILEGES из миграции 20260828100000
-- выдаёт SELECT, INSERT, UPDATE на каждую новую таблицу автоматически. Без
-- REVOKE ниже учётные данные админа платформы лежали бы открытыми для того
-- самого приложения, от которого их и надо прятать.
--
-- ─── ЧТО ХРАНИТСЯ, А ЧТО НАМЕРЕННО НЕТ ───────────────────────────────────────
--
-- passwordHash   — scrypt в том же формате, что PIN сотрудника (auth/pin.ts).
--                  scrypt, а не argon2id, по той же причине, что и там:
--                  argon2 тянет нативную сборку. Отступление от docs/05
--                  объяснено в шапке pin.ts.
-- totpSecretEnc  — секрет второго фактора, зашифрованный AES-256-GCM ключом
--                  из окружения. Компрометация одной только базы не должна
--                  давать возможность генерировать коды.
-- deviceIdHash   — ХЕШ идентификатора устройства, не сам идентификатор.
--                  Украденная база не должна давать готовое значение, которым
--                  можно притвориться доверенным устройством.
-- codeHash       — то же для кодов восстановления: у владельца распечатка,
--                  в базе только отпечатки.
--
-- ─── ДОВЕРЕННОЕ УСТРОЙСТВО ВМЕСТО IP-ALLOWLIST ───────────────────────────────
--
-- IP-allowlist отменён 9 сентября 2026 (решение владельца продукта, записано
-- в docs/05, раздел 2): список адресов и вход с телефона несовместимы, потому
-- что мобильный оператор выдаёт новый адрес почти каждое подключение.
-- Освободившуюся роль берёт привязка к устройству — она работает одинаково
-- и на мобильном интернете, и дома.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdminDevice" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformAdminDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRecoveryCode" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "deviceIdHash" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminDevice_deviceIdHash_key" ON "PlatformAdminDevice"("deviceIdHash");

-- CreateIndex
CREATE INDEX "PlatformAdminDevice_adminId_revokedAt_idx" ON "PlatformAdminDevice"("adminId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRecoveryCode_codeHash_key" ON "PlatformRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "PlatformRecoveryCode_adminId_usedAt_idx" ON "PlatformRecoveryCode"("adminId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSession_refreshTokenHash_key" ON "PlatformSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "PlatformSession_adminId_revokedAt_idx" ON "PlatformSession"("adminId", "revokedAt");

-- CreateIndex
CREATE INDEX "PlatformSession_familyId_idx" ON "PlatformSession"("familyId");

-- CreateIndex
CREATE INDEX "PlatformSession_expiresAt_idx" ON "PlatformSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "PlatformAdminDevice" ADD CONSTRAINT "PlatformAdminDevice_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlatformRecoveryCode" ADD CONSTRAINT "PlatformRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- ── Права: основное приложение сюда не ходит вовсе ───────────────────────────

REVOKE ALL ON TABLE "PlatformAdmin" FROM positive_app;
REVOKE ALL ON TABLE "PlatformAdminDevice" FROM positive_app;
REVOKE ALL ON TABLE "PlatformRecoveryCode" FROM positive_app;
REVOKE ALL ON TABLE "PlatformSession" FROM positive_app;

-- ── Права: приложение админки платформы ──────────────────────────────────────
--
-- DELETE не выдан нигде: отзыв устройства и гашение сессии — это простановка
-- revokedAt, а не удаление строки. Разбирать инцидент по таблице, из которой
-- можно стереть следы, невозможно.

GRANT SELECT, INSERT, UPDATE ON TABLE "PlatformAdmin" TO positive_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE "PlatformAdminDevice" TO positive_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE "PlatformRecoveryCode" TO positive_platform;
GRANT SELECT, INSERT, UPDATE ON TABLE "PlatformSession" TO positive_platform;

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Включён на всех четырёх, хотя права основного приложения и так отобраны:
-- включённый RLS без подходящей политики запрещает всё, выключенный —
-- разрешает всё и молча переживёт любую будущую выдачу прав. Второй рубеж
-- не отменяется тем, что первый сегодня закрыт.
--
-- Политики адресованы positive_platform поимённо. Для positive_app политик
-- нет вовсе — то есть даже если права ему когда-нибудь вернут по недосмотру,
-- RLS всё равно не отдаст ни строки.

ALTER TABLE "PlatformAdmin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformAdminDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformRecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_manages_admins ON "PlatformAdmin"
  TO positive_platform USING (true) WITH CHECK (true);

CREATE POLICY platform_manages_devices ON "PlatformAdminDevice"
  TO positive_platform USING (true) WITH CHECK (true);

CREATE POLICY platform_manages_recovery ON "PlatformRecoveryCode"
  TO positive_platform USING (true) WITH CHECK (true);

CREATE POLICY platform_manages_sessions ON "PlatformSession"
  TO positive_platform USING (true) WITH CHECK (true);

COMMENT ON TABLE "PlatformAdmin" IS
  'Владелец платформы: пароль scrypt, секрет TOTP шифрованный. '
  'Основному приложению (positive_app) недоступна целиком.';
