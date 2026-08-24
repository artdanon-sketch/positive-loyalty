# POSitive Loyalty — API-контракты

Версия 1.0 · для Claude Code

Базовый URL: `https://api.loyalty.positive.app/v1`
Формат: JSON, UTF-8. Все денежные суммы — **целые числа в минорных единицах** (сатанги). 690 ฿ = `69000`.

---

## 0. Общие правила

### Заголовки

| Заголовок | Когда | Что |
|---|---|---|
| `Authorization: Bearer <jwt>` | всегда, кроме публичных | access-токен, TTL 15 мин |
| `Idempotency-Key: <uuid>` | все мутирующие финансовые операции | обязателен, иначе `400` |
| `X-Request-Id: <uuid>` | желательно | сквозная трассировка в логах |
| `Accept-Language: ru\|en\|th\|zh` | опционально | язык сообщений об ошибках |

### Формат ошибки — единый

```json
{
  "error": {
    "code": "BALANCE_CHANGED",
    "message": "Баланс гостя изменился, пересчитайте preview",
    "details": { "expected": 42000, "actual": 38000 },
    "requestId": "0f4c…"
  }
}
```

`code` — машиночитаемый SCREAMING_SNAKE, стабильный контракт. `message` — человекочитаемый, локализованный, **не** для программной обработки.

### Коды состояния

`200` успех · `201` создано · `202` принято в обработку · `400` валидация · `401` нет токена · `403` роль не позволяет · `404` не найдено или чужой тенант · `409` конфликт состояния · `422` бизнес-правило не выполнено · `429` rate limit · `5xx` наша вина

**Важно:** чужой тенант отдаёт `404`, а не `403`. `403` подтверждает существование объекта и является утечкой.

### Идемпотентность

Ключ хранится 24 часа вместе с телом первого ответа. Повтор с тем же ключом возвращает **тот же ответ с тем же кодом**, а не создаёт новую операцию. Повтор с тем же ключом, но другим телом — `409 IDEMPOTENCY_KEY_REUSED`.

### Версионирование

Путь `/v1`. Реестр версий обязателен, устаревшие принудительно депубликуются. Ломающее изменение = новая версия, а не тихая правка.

---

## 1. Аутентификация

### 1.1 Гость: запрос кода

```http
POST /v1/auth/otp/request
Content-Type: application/json

{ "phone": "+66812345678", "tenantId": "3f2c…", "channel": "SMS" }
```

```json
{ "requestId": "b71e…", "expiresIn": 300, "resendAfter": 60 }
```

Rate limit: 3 запроса на номер за 10 минут, 20 на IP за час. Превышение — `429`.

При наличии Telegram или LINE канала у гостя `channel` может быть `TELEGRAM`/`LINE` — код уходит туда, и SMS не тратится. Экономия ощутима: SMS около 0,5 ฿ за штуку.

### 1.2 Гость: проверка кода

```http
POST /v1/auth/otp/verify
{ "requestId": "b71e…", "code": "418302" }
```

```json
{
  "accessToken": "eyJhbGciOi…",
  "refreshToken": "eyJhbGciOi…",
  "guest": { "id": "9c1a…", "displayName": null, "mode": "TOURIST", "locale": "ru" },
  "isNew": true
}
```

5 неверных попыток — блокировка `requestId`, `429`.

### 1.3 Сотрудник и владелец

Владелец — через OAuth POSitive POS (см. архитектуру, 3.1). Сотрудник — по PIN на выданном устройстве:

```http
POST /v1/auth/staff/pin
{ "locationId": "…", "pin": "4821", "deviceId": "…" }
```

`deviceId` обязателен и должен быть заранее зарегистрирован владельцем. PIN без привязки к устройству не принимается — иначе кассир зайдёт с домашнего телефона и начислит себе.

### 1.4 Обновление токена

```http
POST /v1/auth/refresh
{ "refreshToken": "…" }
```

Refresh **ротируется**: старый инвалидируется. Повторное использование отозванного refresh — `401` + алерт в risk-модуль + отзыв всей цепочки сессий этого субъекта.

---

## 2. Гостевое API

### 2.1 Профиль и кошелёк

```http
GET /v1/guest/me
```

```json
{
  "id": "9c1a…",
  "displayName": "Danil",
  "phoneMasked": "+66 •• •• 4821",
  "mode": "TOURIST",
  "locale": "ru",
  "channels": ["PWA", "TELEGRAM", "WALLET"],
  "daysOnIsland": 3
}
```

```http
GET /v1/guest/wallet
```

