/**
 * Переменные окружения бэк-офиса.
 *
 * Без zod: у фронта две простые переменные, и тянуть на них схему — это
 * зависимость ради зависимости. Появится третья-четвёртая — переедем на разбор
 * схемой, как в apps/guest.
 */
const raw: unknown = import.meta.env.VITE_API_URL
const rawGuest: unknown = import.meta.env.VITE_GUEST_URL
const isNative = import.meta.env.VITE_NATIVE === 'true'

/**
 * Заглушка для мобильной сборки.
 *
 * В приложении адрес сервера настраивается на первом экране и хранится
 * на устройстве, поэтому отсутствие значения при сборке — не ошибка. Падать
 * здесь значило бы требовать знать адрес заведения в момент сборки APK,
 * а он у каждого свой и меняется.
 *
 * В вебе всё наоборот: адрес известен и обязан быть задан, иначе приложение
 * молча ходило бы в никуда.
 */
const NATIVE_PLACEHOLDER = 'http://127.0.0.1:3000/v1'

if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) {
  if (!isNative) {
    throw new Error(
      'Неверное окружение: VITE_API_URL должен быть URL вида http://localhost:3000/v1. ' +
        'Скопируйте apps/admin/.env.example в apps/admin/.env',
    )
  }
}

/** База API вместе с версией пути, без завершающего слеша. */
export const API_URL: string =
  typeof raw === 'string' && /^https?:\/\//.test(raw) ? raw.replace(/\/+$/, '') : NATIVE_PLACEHOLDER

/**
 * Приложение гостя — туда ведут ссылки источников и таблички на столах.
 *
 * Адрес публичный и один на сеть, поэтому значение по умолчанию — боевое:
 * сборка без переменной не падает и не печатает табличку со ссылкой в никуда.
 * Для разработки его переопределяет VITE_GUEST_URL.
 */
const GUEST_URL_DEFAULT = 'https://positive-guest.pages.dev'

export const GUEST_URL: string =
  typeof rawGuest === 'string' && /^https?:\/\//.test(rawGuest)
    ? rawGuest.replace(/\/+$/, '')
    : GUEST_URL_DEFAULT
