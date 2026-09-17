/**
 * Служебный поток карты гостя.
 *
 * ЗАЧЕМ ОН ЗДЕСЬ. Без него телефон не считает страницу приложением: ни iPhone,
 * ни Android не предложат поставить её на экран. Это входной билет, а не кеш.
 *
 * ЧЕГО ОН НАМЕРЕННО НЕ ДЕЛАЕТ — не кеширует ответы API. Карта показывает баллы
 * и код для кассы; показать вчерашний баланс хуже, чем честно сказать «нет сети».
 * Кассир проводит чек по коду, и старый код — это спор у стойки.
 *
 * ЧТО КЕШИРУЕТ — оболочку приложения: страницу, стили и скрипты. Их версия
 * меняется вместе с выкаткой, и старая никому не мешает: при первом же выходе
 * в сеть браузер забирает новую.
 */

const SHELL = 'positive-guest-shell-v1'

self.addEventListener('install', (event) => {
  // Новая версия заступает сразу, не дожидаясь закрытия всех вкладок:
  // у гостя карта обычно одна, и ждать нечего.
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/index.html'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Чужое и незапрашиваемое не трогаем вовсе.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return
  }

  // Данные — только из сети. Ответ API из кеша означал бы вчерашний баланс.
  if (new URL(request.url).pathname.startsWith('/v1/')) {
    return
  }

  // Переход по адресу: сначала сеть, кеш — запасной аэродром для офлайна.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((hit) => hit ?? Response.error()),
      ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // В кеш кладём только удачные ответы: положить 404 значит запомнить ошибку.
          if (response.ok) {
            const copy = response.clone()
            void caches.open(SHELL).then((cache) => cache.put(request, copy))
          }

          return response
        }),
    ),
  )
})

/**
 * Уведомления заведения.
 *
 * ЗАЧЕМ. Карта на телефоне без уведомлений — закладка: гость поставил её и больше
 * не открыл, потому что повода нет. Это второй канал связи после Telegram — и
 * единственный для тех, у кого Telegram нет.
 *
 * ТЕЛО ПРИХОДИТ ЗАШИФРОВАННЫМ ОТ НАШЕГО СЕРВЕРА, но разбирать его надо осторожно:
 * пустое или испорченное уведомление лучше показать общими словами, чем не
 * показать вовсе — браузер накажет за «тихий» push отзывом разрешения.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'POSitive', body: 'Новое сообщение', url: '/' }

  try {
    const data = event.data?.json()

    if (data && typeof data === 'object') {
      payload = {
        title: typeof data.title === 'string' && data.title !== '' ? data.title : payload.title,
        body: typeof data.body === 'string' && data.body !== '' ? data.body : payload.body,
        url: typeof data.url === 'string' && data.url !== '' ? data.url : payload.url,
      }
    }
  } catch {
    // Не разобрали — покажем общими словами. Молчать нельзя.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/card-192.png',
      badge: '/icons/card-192.png',
      data: { url: payload.url },
      // Одно уведомление от заведения вытесняет предыдущее: три одинаковых
      // напоминания в шторке раздражают сильнее, чем помогают.
      tag: 'positive-venue',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = event.notification.data?.url ?? '/'

  // Уже открытую карту поднимаем, а не открываем вторую копию.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }

      return self.clients.openWindow(target)
    }),
  )
})
