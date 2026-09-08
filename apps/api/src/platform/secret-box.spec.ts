import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { keyFromEnv, openSecret, sealSecret } from './secret-box'

/**
 * Шифрование TOTP-секретов. Проверяется отдельно от базы: здесь ловятся ровно те
 * два провала, которые в проде не видно вообще. Первый — детерминированное
 * шифрование: одинаковые секреты дают одинаковые строки, и по дампу базы читается,
 * у кого второй фактор совпадает. Второй — тихая порча: расшифровка отдаёт мусор
 * вместо ошибки, и админ месяцами получает «неверный код» без объяснений.
 */

const KEY = randomBytes(32)
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

/**
 * Портит одну из трёх частей запечатанной строки, оставляя её валидным base64
 * той же длины: так проверяется именно проверка тега, а не разбор формата.
 */
const corruptPart = (sealed: string, index: 1 | 2 | 3): string => {
  const parts = sealed.split('.')
  const raw = parts[index]
  if (raw === undefined) {
    throw new Error('в запечатанной строке нет такой части — сломался формат, а не тест')
  }

  const bytes = Buffer.from(raw, 'base64')
  bytes.writeUInt8(bytes.readUInt8(0) ^ 0b1, 0)
  parts[index] = bytes.toString('base64')

  return parts.join('.')
}

describe('sealSecret / openSecret', () => {
  it('возвращает исходную строку', () => {
    expect(openSecret(sealSecret(SECRET, KEY), KEY)).toBe(SECRET)
  })

  it('переживает не-ASCII и пустую строку', () => {
    // Пустой секрет бессмысленен по сути, но шифрование не должно на нём падать:
    // падение здесь превратилось бы в 500 на пустом поле формы.
    for (const plaintext of ['', 'Sabai Thai Massage — спа', '🔐']) {
      expect(openSecret(sealSecret(plaintext, KEY), KEY)).toBe(plaintext)
    }
  })

  it('пишется в формате gcm.<iv>.<tag>.<ciphertext>', () => {
    const parts = sealSecret(SECRET, KEY).split('.')

    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('gcm')
    expect(Buffer.from(parts[1] ?? '', 'base64')).toHaveLength(12)
    expect(Buffer.from(parts[2] ?? '', 'base64')).toHaveLength(16)
  })

  it('даёт РАЗНЫЕ строки для одного и того же секрета', () => {
    // Главная проверка файла. Совпадающие шифротексты означают, что по дампу
    // базы видно, у кого секреты одинаковые, — и что IV где-то стал константой.
    const sealed = Array.from({ length: 20 }, () => sealSecret(SECRET, KEY))

    expect(new Set(sealed).size).toBe(20)
    for (const one of sealed) {
      expect(openSecret(one, KEY)).toBe(SECRET)
    }
  })

  it('не открывается чужим ключом', () => {
    expect(() => openSecret(sealSecret(SECRET, KEY), randomBytes(32))).toThrow(
      /не удалось расшифровать/,
    )
  })

  it('отказывает на порче IV', () => {
    expect(() => openSecret(corruptPart(sealSecret(SECRET, KEY), 1), KEY)).toThrow()
  })

  it('отказывает на порче тега', () => {
    expect(() => openSecret(corruptPart(sealSecret(SECRET, KEY), 2), KEY)).toThrow()
  })

  it('отказывает на порче шифротекста — а не отдаёт другой секрет', () => {
    expect(() => openSecret(corruptPart(sealSecret(SECRET, KEY), 3), KEY)).toThrow()
  })

  it('отказывает на обрезанной и на неизвестной записи', () => {
    const sealed = sealSecret(SECRET, KEY)

    expect(() => openSecret(sealed.split('.').slice(0, 3).join('.'), KEY)).toThrow(/формат/)
    expect(() => openSecret(`aes.${sealed.split('.').slice(1).join('.')}`, KEY)).toThrow(/формат/)
    expect(() => openSecret('', KEY)).toThrow(/формат/)
    expect(() => openSecret(SECRET, KEY)).toThrow(/формат/)
  })

  it('отказывает на IV и теге неверной длины', () => {
    const [, , tag, ciphertext] = sealSecret(SECRET, KEY).split('.')

    expect(() =>
      openSecret(`gcm.${randomBytes(11).toString('base64')}.${tag}.${ciphertext}`, KEY),
    ).toThrow(/повреждена/)
  })

  it('не пропускает ключ неверной длины ни в одну сторону', () => {
    // Иначе createCipheriv упал бы своим сообщением про длину ключа —
    // понятным Node, но не тому, кто читает лог деплоя.
    expect(() => sealSecret(SECRET, randomBytes(16))).toThrow(/32 байт/)
    expect(() => openSecret(sealSecret(SECRET, KEY), randomBytes(16))).toThrow(/32 байт/)
  })

  it('не показывает содержимое секрета в тексте ошибки', () => {
    // Текст исключения уходит в лог; секрету там не место (CLAUDE.md, правило 5).
    try {
      openSecret(sealSecret(SECRET, KEY), randomBytes(32))
      expect.unreachable('расшифровка чужим ключом обязана бросить')
    } catch (error) {
      expect(String(error)).not.toContain(SECRET)
    }
  })
})

describe('keyFromEnv', () => {
  it('принимает 32 байта в base64', () => {
    const raw = randomBytes(32).toString('base64')

    expect(keyFromEnv(raw).toString('base64')).toBe(raw)
  })

  it('терпит перевод строки вокруг значения', () => {
    // `openssl rand -base64 32` копируют вместе с переносом, и падать на этом —
    // час чужого времени на пустом месте.
    const raw = randomBytes(32).toString('base64')

    expect(keyFromEnv(` ${raw}\n`).toString('base64')).toBe(raw)
  })

  it('падает, если переменная не задана или пуста', () => {
    // Имя переменной в сообщении не для красоты: без него человек, увидевший
    // падение на деплое, идёт искать по всему репозиторию, что именно не задано.
    expect(() => keyFromEnv(undefined)).toThrow(/PLATFORM_TOTP_ENC_KEY/)
    expect(() => keyFromEnv('')).toThrow(/PLATFORM_TOTP_ENC_KEY/)
    expect(() => keyFromEnv('   ')).toThrow(/PLATFORM_TOTP_ENC_KEY/)
  })

  it('падает на ключе не той длины и говорит, сколько получилось', () => {
    expect(() => keyFromEnv(randomBytes(16).toString('base64'))).toThrow(/16/)
    expect(() => keyFromEnv(randomBytes(64).toString('base64'))).toThrow(/64/)
    // hex вместо base64 — частая подмена: 64 hex-символа декодируются как base64
    // в 48 байт и молча прошли бы, не будь проверки длины.
    expect(() => keyFromEnv(randomBytes(32).toString('hex'))).toThrow(/32 байт/)
  })

  it('не показывает сам ключ в сообщении об ошибке', () => {
    const raw = randomBytes(16).toString('base64')

    try {
      keyFromEnv(raw)
      expect.unreachable('короткий ключ обязан быть отвергнут')
    } catch (error) {
      expect(String(error)).not.toContain(raw)
    }
  })
})