```json
{
  "totalPointsThb": 24000,
  "memberships": [
    {
      "tenantId": "3f2c…",
      "brandName": "Kata Beach Kitchen",
      "logoUrl": "https://…",
      "points": 12000,
      "tier": { "name": "Свой", "earnRate": 12 },
      "stamps": null,
      "lastVisitAt": "2026-08-17T14:22:00+07:00"
    },
    {
      "tenantId": "77ab…",
      "brandName": "Sabai Thai Massage",
      "points": 0,
      "stamps": { "current": 2, "target": 12, "gifted": 2 }
    }
  ],
  "vouchers": [
    {
      "grantId": "aa11…",
      "offerId": "of_1",
      "title": "Вернём 200 ฿",
      "venue": "Kata Beach Kitchen",
      "code": "KATA-200-7F3Q",
      "expiresAt": "2026-08-19T23:59:59+07:00",
      "howTo": ["Закажите на 800 ฿ или больше", "Покажите свой код", "Завтра 200 ฿ спишутся со счёта"]
    }
  ]
}
```

`howTo` приходит с сервера, а не собирается на клиенте — иначе четыре языка разъедутся.

### 2.2 Токен для показа на кассе

```http
GET /v1/guest/token
```

```json
{ "token": "gt_v1.eyJnIjoiOWMxYSIsImV4cCI6MTc1NTUwMDMwMH0.sig", "expiresAt": "2026-08-18T19:35:00+07:00", "ttl": 180 }
```

Короткоживущий (180 с), подписанный. Клиент обязан кэшировать его и уметь показать **офлайн** — если сеть пропала, показываем последний токен и предупреждение «код может устареть». Сервер принимает просроченный токен с допуском 15 минут, но помечает операцию `staleToken: true` для risk-модуля.

### 2.3 Лента предложений

```http
GET /v1/guest/offers?lat=7.8199&lng=98.2977&radius=1500&limit=20
```

```json
{
  "items": [
    {
      "offerId": "of_1",
      "type": "PROMO_ON_CHECK",
      "title": "Вернём 200 ฿",
      "subtitle": "Kata Beach Kitchen · 180 м",
      "badge": { "text": "Только завтра", "tone": "warm" },
      "expiresAt": "2026-08-19T23:59:59+07:00",
      "howTo": ["…"],
      "distanceM": 180,
      "venue": { "tenantId": "3f2c…", "name": "…", "category": "RESTAURANT", "lat": 7.82, "lng": 98.29 }
    }
  ],
  "nextCursor": null
}
```

Сортировка по умолчанию: сначала истекающие сегодня, затем по расстоянию. Для `mode: RESIDENT` — сначала персональные, затем накопительные.

### 2.4 Каталог сети

```http
GET /v1/guest/venues?category=RESTAURANT&openNow=true&lat=…&lng=…
```

Возвращает карточки заведений с полем `ordering` — если у заведения включён приём заказов, в ответе есть `ordering: { mode: "EXTERNAL_LINK", url: "https://…" }`, и гостевое приложение рисует кнопку «Заказать».

---

## 3. POS API — самое горячее место

Отдельный неймспейс `/v1/pos/*`. Авторизация — токен сотрудника либо сервисный токен кассы.

### 3.1 Найти гостя

```http
GET /v1/pos/guest?token=gt_v1.eyJ…
GET /v1/pos/guest?phone=%2B66812345678
```

```json
{
  "guestId": "9c1a…",
  "membershipId": "mm_77…",
  "displayName": "Анна К.",
  "isNew": false,
  "mode": "TOURIST",
  "hint": "турист · 3-й день на острове",
  "points": 42000,
  "tier": { "name": "Свой", "earnRate": 12, "redeemRate": 20 },
  "stamps": { "current": 4, "target": 12 },
  "visitsTotal": 4,
  "avgCheck": 78000,
  "availableGrants": [
    { "grantId": "aa11…", "title": "Вернём 200 ฿", "value": 20000, "expiresAt": "…" }
  ],
  "flags": { "staleToken": false, "riskLevel": "LOW" }
}
```

Поиск по телефону разрешён только если `cashierRules.allowManualEntry = true`.
`isNew: true` означает, что membership создаётся при коммите — от этого зависит награда сотруднику.

### 3.2 Предрасчёт

```http
POST /v1/pos/transactions/preview
Content-Type: application/json

{
  "guestId": "9c1a…",
  "locationId": "loc_1",
  "amount": 120000,
  "redeemRequested": 20000,
  "receiptNumber": "A-10493",
  "items": [
    { "sku": "tomyum", "name": "Том Ям", "qty": 1, "price": 32000, "category": "soup" },
    { "sku": "padthai", "name": "Пад Тай", "qty": 2, "price": 44000, "category": "main" }
  ]
}
```

