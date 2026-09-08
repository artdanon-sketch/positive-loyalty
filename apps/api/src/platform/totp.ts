import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Одноразовые коды из приложения-аутентификатора (TOTP, RFC 6238).
 *
 * ЧТО ЭТО ПРОСТЫМИ СЛОВАМИ. У сервера и у телефона админа лежит один и тот же
 * случайный секрет — 20 байт, которые передаются один раз, при подключении, через
 * QR-код. Дальше обе стороны делают одно и то же: берут текущее время, делят его
 * на 30 секунд, получают номер интервала и считают HMAC от этого номера на общем
 * секрете. Из HMAC вырезаются шесть цифр. Секрет по сети больше не ходит никогда,
 * поэтому подсмотренный код бесполезен через полминуты, а из самого кода секрет
 * не восстановить.
 *
 * ЗАЧЕМ ОКНО ДОПУСКА. Часы телефона и часы сервера никогда не совпадают идеально:
 * телефон в самолётном режиме, сервер с уплывшим NTP, плюс сам человек набирает
 * шесть цифр несколько секунд и вполне может нажать «войти» уже в следующем
 * интервале. Без допуска такой вход честно провалился бы, и админ решил бы, что
 * двухфакторка сломана. Поэтому по умолчанию принимаются три кода: предыдущего,
 * текущего и следующего интервала — это ±30 секунд расхождения. Шире делать не
 * стоит: каждый лишний шаг окна — это лишний код, действительный прямо сейчас.
 *
 * ПОЧЕМУ БЕЗ ЗАВИСИМОСТЕЙ. Та же причина, что у scrypt в apps/api/src/auth/pin.ts:
 * весь RFC 6238 — это HMAC-SHA1 и немного арифметики, оба есть в node:crypto.
 * Тянуть ради этого пакет в цепочку поставки, где он получит доступ к секретам
 * второго фактора, — плохой размен.
 *
 * ПОЧЕМУ SHA1, ЕСЛИ ОН СЛАБЫЙ. Потому что его поддерживают все аутентификаторы,
 * а SHA256 — не все, и пользователь узнаёт об этом уже после сканирования QR,
 * когда коды «просто не подходят». Слабость SHA1 к коллизиям здесь ни при чём:
 * HMAC-SHA1 не сломан, а секрет всё равно живёт в базе, а не выводится из хеша.
 */

/** RFC 4648, алфавит Base32. Без padding: именно так его принимают аутентификаторы. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** 20 байт = 160 бит, ровно размер блока HMAC-SHA1. Больше не добавляет стойкости. */
const SECRET_BYTES = 20

/** 30 секунд — значение по умолчанию в RFC 6238 и единственное, что умеют все аутентификаторы. */
const DEFAULT_STEP_SECONDS = 30

/** Шесть цифр — то, что человек успевает переписать с экрана телефона. */
const DEFAULT_DIGITS = 6

/** ±1 шаг: см. «зачем окно допуска» в шапке файла. */
const DEFAULT_WINDOW = 1

/**
 * Потолок окна допуска.
 *
 * Окно существует ради расхождения часов телефона и сервера, а оно измеряется
 * секундами, а не минутами. Три шага — это ±90 секунд, с запасом на любые живые
 * часы. Всё, что шире, — уже не терпимость к часам, а перебор кодов в подарок:
 * при окне 1000 одна попытка проверяет две тысячи вариантов вместо трёх.
 */
const MAX_WINDOW = 3

/** Меньше шести цифр — это уже перебираемо за окно жизни кода; больше десяти не влезает в HMAC. */
const MIN_DIGITS = 6
const MAX_DIGITS = 10

/**
 * Новый секрет для подключения аутентификатора.
 * Возвращается сразу в Base32: в этом виде он идёт и в QR-код, и в поле
 * «ввести ключ вручную», если камера не работает.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES))
}

/**
 * Base32 без padding.
 *
 * Своя реализация вместо пакета — двадцать строк арифметики против ещё одной
 * зависимости. Логика простая: складываем байты в аккумулятор и снимаем сверху
 * по пять бит, пока их там хватает; хвост в конце дополняется нулями справа.
 */
export function base32Encode(bytes: Buffer): string {
  let accumulator = 0
  let bitsInAccumulator = 0
  let output = ''

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bitsInAccumulator += 8

    while (bitsInAccumulator >= 5) {
      bitsInAccumulator -= 5
      // charAt, а не [], чтобы не спорить с noUncheckedIndexedAccess из-за индекса,
      // который по построению всегда 0..31.
      output += BASE32_ALPHABET.charAt((accumulator >>> bitsInAccumulator) & 0b11111)
    }
  }

  if (bitsInAccumulator > 0) {
    output += BASE32_ALPHABET.charAt((accumulator << (5 - bitsInAccumulator)) & 0b11111)
  }

  return output
}

