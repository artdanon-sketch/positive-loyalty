-- ─────────────────────────────────────────────────────────────────────────────
-- Аутентификация сотрудников и сессии.
-- docs/05_Безопасность_и_антифрод.md, разделы 2 и 3 · docs/02, раздел 1.3–1.4.
--
-- Что здесь есть: роли, сотрудники с PIN, реестр разрешённых устройств и цепочки
-- refresh-токенов с ротацией.
--
-- Чего здесь НЕТ и почему: вход владельца через OAuth POSitive POS — вопрос
-- «умеет ли POS отдавать OAuth» ещё открыт (docs/00, «что решить до первой
-- строчки кода»); гостевой OTP — не выбран SMS-провайдер, а Telegram и LINE
-- относятся к Срезу 4.
-- ─────────────────────────────────────────────────────────────────────────────


-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CASHIER', 'MANAGER', 'OWNER', 'PLATFORM_ADMIN');

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "displayName" TEXT NOT NULL,
    "phoneE164" TEXT,
    "pinHash" TEXT,
    "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StaffDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT,
    "familyId" TEXT NOT NULL,
    "parentId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Staff_tenantId_role_idx" ON "Staff"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDevice_deviceId_key" ON "StaffDevice"("deviceId");

-- CreateIndex
CREATE INDEX "StaffDevice_tenantId_staffId_idx" ON "StaffDevice"("tenantId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_parentId_key" ON "Session"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_tenantId_familyId_idx" ON "Session"("tenantId", "familyId");

-- CreateIndex
CREATE INDEX "Session_staffId_issuedAt_idx" ON "Session"("staffId", "issuedAt");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffDevice" ADD CONSTRAINT "StaffDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffDevice" ADD CONSTRAINT "StaffDevice_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security для новых таблиц.
--
-- БЕЗ ЭТОГО БЛОКА новые таблицы остались бы БЕЗ политик вовсе: RLS включается
-- на таблицу поимённо, и всё, что заведено после миграции изоляции, по умолчанию
-- читается насквозь. То есть роль приложения видела бы сотрудников, устройства
-- и сессии ВСЕХ заведений — включая хеши PIN и refresh-токенов.
--
-- Это не гипотеза: диф Prisma создаёт таблицы и молчит про политики, потому что
-- про RLS он не знает ничего. Каждая новая тенантная таблица обязана попадать
-- сюда в той же миграции, что и её CREATE TABLE.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON TABLE "Staff" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "StaffDevice" TO positive_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "Session" TO positive_app;

ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Staff"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "StaffDevice"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON "Session"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