```json
{
  "previewId": "pv_8f2a…",
  "expiresAt": "2026-08-18T19:45:00+07:00",
  "amount": 120000,
  "maxRedeemable": 24000,
  "redeem": 20000,
  "amountToPay": 100000,
  "pointsToEarn": 12000,
  "appliedOffers": [
    { "offerId": "of_2", "title": "Кэшбэк 10%", "earnDelta": 12000, "discountDelta": 0 }
  ],
  "skippedOffers": [
    { "offerId": "of_1", "reason": "MIN_CHECK", "message": "Нужен чек от 80 000, у вас 120 000 — акция выдастся после оплаты" }
  ],
  "staffReward": { "eligible": false, "reason": "NOT_NEW_GUEST" }
}
```

`skippedOffers` с человекочитаемой причиной — не роскошь. Именно это кассир объясняет гостю, и именно отсутствие такого объяснения ломает доверие к программе.

### 3.3 Проведение

```http
POST /v1/pos/transactions/commit
Idempotency-Key: 8d1f0a2c-…

{ "previewId": "pv_8f2a…", "receiptId": "pos_rcpt_99182", "paidBy": "PROMPTPAY" }
```

```json
{
  "transactionId": "tx_5c9…",
  "redeemed": 20000,
  "earned": 12000,
  "newBalance": 34000,
  "grantsIssued": [
    { "grantId": "bb22…", "title": "Вернём 200 ฿", "code": "KATA-200-9K2P", "expiresAt": "2026-08-19T23:59:59+07:00" }
  ],
  "stamps": { "current": 5, "target": 12 },
  "staffReward": null,
  "guestNotified": ["TELEGRAM", "WALLET"]
}
```

Ошибки, которые касса обязана уметь показать:

| Код | Когда | Что делать кассе |
|---|---|---|
| `PREVIEW_EXPIRED` | прошло больше 10 минут | перезапросить preview |
| `BALANCE_CHANGED` | гость потратил баллы в другом месте | перезапросить preview, показать новую сумму |
| `LIMIT_REACHED` | превышен лимит кассира по операциям в час | предупредить менеджера |
| `AMOUNT_ABOVE_CAP` | сумма выше `maxManualAmount` | позвать менеджера |
| `RECEIPT_REQUIRED` | не передан `receiptNumber` при включённом правиле | попросить ввести номер чека |

### 3.4 Погашение ваучера

```http
POST /v1/pos/grants/redeem
Idempotency-Key: …
{ "code": "KATA-200-9K2P", "locationId": "loc_1", "receiptId": "pos_rcpt_99183" }
```

Проверки по порядку: код существует → `state = ISSUED` → не истёк → тенант совпадает → окно по времени суток выполняется. Первая непройденная проверка возвращает свой код ошибки — `GRANT_NOT_FOUND`, `GRANT_ALREADY_USED`, `GRANT_EXPIRED`, `GRANT_WRONG_TENANT`, `GRANT_OUT_OF_WINDOW`.

Погашение атомарно: `UPDATE OfferGrant SET state='REDEEMED' WHERE id=… AND state='ISSUED'` и проверка `rowCount = 1`. Без этого два кассира погасят один код одновременно.

### 3.5 Отмена

```http
POST /v1/pos/transactions/{transactionId}/void
Idempotency-Key: …
{ "reason": "WRONG_AMOUNT", "comment": "пробили 1200 вместо 120" }
```

Создаёт `REVERSAL`-записи, возвращает списанные баллы, аннулирует выданные ваучеры, снимает штамп, отменяет награду сотруднику. Окно отмены для кассира — 15 минут, дальше только менеджер и только с комментарием. Всё пишется в `AuditLog`.

---

## 4. Вебхуки от POSitive POS

### 4.1 Чек закрыт

```http
POST /v1/webhooks/pos/receipt-closed
X-Positive-Signature: sha256=9f86d0…
X-Positive-Timestamp: 1755500000
X-Idempotency-Key: pos_rcpt_99182
```

```json
{
  "event": "receipt.closed",
  "occurredAt": "2026-08-18T19:31:07+07:00",
  "posMerchantId": "pm_4471",
  "posLocationId": "pl_02",
  "receipt": {
    "id": "pos_rcpt_99182",
    "number": "A-10493",
    "total": 120000,
    "currency": "THB",
    "paidBy": "PROMPTPAY",
    "closedAt": "2026-08-18T19:31:05+07:00",
    "cashierId": "emp_18",
    "loyalty": { "guestToken": "gt_v1.eyJ…", "previewId": "pv_8f2a…" },
    "items": [ { "sku": "tomyum", "qty": 1, "price": 32000 } ]
  }
}
```

