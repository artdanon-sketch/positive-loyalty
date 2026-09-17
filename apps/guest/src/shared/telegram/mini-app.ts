/**
 * Карта гостя, открытая внутри Telegram. docs/02, раздел 1.4.
 *
 * ЧТО ЭТО. Telegram умеет открывать обычную страницу в окне поверх чата
 * и класть в неё подписанные данные о том, кто её открыл. Для нас это значит
 * две вещи: вход без единого нажатия и канал связи с гостем — бот, через
 * который потом уходят рассылки.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ОБРАЩЕНИЯ К window ПО ВСЕМУ ПРИЛОЖЕНИЮ.
 * Всё, что приходит из окружения Telegram, — чужое и непроверенное: версия
 * клиента может быть старой, полей может не быть, окна может не быть вовсе.
 * Один модуль с честными типами избавляет остальной код от `any` и от вопроса
 * «а вдруг здесь undefined».
 *
 * СКРИПТ TELEGRAM МЫ НЕ ПОДКЛЮЧАЕМ. Объект `window.Telegram.WebApp` вставляет
 * сам клиент Telegram при открытии; снаружи его не будет — и это ровно тот
 * признак, по которому мы отличаем «открыто в Telegram» от «открыто в браузере».
 */

interface TelegramWebApp {
  readonly initData?: string
  readonly colorScheme?: string
  ready?: () => void
  expand?: () => void
}

interface TelegramWindow {
  readonly Telegram?: { readonly WebApp?: TelegramWebApp }
}

const webApp = (): TelegramWebApp | null => {
  if (typeof window === 'undefined') {
    return null
  }

  return (window as unknown as TelegramWindow).Telegram?.WebApp ?? null
}

/**
 * Подписанные данные для входа. null — открыто не в Telegram либо клиент
 * ничего не подписал (так бывает у мини-приложения, открытого из канала).
 */
export function telegramInitData(): string | null {
  const data = webApp()?.initData

  return typeof data === 'string' && data.length > 0 ? data : null
}

/** Открыто ли приложение внутри Telegram — хоть со входом, хоть без. */
export function insideTelegram(): boolean {
  return webApp() !== null
}

/**
 * Сказать Telegram, что страница готова, и развернуть окно на всю высоту.
 *
 * Без `ready()` клиент держит заставку поверх страницы; без `expand()` окно
 * открывается на половину экрана, и карта с QR-кодом оказывается за сгибом.
 * Обе команды необязательные: на старом клиенте их может не быть.
 */
export function telegramReady(): void {
  const app = webApp()

  app?.ready?.()
  app?.expand?.()
}

/** Тема мессенджера: гостю привычнее видеть карту в том же виде, что и чат. */
export function telegramColorScheme(): 'dark' | 'light' | null {
  const scheme = webApp()?.colorScheme

  return scheme === 'dark' || scheme === 'light' ? scheme : null
}
