-- ─────────────────────────────────────────────────────────────────────────────
-- 20260916040000_reviews
--
-- Отзывы гостей. docs/11, У10 · docs/02, разделы 2.8 и 5.12.
--
-- Review — оценка визита 1–5, быстрые отзывы по темам, комментарий, ответ заведения.
-- Якорь — начисление по чеку (LedgerEntry): оно есть у каждого чека, даже нулевое,
-- и UNIQUE на нём — «один отзыв на чек» на уровне базы.
--
-- Новая таблица: старый код о ней не знает, миграция обратно совместима.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "staffId" TEXT,
    "rating" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_ledgerEntryId_key" ON "Review"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "Review_tenantId_createdAt_idx" ON "Review"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_guestId_createdAt_idx" ON "Review"("guestId", "createdAt");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Оценка — от 1 до 5. Контракт проверяет то же, но оценка «7» в базе сломала бы
-- распределение в сводке, а ограничение Prisma не описывает и следующий diff его не тронет.
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

-- ── Права ────────────────────────────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES (миграция 20260828100000) уже выдал приложению SELECT,
-- INSERT и UPDATE. DELETE не выдаётся намеренно: отзыв не удаляют — неудобный отзыв,
-- который можно стереть, ничего не стоит.

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;

-- Заведение: читает свои отзывы и отвечает на них.
CREATE POLICY tenant_isolation ON "Review"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- Гость: читает свои отзывы с ответами — во всех заведениях.
CREATE POLICY guest_reviews ON "Review"
  FOR SELECT
  USING ("guestId" = current_setting('app.guest_id', true));

-- Гость: пишет отзыв только о СВОЁМ чеке и только в заведение ЭТОГО чека.
-- Подзапрос к журналу идёт под той же ролью, и гостевой контур журнала (guest_ledger)
-- отдаёт в нём только свои строки. Поменять ответ, оценку или чужой отзыв гость не может:
-- UPDATE для гостевого контура не разрешён ни одной политикой.
CREATE POLICY guest_reviews_insert ON "Review"
  FOR INSERT
  WITH CHECK (
    "guestId" = current_setting('app.guest_id', true)
    AND EXISTS (
      SELECT 1 FROM "LedgerEntry" l
      WHERE l.id = "Review"."ledgerEntryId"
        AND l."guestId" = "Review"."guestId"
        AND l."tenantId" = "Review"."tenantId"
    )
  );