Блок `loyalty` присутствует, если гостя идентифицировали на кассе. Если его нет — событие всё равно обрабатывается: оно нужно для статистики «доля чеков с программой», которая и есть главная метрика проникновения.

Проверка подписи:

```ts
const base = `${timestamp}.${rawBody}`
const expected = crypto.createHmac('sha256', link.webhookSecret).update(base).digest('hex')
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) throw new UnauthorizedException()
if (Math.abs(Date.now()/1000 - Number(timestamp)) > 300) throw new UnauthorizedException()
```

`timingSafeEqual` — обязательно. Обычное `===` даёт timing-атаку.

### 4.2 Чек отменён

`receipt.voided` — тот же конверт, порождает `REVERSAL`.

### 4.3 Исходящие вебхуки к POS

Мы тоже отправляем события — чтобы касса показывала актуальный баланс:

- `guest.balance_changed` — баланс изменился вне кассы
- `offer.granted` — гостю выдан ваучер, который можно погасить у этого мерчанта

Подписываем тем же способом. Повторы: 5 попыток с задержкой 1с, 5с, 30с, 5м, 30м.

---

## 5. Бэк-офис: заведение

### 5.1 Дашборд

```http
GET /v1/admin/dashboard?period=7d
```

```json
{
  "guestsViaProgram": { "value": 147, "prev": 124, "changePct": 18.5, "newGuests": 38 },
  "pointsLiability": { "value": 1240000, "prev": 1198000 },
  "topOffer": { "offerId": "of_1", "title": "200 ฿ на завтра", "redeemed": 64, "returnedGuests": 41 },
  "series": [ { "date": "2026-08-12", "new": 3, "returning": 14 } ],
  "hourly": [ { "hour": 10, "guests": 12 } ],
  "incremental": { "programAvgCheck": 72000, "controlAvgCheck": 61000, "upliftPct": 18.0, "controlSize": 62 }
}
```

`pointsLiability` — «я должен баллами». Формулировка в интерфейсе именно такая: это обязательство бизнеса, а не абстрактная цифра.
`incremental` считается по контрольной группе. Если контрольная группа меньше 30 человек, поле не возвращается — статистики нет, и врать нельзя.

### 5.2 Гости

```http
GET /v1/admin/guests?segment=SLEEPING&locale=ru&cursor=…&limit=50
```

Сегменты: `ALL | NEW | REGULAR | SLEEPING | TOURIST | RESIDENT | CONTROL`. Плюс произвольный фильтр по тегам, диапазону трат и дате последнего визита.

```http
GET /v1/admin/guests/{guestId}
```

Отдаёт карточку с историей ledger, визитами и выданными ваучерами. **Телефон маскируется** всем, кроме владельца; полный номер выдаётся по отдельному эндпоинту с записью в `AuditLog`.

```http
GET /v1/admin/guests/export?format=csv   → 202 + ссылка на файл через воркер
```

Экспорт базы — право владельца. Это принципиально: «ваша база принадлежит вам» — часть продажи. Каждый экспорт логируется.

### 5.3 Акции

```http
POST /v1/admin/offers
{
  "type": "PROMO_ON_CHECK",
  "audience": { "kind": "ALL" },
  "schedule": { "startsAt": "2026-08-19T00:00+07:00", "endsAt": "2026-08-19T23:59+07:00" },
  "limits": { "minCheck": 80000, "perGuestQty": 1, "totalQty": null },
  "reward": { "kind": "FIXED_POINTS", "value": 20000 },
  "visibility": "VENUE_ONLY",
  "i18n": { "ru": { "title": "Вернём 200 ฿", "desc": "при чеке от 800 ฿" } }
}
```

```http
POST /v1/admin/offers/{id}/publish
POST /v1/admin/offers/{id}/pause
GET  /v1/admin/offers/{id}/stats
```

Статистика акции: выдано, использовано, вернулось гостей, выручка от вернувшихся, затраты баллами, прикидка ROI.

**Симуляция до запуска** — отдельная ценность, которой нет у UDS:

```http
POST /v1/admin/offers/simulate
{ "type": "PROMO_ON_CHECK", "limits": { "minCheck": 80000 }, "reward": { "value": 20000 } }
```

