import { env } from './env'

/**
 * Адрес API, настраиваемый в самом приложении.
 *
 * ЗАЧЕМ ЭТО НУЖНО. В браузере на ноутбуке `localhost:3000` — это тот же
 * ноутбук, и всё сходится. В приложении на телефоне `localhost` — это сам
 * телефон, и API там нет. Зашивать адрес при сборке тоже нельзя: на демо
 * сервер живёт на ноутбуке владельца и меняет адрес при каждом переезде
 * в другое кафе.
 *
 * Поэтому адрес хранится на устройстве и меняется прямо в приложении. Значение
 * из сборки остаётся значением по умолчанию: в вебе им всё и обходится.
 *
 * Проверка формата здесь не косметика. Пустая или кривая строка превращает
 * КАЖДЫЙ запрос в невнятный сетевой сбой, и разбираться с этим гость будет
 * стоя у стойки. Лучше отвергнуть ввод сразу и вернуть прежний адрес.
 */

const BUILT_IN = env.VITE_API_URL.replace(/\/+$/, '')

/** Свой ключ хранения: гостевое приложение и бэк-офис живут на разных доменах. */
const STORAGE_KEY = 'positive.guest.apiUrl'

/** Обрезает завершающие слеши: их дублирование ломает пути запросов. */
const normalize = (value: string): string => value.trim().replace(/\/+$/, '')

export const isValidApiUrl = (value: string): boolean => {
  const normalized = normalize(value)

  if (!/^https?:\/\//.test(normalized)) {
    return false
  }

  try {
    // Разбор через URL, а не регуляркой: «http://» без хоста регулярку пройдёт.
    return new URL(normalized).hostname.length > 0
  } catch {
    return false
  }
}

export function getApiUrl(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)

    return stored !== null && isValidApiUrl(stored) ? normalize(stored) : BUILT_IN
  } catch {
    // Приватный режим запрещает localStorage — это не повод падать.
    return BUILT_IN
  }
}

/** Возвращает `false`, если адрес не принят: вызывающий покажет это человеку. */
export function setApiUrl(value: string): boolean {
  if (!isValidApiUrl(value)) {
    return false
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, normalize(value))
    return true
  } catch {
    return false
  }
}

/** Адрес из сборки: показывается как подсказка «по умолчанию». */
export const DEFAULT_API_URL = BUILT_IN
