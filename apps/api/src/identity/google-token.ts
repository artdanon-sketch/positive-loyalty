/**
 * ПОЧЕМУ ДИНАМИЧЕСКИЙ ИМПОРТ, А НЕ ОБЫЧНЫЙ. `jose` поставляется только
 * в новом формате модулей, а сервер собирается в старом (CommonJS). Обычный
 * импорт превратился бы при сборке в `require` и упал бы в работе — но
 * не при компиляции, то есть обнаружился бы уже на боевом сервере.
 *
 * Настройка `module: Node16` сохраняет `import()` как есть, и такой импорт
 * работает из CommonJS. Результат кэшируется: библиотека загружается один раз
 * на процесс, а не на каждый вход.
 */
/**
 * Тип библиотеки выводится ИЗ САМОГО импорта, а не объявляется отдельно.
 *
 * Отдельное объявление пришлось бы писать как `typeof import('jose', { with:
 * { 'resolution-mode': 'import' } })` — синтаксис, который понимает компилятор,
 * но не понимает линтер: у него тип превращался в «ошибочный», и все обращения
 * к библиотеке становились непроверяемыми. Молча: код собирался, а проверка
 * типов внутри него не работала вовсе.
 */
const importJose = () => import('jose')

type Jose = Awaited<ReturnType<typeof importJose>>

let josePromise: Promise<Jose> | null = null

const loadJose = (): Promise<Jose> => (josePromise ??= importJose())

/** То же и для набора ключей: создать его можно только после загрузки. */
let googleKeysPromise: Promise<ReturnType<Jose['createRemoteJWKSet']>> | null = null

const googleKeys = (): Promise<ReturnType<Jose['createRemoteJWKSet']>> =>
  (googleKeysPromise ??= loadJose().then((jose) =>
    jose.createRemoteJWKSet(new URL(GOOGLE_CERTS_URL)),
  ))

/**
 * Проверка токена Google, которым гость доказывает, что это он.
 *
 * ЧТО ПРИХОДИТ. Кнопка «Войти через Google» на странице отдаёт подписанный
 * Google токен (ID token). В нём: кто это (`sub`), почта, имя, для кого токен
 * выписан (`aud`) и до какого момента годен (`exp`).
 *
 * ПОЧЕМУ БИБЛИОТЕКА, А НЕ СВОИ ТРИДЦАТЬ СТРОК. Разобрать такой токен вручную
 * несложно, и именно поэтому это делают неправильно: забывают проверить, каким
 * алгоритмом он подписан, и принимают токен с `alg: none`; берут ключ по номеру
 * из самого токена, доверяя тому, что проверяют; не сверяют `aud` и принимают
 * токен, выписанный для чужого приложения. Каждая из этих ошибок — вход под
 * любым гостем, и ни одна не заметна в работающей системе.
 *
 * `jose` — библиотека без зависимостей, написанная ровно для этого. Здесь она
 * на сервере и в клиентский код не попадает, поэтому её размер значения
 * не имеет (CLAUDE.md ограничивает вес того, что едет в браузер).
 *
 * ЧТО ПРОВЕРЯЕТСЯ, И ЭТО НЕ ПОЛНЫЙ СПИСОК ДЛЯ КРАСОТЫ:
 *   • подпись — открытым ключом Google, взятым с их адреса, а не из токена;
 *   • `iss` — токен выписан именно Google;
 *   • `aud` — именно для НАШЕГО приложения. Без этой проверки годится любой
 *     токен Google, выписанный любому другому сайту, и вход ломается целиком;
 *   • `exp` — срок не истёк (проверяет сама библиотека);
 *   • `email_verified` — Google подтвердил владение почтой. Непроверенная почта
 *     не годится для склейки карт: по ней один гость присвоил бы карту другого.
 */

/**
 * Открытые ключи Google. Загружаются сами и кэшируются: Google их периодически
 * меняет, и зашивать в код нельзя — вход отвалится в момент смены.
 */
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

/** Оба варианта Google считает допустимыми, и оба встречаются. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** То, что мы забираем из токена. Ничего сверх этого нам не нужно. */
export interface GoogleAccount {
  /** Постоянный идентификатор аккаунта у Google. Не меняется при смене почты. */
  readonly externalId: string
  /** Почта. `null`, если Google её не подтвердил — см. пояснение выше. */
  readonly email: string | null
  readonly displayName: string | null
}

export class GoogleTokenError extends Error {}

/**
 * Разбирает и проверяет токен. Бросает `GoogleTokenError` на любой отказ —
 * вызывающий превращает это в 401, не разглашая подробностей: по тому, ЧЕМ
 * именно плох токен, подбирать его было бы удобнее.
 */
export const verifyGoogleIdToken = async (
  idToken: string,
  clientId: string,
  /**
   * Откуда брать ключи. По умолчанию — от Google.
   *
   * Параметр существует ради проверок: тесту нужно подписать токен своим
   * ключом, а ходить за настоящими ключами Google из теста нельзя — это
   * зависимость от сети и от чужого сервиса в том месте, где проверяется
   * НАША логика. Отказы (чужой `aud`, истёкший срок, неподтверждённая почта)
   * иначе не воспроизвести вовсе: Google таких токенов не выдаёт.
   */
  keys?: Parameters<Jose['jwtVerify']>[1],
): Promise<GoogleAccount> => {
  if (clientId.trim() === '') {
    // Не «пропустить и разобраться потом»: без известного `aud` проверка
    // превращается в «любой токен Google подойдёт».
    throw new GoogleTokenError('GOOGLE_CLIENT_ID не задан — вход через Google выключен')
  }

  const jose = await loadJose()
  const keySource = keys ?? (await googleKeys())

  let payload: Record<string, unknown>

  try {
    const verified = await jose.jwtVerify(idToken, keySource, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
      // Разрешён ровно один алгоритм. Иначе токен может прийти подписанным
      // симметричным ключом, где «ключом» окажется открытый ключ Google.
      algorithms: ['RS256'],
      clockTolerance: 60,
    })

    payload = verified.payload
  } catch (error) {
    throw new GoogleTokenError(`Токен Google не принят: ${(error as Error).message}`)
  }

  const sub = payload['sub']

  if (typeof sub !== 'string' || sub === '') {
    throw new GoogleTokenError('В токене Google нет идентификатора аккаунта')
  }

  const emailValue = payload['email']
  const emailVerified = payload['email_verified']

  // Почта берётся ТОЛЬКО подтверждённая. По ней склеиваются карты разных
  // способов входа, а значит неподтверждённая почта — это способ присвоить
  // чужую карту, назвавшись чужим адресом.
  const email =
    typeof emailValue === 'string' && emailValue !== '' && emailVerified === true
      ? emailValue.toLowerCase()
      : null

  const nameValue = payload['name']
  const displayName = typeof nameValue === 'string' && nameValue.trim() !== '' ? nameValue : null

  return { externalId: sub, email, displayName }
}
