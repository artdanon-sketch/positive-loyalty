/**
 * Уведомления в карте гостя: что умеет это устройство и что с этим делать.
 * docs/02, раздел 2.10.
 *
 * ЧИСТЫЕ ФУНКЦИИ ОТДЕЛЬНО ОТ БРАУЗЕРА — потому что именно здесь легко ошибиться
 * молча: ключ, переведённый в байты неправильно, даёт подписку, на которую
 * ничего не приходит, и узнается это только тогда, когда гость не пришёл.
 */

/** Что показывать гостю в блоке уведомлений. */
export type PushState =
  /** Устройство не умеет или сервер не настроен — блока нет вовсе. */
  | { readonly kind: 'hidden' }
  /** Можно предложить включить. */
  | { readonly kind: 'ready' }
  /** Уже включены на этом устройстве. */
  | { readonly kind: 'on' }
  /** Гость запретил уведомления в браузере — включить обратно можем не мы. */
  | { readonly kind: 'blocked' }

export interface PushEnvironment {
  /** Браузер умеет Push API и служебный поток. */
  readonly supported: boolean
  /** Сервер отдал открытый ключ. */
  readonly serverReady: boolean
  /** Разрешение браузера: 'default' | 'granted' | 'denied'. */
  readonly permission: NotificationPermission
  /** Подписка на этом устройстве уже есть. */
  readonly subscribed: boolean
}

/**
 * Состояние блока уведомлений.
 *
 * ЗАПРЕТ — НЕ ОШИБКА, А ВЫБОР. Кнопка «включить» после запрета ничего не сделает:
 * браузер второй раз не спросит. Поэтому показываем объяснение, а не кнопку,
 * которая молча не работает.
 */
export const pushState = (env: PushEnvironment): PushState => {
  if (!env.supported || !env.serverReady) {
    return { kind: 'hidden' }
  }

  if (env.permission === 'denied') {
    return { kind: 'blocked' }
  }

  return env.subscribed && env.permission === 'granted' ? { kind: 'on' } : { kind: 'ready' }
}

/**
 * Ключ сервера приходит строкой base64url, а браузеру нужны байты.
 *
 * Перевод делается руками, потому что base64url отличается от обычного base64
 * двумя символами и отсутствием выравнивания: `atob` на нём молча вернёт мусор,
 * подписка создастся, а уведомления не придут никогда.
 */
export const keyToBytes = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // Буфер заводится явно: типам DOM нужен Uint8Array именно над ArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }

  return bytes
}

/** Подписка браузера в том виде, в каком её ждёт наш сервер. */
export interface SubscriptionBody {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

/**
 * Разложить подписку браузера в тело запроса.
 *
 * `null` — подписка без ключей: такое бывает на старых сборках Android WebView,
 * и отправлять её на сервер бессмысленно — шифровать уведомление будет нечем.
 */
export const subscriptionBody = (subscription: PushSubscription): SubscriptionBody | null => {
  const json = subscription.toJSON()
  const p256dh = json.keys?.['p256dh']
  const auth = json.keys?.['auth']

  if (typeof json.endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return null
  }

  return { endpoint: json.endpoint, keys: { p256dh, auth } }
}