```json
{
  "eligibleGuests": 412,
  "expectedRedemptions": { "p50": 96, "p10": 61, "p90": 138 },
  "expectedCost": { "p50": 1920000 },
  "expectedRevenue": { "p50": 4300000 },
  "basedOn": "последние 90 дней вашего заведения"
}
```

Считается на исторических данных самого заведения. Если данных меньше 60 дней — возвращаем `insufficientData: true` и не показываем цифры.

### 5.4 Рассылки

```http
POST /v1/admin/broadcasts
{
  "audience": { "kind": "SLEEPING", "notVisitedDays": 30 },
  "channels": ["TELEGRAM", "LINE"],
  "attachOfferId": "of_1",
  "content": { "ru": { "text": "Соскучились! …" } },
  "autoTranslate": true,
  "scheduledAt": null
}
```

```json
{ "broadcastId": "bc_1", "recipients": 31, "estimatedCost": 0, "breakdown": { "TELEGRAM": 22, "LINE": 9, "SMS": 0 } }
```

Перед отправкой всегда возвращаем стоимость. Telegram и LINE бесплатны, SMS платные — значит SMS по умолчанию выключены и включаются осознанно.

Лимиты: не больше 4 рассылок в месяц на одного гостя от одного заведения. Пятая отклоняется с `RECIPIENT_FATIGUE_LIMIT`. Спам убивает базу быстрее, чем отсутствие рассылок.

### 5.5 Сотрудники и мотивация

```http
GET  /v1/admin/staff
POST /v1/admin/staff            { name, role, pin, locationIds[], phone }
GET  /v1/admin/staff/leaderboard?period=7d
PUT  /v1/admin/settings/staff-reward
{ "enabled": true, "basis": "PER_NEW_GUEST", "value": 2000, "vesting": "ON_SECOND_VISIT", "shiftCap": 15 }
```

```http
POST /v1/admin/settings/staff-reward/estimate
{ "basis": "PER_NEW_GUEST", "value": 2000, "shiftCap": 15 }
→ { "perDay": 18000, "perMonth": 540000, "pctOfProgramRevenue": 2.4 }
```

Владелец видит цену решения в момент, когда двигает ползунок.

### 5.6 Настройки программы

```http
GET /v1/admin/settings/program
PUT /v1/admin/settings/program     — тело = ProgramConfig из архитектуры, 4.3
```

При изменении `baseRedeemRate` или `tiers` — обязательное предупреждение, что интеграции могут не поддержать новое значение (UDS показывает ровно такое, и это оправдано).

---

## 6. Админка платформы

Отдельный неймспейс `/v1/platform/*`, отдельная роль, отдельный контур входа с обязательной 2FA.

```http
GET  /v1/platform/tenants?status=TRIAL&cursor=…
POST /v1/platform/tenants/{id}/impersonate     → короткоживущий токен, всегда в AuditLog
GET  /v1/platform/metrics                       → MRR, churn, survival rate через низкий сезон
POST /v1/platform/moderation/reviews/{id}       → скрыть отзыв
GET  /v1/platform/risk/alerts                   → лента подозрительной активности по всем тенантам
```

`impersonate` — самая опасная ручка в системе. Требования: только роль `PLATFORM_ADMIN`, обязательная причина текстом, TTL 30 минут, баннер «вы смотрите как владелец» в интерфейсе, запись в аудит и уведомление владельцу на почту.

---

## 7. Rate limiting

| Эндпоинт | Лимит |
|---|---|
| `POST /auth/otp/request` | 3 / номер / 10 мин · 20 / IP / час |
| `POST /auth/otp/verify` | 5 попыток на requestId |
| `POST /pos/transactions/commit` | 60 / кассир / час (настраивается) |
| `POST /pos/grants/redeem` | 30 / кассир / час |
| `GET /guest/*` | 120 / гость / мин |
| `POST /admin/broadcasts` | 10 / тенант / сутки |
| Остальные | 600 / токен / мин |

Ответ `429` с заголовком `Retry-After`. Счётчики в Redis, ключ включает субъект, а не только IP — иначе один отель с NAT заблокирует всех своих гостей.

---

## 8. Что должно быть в Swagger

NestJS + `@nestjs/swagger`, схемы генерируются из zod через `nestjs-zod`. Требования:

- Каждый эндпоинт имеет пример запроса и ответа — тот же, что в этом документе.
- Каждый код ошибки перечислен в `@ApiResponse`.
- Публичная документация для POS-интеграции выкладывается отдельным статическим сайтом: партнёрам и своей же кассе нужен читаемый контракт, а не догадки.
