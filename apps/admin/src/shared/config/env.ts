/**
 * Переменные окружения бэк-офиса.
 *
 * Без zod: у фронта ровно одна переменная, и тянуть на неё схему — это
 * зависимость ради зависимости. Появится вторая-третья — переедем на разбор
 * схемой, как в apps/guest.
 */
const raw: unknown = import.meta.env.VITE_API_URL

if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) {
  throw new Error(
    'Неверное окружение: VITE_API_URL должен быть URL вида http://localhost:3000/v1. ' +
      'Скопируйте apps/admin/.env.example в apps/admin/.env',
  )
}

/** База API вместе с версией пути, без завершающего слеша. */
export const API_URL: string = raw.replace(/\/+$/, '')
