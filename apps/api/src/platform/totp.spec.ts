import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from './totp'

/**
 * TOTP. Проверяется в отрыве от входа: здесь дешевле всего поймать смещение на
 * один шаг, перепутанные секунды с миллисекундами и слишком щедрое окно допуска —
 * то есть ровно те ошибки, которые на живом входе выглядят как «иногда не пускает»
 * и отлаживаются неделю.
 *
 * Момент времени всюду передаётся явно, часы не подменяются: тест обязан давать
 * один и тот же ответ и сегодня, и через год.
 */

/**
 * Эталонный секрет из RFC 6238, Appendix B: ASCII «12345678901234567890», 20 байт.
 * В Base32 это GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
 */
const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('Векторы RFC 6238', () => {
  it('переводит эталонный ASCII-секрет в тот самый Base32', () => {
    // Если эта проверка красная, все следующие бессмысленны: сверялись бы
    // с эталоном, но на другом секрете.
    expect(base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'))).toBe(RFC_SECRET)
  })

  /**
   * Appendix B, строки для HMAC-SHA1. T — в СЕКУНДАХ, наша функция принимает
   * миллисекунды: несовпадение единиц здесь самая вероятная ошибка, и вектор
   * T=59 её ловит первым же.
   */
  const vectors: ReadonlyArray<{ seconds: number; code: string }> = [
    { seconds: 59, code: '94287082' },
    { seconds: 1_111_111_109, code: '07081804' },
    { seconds: 1_111_111_111, code: '14050471' },
    { seconds: 1_234_567_890, code: '89005924' },
    { seconds: 2_000_000_000, code: '69279037' },
    { seconds: 20_000_000_000, code: '65353130' },
  ]

  for (const { seconds, code } of vectors) {
    it(`T=${seconds} даёт ${code}`, () => {
      expect(totpCode(RFC_SECRET, seconds * 1000, 30, 8)).toBe(code)
    })
  }

  it('сохраняет ведущий ноль (T=1111111109 → 07081804)', () => {
    // Отдельным тестом, потому что дополнение нулями слева легко потерять:
    // число 7081804 форматируется в семь символов и «почти совпадает».
    const code = totpCode(RFC_SECRET, 1_111_111_109 * 1000, 30, 8)

    expect(code).toHaveLength(8)
    expect(code.startsWith('0')).toBe(true)
  })
})

describe('Base32', () => {
  it('возвращает исходные байты после кодирования и декодирования', () => {
    // Разные длины: хвост, не кратный пяти байтам, — обычное место для ошибки
    // на один бит, и именно он у нас в секрете (20 байт кратны, а вот 1..9 нет).
    for (const length of [1, 2, 3, 4, 5, 6, 7, 9, 10, 16, 20, 33]) {
      const source = randomBytes(length)

      expect(base32Decode(base32Encode(source)).equals(source)).toBe(true)
    }
  })

  it('кодирует без padding — иначе аутентификаторы не принимают ключ', () => {
    expect(base32Encode(randomBytes(9))).not.toContain('=')
  })

  it('терпит пробелы, дефисы и нижний регистр — секрет вводят руками', () => {
    const source = Buffer.from(RFC_SECRET_ASCII, 'ascii')
    const messy = ' gezd gnbv-gy3t qojq\tGEZD GNBV GY3T QOJQ '

    expect(base32Decode(messy).equals(source)).toBe(true)
  })

  it('принимает хвостовой padding из чужих экспортов', () => {
    expect(base32Decode('MFRGG===').equals(base32Decode('MFRGG'))).toBe(true)
  })

  it('падает на постороннем символе, а не молча собирает не тот секрет', () => {
    // «1» и «0» в алфавите Base32 отсутствуют именно потому, что их путают
    // с I и O; молчаливый пропуск дал бы вечное «неверный код».
    expect(() => base32Decode('GEZDGNBV1GY3T')).toThrow(/Base32/)
    expect(() => base32Decode('GEZD0GNBV')).toThrow(/Base32/)
    expect(() => base32Decode('привет')).toThrow(/Base32/)
  })
})

describe('Окно допуска', () => {
  const STEP_MS = 30_000
  const NOW = 1_755_500_000_000

  it('принимает код предыдущего шага — часы телефона отстают', () => {
    const previous = totpCode(RFC_SECRET, NOW - STEP_MS)

    expect(verifyTotp(RFC_SECRET, previous, NOW)).toBe(true)
  })

  it('принимает код текущего шага', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, NOW), NOW)).toBe(true)
  })

  it('принимает код следующего шага — часы телефона спешат', () => {
    const next = totpCode(RFC_SECRET, NOW + STEP_MS)

    expect(verifyTotp(RFC_SECRET, next, NOW)).toBe(true)
  })

  it('НЕ принимает код двух шагов назад — окно ровно ±1, и оно не должно расползаться', () => {
    const tooOld = totpCode(RFC_SECRET, NOW - 2 * STEP_MS)

    expect(verifyTotp(RFC_SECRET, tooOld, NOW)).toBe(false)
  })

  it('НЕ принимает код двух шагов вперёд', () => {
    const tooNew = totpCode(RFC_SECRET, NOW + 2 * STEP_MS)

    expect(verifyTotp(RFC_SECRET, tooNew, NOW)).toBe(false)
  })

  it('с window=0 отвергает даже соседний шаг', () => {
    const previous = totpCode(RFC_SECRET, NOW - STEP_MS)

    expect(verifyTotp(RFC_SECRET, previous, NOW, 0)).toBe(false)
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, NOW), NOW, 0)).toBe(true)
  })

  it('терпит пробелы в введённом коде — аутентификатор показывает «123 456»', () => {
    const code = totpCode(RFC_SECRET, NOW)
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`

    expect(verifyTotp(RFC_SECRET, spaced, NOW)).toBe(true)
  })
})

describe('Отказы', () => {
  const NOW = 1_755_500_000_000

  it('не принимает код от чужого секрета', () => {
    const foreign = generateSecret()

    expect(verifyTotp(RFC_SECRET, totpCode(foreign, NOW), NOW)).toBe(false)
  })

  it('не принимает код неверной длины', () => {
    const code = totpCode(RFC_SECRET, NOW)

    expect(verifyTotp(RFC_SECRET, code.slice(0, 5), NOW)).toBe(false)
    expect(verifyTotp(RFC_SECRET, `${code}0`, NOW)).toBe(false)
  })

  it('не принимает пустую строку и пробелы', () => {
    expect(verifyTotp(RFC_SECRET, '', NOW)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '      ', NOW)).toBe(false)
  })

  it('не принимает нецифровой код', () => {
    // Отдельно от длины: строка из шести букв проходит проверку длины и уходила
    // бы дальше, а Number() превратил бы её в NaN.
    expect(verifyTotp(RFC_SECRET, 'abcdef', NOW)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '12345a', NOW)).toBe(false)
  })

  it('бросает на битом секрете, а не отвечает «неверный код»', () => {
    // Сознательное расхождение с verifyPin: неоткрываемый секрет админа должен
    // быть виден как ошибка, иначе вход тихо перестаёт работать навсегда.
    expect(() => verifyTotp('не-base32!', '123456', NOW)).toThrow(/Base32/)
  })
})

describe('Секрет и ссылка для QR', () => {
  it('генерирует 20 байт, то есть 32 символа Base32', () => {
    const secret = generateSecret()

    expect(secret).toHaveLength(32)
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(base32Decode(secret)).toHaveLength(20)
  })

  it('каждый раз выдаёт разный секрет', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()))

    expect(secrets.size).toBe(50)
  })

  it('собирает otpauth-ссылку с издателем и в пути, и в параметрах', () => {
    const url = otpauthUrl({
      secret: RFC_SECRET,
      account: 'admin@positive.asia',
      issuer: 'POSitive Loyalty',
    })

    expect(url.startsWith('otpauth://totp/')).toBe(true)
    // Пробел кодируется как %20, а не как «+»: аутентификатор покажет плюсы буквально.
    expect(url).toContain('otpauth://totp/POSitive%20Loyalty:admin%40positive.asia?')
    expect(url).toContain('issuer=POSitive%20Loyalty')
    expect(url).toContain(`secret=${RFC_SECRET}`)
    expect(url).toContain('algorithm=SHA1')
    expect(url).toContain('digits=6')
    expect(url).toContain('period=30')
  })

  it('кодирует символы, которые иначе разрезали бы ссылку', () => {
    const url = otpauthUrl({
      secret: RFC_SECRET,
      account: 'кассир&admin',
      issuer: 'Kata: Beach',
    })

    expect(url).not.toContain('кассир')
    expect(url).not.toContain('&admin')
    // Двоеточие в имени издателя обязано быть экранировано, иначе метка
    // разрежется не там и аутентификатор покажет чужое имя.
    expect(url).toContain('Kata%3A%20Beach:')
  })

  it('отказывается собирать ссылку без account или issuer', () => {
    expect(() => otpauthUrl({ secret: RFC_SECRET, account: '', issuer: 'POSitive' })).toThrow()
    expect(() => otpauthUrl({ secret: RFC_SECRET, account: 'admin', issuer: '   ' })).toThrow()
  })
})
