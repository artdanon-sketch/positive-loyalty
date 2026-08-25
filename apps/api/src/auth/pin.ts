import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * promisify выбирает трёхаргументную перегрузку scrypt и теряет параметр options.
 * Сужаем вручную: без options стоимость осталась бы дефолтной, то есть заметно
 * ниже выбранной, и об этом никто бы не узнал — тип совпал бы.
 */
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

/**
 * Хеширование PIN.
 *
 * ПОЧЕМУ scrypt, А НЕ argon2id. docs/05, раздел 2 называет argon2id — но для
 * ПАРОЛЕЙ владельца, если они когда-нибудь появятся. Здесь другой случай:
 * argon2 тянет нативную сборку, а scrypt встроен в Node и не добавляет
 * зависимости с бинарём в цепочку поставки. Для четырёхзначного PIN разница
 * между двумя добротными KDF несущественна — см. следующий абзац.
 *
 * ЧЕСТНО ПРО СТОЙКОСТЬ. У четырёх цифр десять тысяч вариантов. Никакой KDF
 * этого не исправляет: перебор офлайн по украденной базе занимает минуты при
 * любых параметрах. PIN защищают три другие вещи, и они обязательны:
 *   1. привязка к зарегистрированному устройству — без него PIN бесполезен;
 *   2. блокировка после серии неудач (pinFailedAttempts, pinLockedUntil);
 *   3. область действия: кассир не может ни править баланс, ни видеть финансы.
 * Хеш здесь нужен, чтобы утечка базы не отдала PIN'ы открытым текстом,
 * а не чтобы сделать их неперебираемыми. Обещать второе было бы обманом.
 */

/** N=16384 — компромисс: около 60 мс на вход, заметно для перебора, незаметно кассиру. */
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16

/** Формат хранения: параметры внутри строки, чтобы их можно было менять без миграции данных. */
const PREFIX = 'scrypt'

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scrypt(pin.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  })

  return [
    PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Проверяет PIN против хранимого хеша.
 *
 * Сравнение через `timingSafeEqual`: обычное `===` завершается на первом
 * несовпавшем байте, и по времени ответа восстанавливается хеш побайтно.
 * Возвращает false на любом повреждённом хеше, не бросая: битая строка в базе
 * не должна превращаться в 500 на экране кассы.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false
  }

  const [, costRaw, blockRaw, parallelRaw, saltRaw, hashRaw] = parts
  const cost = Number(costRaw)
  const blockSize = Number(blockRaw)
  const parallelization = Number(parallelRaw)

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization)
  ) {
    return false
  }

  let expected: Buffer
  let actual: Buffer

  try {
    expected = Buffer.from(hashRaw ?? '', 'base64url')
    actual = await scrypt(
      pin.normalize('NFKC'),
      Buffer.from(saltRaw ?? '', 'base64url'),
      expected.length,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
      },
    )
  } catch {
    return false
  }

  if (expected.length === 0 || expected.length !== actual.length) {
    return false
  }

  return timingSafeEqual(expected, actual)
}
