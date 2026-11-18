-- Кассир POSitive POS как сотрудник заведения: доплата за нового гостя и отчёты
-- «кто привёл» по чекам, которые проводит сервер кассы одной связкой.
-- Только добавляет: колонка пустая у всех существующих сотрудников.
ALTER TABLE "Staff" ADD COLUMN "posStaffRef" TEXT;

-- NULL не мешает уникальности: сотрудники, заведённые руками, остаются как есть.
CREATE UNIQUE INDEX "Staff_tenantId_posStaffRef_key" ON "Staff"("tenantId", "posStaffRef");
