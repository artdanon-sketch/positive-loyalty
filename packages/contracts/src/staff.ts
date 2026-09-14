import { z } from 'zod'

/**
 * Команда заведения: сотрудники, их роли, PIN и устройства.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ ПОНАДОБИЛОСЬ. До этого сотрудники существовали только
 * в демо-скрипте: владелец реального заведения не мог ни добавить кассира,
 * ни сменить ему PIN, ни отключить уволенного. У любой программы лояльности,
 * с которой нас сравнят (Square, UDS), это первый экран после настройки.
 *
 * РОЛЕЙ ДЛЯ УПРАВЛЕНИЯ ДВЕ — КАССИР И МЕНЕДЖЕР. Владелец не заводит других
 * владельцев и не правит их отсюда. Передача заведения — событие другого
 * масштаба, и кнопка «сделать владельцем» рядом с «сменить PIN» превращала бы
 * ошибку одного тапа в потерю заведения.
 */

/** Кем сотрудник может быть назначен из бэк-офиса. */
export const ManagedRole = z.enum(['CASHIER', 'MANAGER'])

export type ManagedRole = z.infer<typeof ManagedRole>

/** PIN, которые подбираются первыми. Список короткий и честный, не «вся энтропия». */
const TRIVIAL_PINS: ReadonlySet<string> = new Set([
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '1234',
  '4321',
  '12345',
  '123456',
  '654321',
  '000000',
  '111111',
])

/**
 * PIN кассира: от четырёх до шести цифр, не из очевидных.
 *
 * ЧЕСТНО ПРО СТОЙКОСТЬ. Запрет «1234» не делает четыре цифры стойкими —
 * их всё равно десять тысяч. PIN защищают привязка к устройству и блокировка
 * после серии неудач (auth/pin.ts). Запрет здесь нужен против другого:
 * кассир, которому выдали «1111», передаёт его сменщику как «ну ты понял»,
 * и через неделю им пользуется вся смена.
 */
export const StaffPin = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN — от четырёх до шести цифр')
  .refine((pin) => !TRIVIAL_PINS.has(pin), {
    error: 'Слишком простой PIN: такие подбирают первыми',
  })

/** Имя видят в ленте операций и в отчёте смены — оно должно быть читаемым. */
const DisplayName = z.string().trim().min(1).max(60)

/** Устройство, с которого сотрудник входит. */
export const StaffDeviceView = z
  .object({
    /**
     * Код устройства — то, что сотрудник вводит на экране входа вместе с PIN.
     * Не секрет сам по себе: без PIN он бесполезен, а PIN сюда не попадает.
     */
    deviceCode: z.string(),
    label: z.string(),
    isActive: z.boolean(),
  })
  .strict()

export type StaffDeviceView = z.infer<typeof StaffDeviceView>

/** Сотрудник, как его видит владелец. PIN и его хеш сюда не попадают никогда. */
export const StaffMember = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    role: z.enum(['CASHIER', 'MANAGER', 'OWNER']),
    isActive: z.boolean(),
    /** Вход временно заблокирован после серии неверных PIN. */
    isLocked: z.boolean(),
    lastSeenAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    devices: z.array(StaffDeviceView),
  })
  .strict()

export type StaffMember = z.infer<typeof StaffMember>

/** Добавить сотрудника. Первое устройство заводится вместе с ним. */
export const CreateStaffInput = z
  .object({
    displayName: DisplayName,
    role: ManagedRole,
    pin: StaffPin,
    /** Где лежит планшет: «Касса у бара». Необязательно — подставим понятное. */
    deviceLabel: z.string().trim().min(1).max(60).optional(),
  })
  .strict()

export type CreateStaffInput = z.infer<typeof CreateStaffInput>

/**
 * Результат добавления: сотрудник и код его устройства.
 *
 * Код возвращается ОДИН РАЗ здесь — чтобы владелец сразу передал его сотруднику
 * вместе с PIN. Потом он виден в списке, а PIN — уже никогда: его знает только
 * тот, кто его придумал.
 */
export const CreateStaffResult = z
  .object({
    staff: StaffMember,
    deviceCode: z.string(),
  })
  .strict()

export type CreateStaffResult = z.infer<typeof CreateStaffResult>

/** Изменить сотрудника: имя, роль, включён ли. */
export const UpdateStaffInput = z
  .object({
    displayName: DisplayName.optional(),
    role: ManagedRole.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Нечего менять: не передано ни одного поля',
  })

export type UpdateStaffInput = z.infer<typeof UpdateStaffInput>

/** Задать новый PIN. Заодно снимает блокировку после неудачных попыток. */
export const ResetStaffPinInput = z
  .object({
    pin: StaffPin,
  })
  .strict()

export type ResetStaffPinInput = z.infer<typeof ResetStaffPinInput>