/**
 * Base32 обратно в байты.
 *
 * Терпимость к вводу здесь не украшательство: секрет вводят руками с экрана
 * телефона, и в поле неизбежно попадают пробелы из группировки по четыре, дефисы
 * и нижний регистр. Отклонять такой ввод как «неверный ключ» — гарантированный
 * тикет в поддержку на ровном месте.
 *
 * А вот на посторонний символ падаем громко и с указанием, что именно не так:
 * молча его пропустить — значит собрать неправильный секрет и выдать человеку
 * бесконечное «неверный код» вместо честного «вы опечатались».
 */
export function base32Decode(text: string): Buffer {
  // Хвостовой '=' мы не печатаем сами, но он приходит из чужих экспортов —
  // принять его дешевле, чем объяснять, почему валидный ключ не подошёл.
  const normalized = text.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '')

  let accumulator = 0
  let bitsInAccumulator = 0
  const bytes: number[] = []

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)

    if (index === -1) {
      // В сообщение попадает только сам посторонний символ — он по определению
      // не часть секрета, так что подсказка ничего не раскрывает.
      throw new Error(
        `base32Decode: символ «${char}» не входит в алфавит Base32 (A-Z и 2-7). ` +
          'Проверьте: 0 и O, 1 и I, 8 и B легко перепутать.',
      )
    }

    accumulator = (accumulator << 5) | index
    bitsInAccumulator += 5

    if (bitsInAccumulator >= 8) {
      bitsInAccumulator -= 8
      bytes.push((accumulator >>> bitsInAccumulator) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

/**
 * Код на конкретный момент времени.
 *
 * Момент приходит АРГУМЕНТОМ, а не берётся из Date.now() внутри. Так эту функцию
 * можно прогнать по эталонным векторам RFC и по границам окна, не подменяя
 * глобальные часы в тесте, — а подмена часов рано или поздно протекает в соседний
 * тест и ломает его загадочным образом.
 */
export function totpCode(
  secret: string,
  atMs: number,
  stepSeconds: number = DEFAULT_STEP_SECONDS,
  digits: number = DEFAULT_DIGITS,
): string {
  return hotpCode(base32Decode(secret), counterAt(atMs, stepSeconds), digits)
}

/**
 * Проверка введённого кода с окном допуска (см. шапку файла).
 *
 * Шаг и число цифр здесь не параметры сознательно: это ровно те значения, что
 * зашиты в otpauthUrl, и расходиться они не должны. Одна константа на два места —
 * это баг, который проявится через полгода на живом входе.
 *
 * На некорректном секрете функция БРОСАЕТ, а не возвращает false, — в отличие от
 * verifyPin, который на битом хеше молча отвечает «не подошло». Разница в том, что
 * битый PIN-хеш касается одного кассира и не должен ронять экран кассы, а битый
 * TOTP-секрет означает, что админ платформы не войдёт никогда и никто не поймёт
 * почему. Такое лучше увидеть в логе ошибкой, чем прятать за «неверный код».
 */
export function verifyTotp(
  secret: string,
  code: string,
  atMs: number,
  window: number = DEFAULT_WINDOW,
): boolean {
  return matchTotpCounter(secret, code, atMs, window) !== null
}

/**
 * То же, что verifyTotp, но возвращает НОМЕР совпавшего окна, а не «да/нет».
 *
 * ЗАЧЕМ. RFC 6238, раздел 5.2 требует не принимать удачно проверенный код второй
 * раз. Чтобы это обеспечить, сервису входа мало ответа «код верный» — ему нужно
 * знать, КАКОЕ окно совпало, чтобы сравнить его с последним принятым и запомнить.
 *
 * Здесь одна реализация на две функции сознательно: verifyTotp сведён к вызову
 * этой. Две копии перебора окон разъехались бы на первой же правке, причём молча —
 * такие расхождения не ловятся ничем, кроме внимательного чтения.
 *
 * Верхний потолок окна не декоративен: без него вызов с window: 1000 честно
 * проверил бы две тысячи кодов, то есть превратил бы допуск на расхождение часов
 * в готовый подбор.
 */
export function matchTotpCounter(
  secret: string,
  code: string,
  atMs: number,
  window: number = DEFAULT_WINDOW,
): number | null {
  if (!Number.isInteger(window) || window < 0) {
    throw new Error('matchTotpCounter: окно допуска должно быть целым неотрицательным числом шагов')
  }

  if (window > MAX_WINDOW) {
    throw new Error(
      `matchTotpCounter: окно допуска ${window} шагов больше разумного потолка ${MAX_WINDOW}. ` +
        'Широкое окно — это не «терпимость к часам», а подбор кода в подарок.',
    )
  }

  // Аутентификаторы показывают код как «123 456», и ровно так его копируют.
  const candidate = code.replace(/\s/g, '')

  if (candidate.length !== DEFAULT_DIGITS || !/^\d+$/.test(candidate)) {
    // null, а не false: у этой функции тип возврата number | null, и false здесь
    // молча прошёл бы проверку `!== null` в verifyTotp — то есть код неверной
    // длины считался бы верным. Ровно эта ошибка и была допущена при переиспользовании
    // кода; её поймали три существующих теста, а не чтение.
    return null
  }

  const key = base32Decode(secret)
  const candidateBytes = Buffer.from(candidate, 'utf8')
  let matchedCounter: number | null = null

  for (let shift = -window; shift <= window; shift += 1) {
    const counter = counterAt(atMs, DEFAULT_STEP_SECONDS) + shift

    if (counter < 0) {
      continue
    }

    const expected = Buffer.from(hotpCode(key, counter, DEFAULT_DIGITS), 'utf8')

    // Сравнение через timingSafeEqual, а не ===: обычное сравнение строк выходит
    // на первом несовпавшем символе, и по времени ответа код подбирается по цифре
    // за раз вместо миллиона попыток.
    //
    // Из цикла не выходим досрочно намеренно: ранний выход выдал бы по времени,
    // какое именно окно совпало, то есть насколько разошлись часы.
    //
    // Запоминание номера ранним выходом НЕ является: перебор идёт до конца,
    // присваивание случается не более одного раза и цикл не укорачивает.
    if (timingSafeEqual(expected, candidateBytes)) {
      matchedCounter = counter
    }
  }

  return matchedCounter
}

/**
 * Строка для QR-кода: её рисуют картинкой на экране подключения второго фактора.
 *
 * Издатель повторяется дважды — в пути (`issuer:account`) и в параметре `issuer`.
 * Это не опечатка: старые аутентификаторы читают только путь, новые — только
 * параметр, и единственный способ попасть в оба — продублировать.
 */
export function otpauthUrl(params: { secret: string; account: string; issuer: string }): string {
  const { secret, account, issuer } = params

  if (account.trim() === '' || issuer.trim() === '') {
    throw new Error(
      'otpauthUrl: issuer и account обязательны — по ним человек узнаёт запись в списке аутентификатора',
    )
  }

  // Секрет прогоняется через декодер не ради результата, а ради проверки: пустая
  // или битая строка обязана всплыть здесь, а не после того, как её отсканировали.
  const normalizedSecret = secret.replace(/[\s-]/g, '').toUpperCase()
  if (base32Decode(normalizedSecret).length === 0) {
    throw new Error('otpauthUrl: секрет пуст')
  }

  // Кодируем каждую часть по отдельности: в имени тенанта легко встречаются пробелы,
  // «&» и кириллица, а незакодированный «:» разрезал бы метку не там, где нужно.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`

  // URLSearchParams здесь не годится: он кодирует пробел как «+» по правилам
  // веб-формы, и «Kata Beach Kitchen» приезжает в аутентификатор с плюсами.
  const query = [
    `secret=${encodeURIComponent(normalizedSecret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${DEFAULT_DIGITS}`,
    `period=${DEFAULT_STEP_SECONDS}`,
  ].join('&')

  return `otpauth://totp/${label}?${query}`
}

/** Номер 30-секундного интервала, в который попадает момент времени. */
function counterAt(atMs: number, stepSeconds: number): number {
  if (!Number.isFinite(atMs) || atMs < 0) {
    throw new Error('totp: момент времени должен быть неотрицательным числом миллисекунд')
  }

  if (!Number.isInteger(stepSeconds) || stepSeconds <= 0) {
    throw new Error('totp: шаг должен быть целым положительным числом секунд')
  }

  return Math.floor(atMs / 1000 / stepSeconds)
}

/**
 * HOTP, RFC 4226 — то, из чего собран TOTP.
 *
 * «Динамическое усечение»: младшие четыре бита последнего байта HMAC говорят,
 * с какого смещения брать четыре байта результата. Смещение плавает, чтобы код
 * зависел от всего дайджеста, а не от фиксированного его куска. Старший бит
 * гасится маской 0x7fffffff — иначе разные языки трактовали бы число то как
 * знаковое, то как беззнаковое, и коды бы не сошлись.
 */
function hotpCode(key: Buffer, counter: number, digits: number): string {
  if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
    throw new Error(`totp: число цифр должно быть целым от ${MIN_DIGITS} до ${MAX_DIGITS}`)
  }

  if (key.length === 0) {
    throw new Error('totp: секрет пуст — код считать не из чего')
  }

  const counterBytes = Buffer.alloc(8)
  counterBytes.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', key).update(counterBytes).digest()
  const offset = digest.readUInt8(digest.length - 1) & 0x0f
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff

  return String(truncated % 10 ** digits).padStart(digits, '0')
}
