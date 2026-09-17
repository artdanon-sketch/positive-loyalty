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
