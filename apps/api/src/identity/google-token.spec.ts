import { beforeAll, describe, expect, it } from 'vitest'

import { GoogleTokenError, verifyGoogleIdToken } from './google-token'

/**
 * Проверки токена Google.
 *
 * ЗАЧЕМ ОНИ ИМЕННО ТАКИЕ. Почти всё здесь — это отказы. Успешный вход проверить
 * легко и почти бесполезно: он и так работает, иначе бы никто не вошёл.
 * Ломается вход наоборот — когда принимается токен, который принимать нельзя,
 * и об этом никто не узнаёт, потому что система при этом ведёт себя нормально.
 *
 * Токены подписываются своим ключом, а не берутся у Google. Иначе половину
 * случаев не воспроизвести вовсе: Google не выдаёт ни просроченных токенов,
 * ни выписанных чужому приложению.
 *
 * ПОЧЕМУ ИМПОРТ ВНУТРИ beforeAll. `jose` — модуль нового формата, а пакет
 * собирается в старом. Обычный импорт здесь не проходит проверку типов; тот же
 * приём применён и в самом `google-token.ts`.
 */

const importJose = () => import('jose')

type Jose = Awaited<ReturnType<typeof importJose>>
type PrivateKey = Awaited<ReturnType<Jose['generateKeyPair']>>['privateKey']

const OUR_CLIENT = '440017639472-test.apps.googleusercontent.com'
const GOOGLE = 'https://accounts.google.com'

let jose: Jose
let privateKey: PrivateKey
let keys: ReturnType<Jose['createLocalJWKSet']>
/** Ключ, которого Google не знает: им подписывается «поддельный» токен. */
let strangerKey: PrivateKey

interface TokenOptions {
  readonly audience?: string
  readonly issuer?: string
  readonly expiresIn?: string
  readonly email?: string | null
  readonly emailVerified?: boolean
  readonly name?: string
  readonly subject?: string
  readonly signWith?: PrivateKey
}

const makeToken = async (options: TokenOptions = {}): Promise<string> => {
  const claims: Record<string, unknown> = { sub: options.subject ?? 'google-user-1' }

  if (options.email !== null) {
    claims['email'] = options.email ?? 'guest@example.com'
    claims['email_verified'] = options.emailVerified ?? true
  }

  if (options.name !== undefined) claims['name'] = options.name

  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(options.issuer ?? GOOGLE)
    .setAudience(options.audience ?? OUR_CLIENT)
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.signWith ?? privateKey)
}

beforeAll(async () => {
  jose = await importJose()

  const pair = await jose.generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey

  const publicJwk = await jose.exportJWK(pair.publicKey)
  keys = jose.createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256' }] })

  const stranger = await jose.generateKeyPair('RS256', { extractable: true })
  strangerKey = stranger.privateKey
})

describe('Токен Google', () => {
  it('принимает свой токен и отдаёт идентификатор аккаунта', async () => {
    const account = await verifyGoogleIdToken(await makeToken(), OUR_CLIENT, keys)

    expect(account.externalId).toBe('google-user-1')
    expect(account.email).toBe('guest@example.com')
  })

  it('ОТВЕРГАЕТ токен, выписанный для чужого приложения', async () => {
    // Самая опасная из пропущенных проверок: без неё годится любой токен
    // Google, выданный любому другому сайту, — то есть вход ломается целиком,
    // а выглядит всё работающим.
    const foreign = await makeToken({ audience: 'кто-то-другой.apps.googleusercontent.com' })

    await expect(verifyGoogleIdToken(foreign, OUR_CLIENT, keys)).rejects.toThrow(GoogleTokenError)
  })

  it('ОТВЕРГАЕТ токен, подписанный не ключом Google', async () => {
    const forged = await makeToken({ signWith: strangerKey })

    await expect(verifyGoogleIdToken(forged, OUR_CLIENT, keys)).rejects.toThrow(GoogleTokenError)
  })

  it('ОТВЕРГАЕТ токен от чужого выпускающего', async () => {
    const wrongIssuer = await makeToken({ issuer: 'https://accounts.example.com' })

    await expect(verifyGoogleIdToken(wrongIssuer, OUR_CLIENT, keys)).rejects.toThrow(
      GoogleTokenError,
    )
  })

  it('ОТВЕРГАЕТ просроченный токен', async () => {
    // Допуск на расхождение часов — минута, поэтому берём заведомо больше.
    const expired = await makeToken({ expiresIn: '-10m' })

    await expect(verifyGoogleIdToken(expired, OUR_CLIENT, keys)).rejects.toThrow(GoogleTokenError)
  })

  it('ОТВЕРГАЕТ обрывок вместо токена', async () => {
    await expect(verifyGoogleIdToken('не-токен', OUR_CLIENT, keys)).rejects.toThrow(
      GoogleTokenError,
    )
  })

  it('ОТКАЗЫВАЕТСЯ работать, если наш Client ID не задан', async () => {
    // Пустой `aud` в проверке означал бы «подойдёт любой токен Google».
    // Лучше выключенный вход, чем открытый.
    await expect(verifyGoogleIdToken(await makeToken(), '', keys)).rejects.toThrow(GoogleTokenError)
  })

  it('не берёт неподтверждённую почту: по ней можно присвоить чужую карту', async () => {
    // Карты разных способов входа склеиваются по почте. Если принять
    // неподтверждённую, достаточно назваться чужим адресом, чтобы получить
    // чужие баллы. Вход при этом состоится — но уже как новый гость.
    const unverified = await makeToken({ email: 'чужой@example.com', emailVerified: false })

    const account = await verifyGoogleIdToken(unverified, OUR_CLIENT, keys)

    expect(account.externalId).toBe('google-user-1')
    expect(account.email).toBeNull()
  })

  it('приводит почту к нижнему регистру: склейка не должна зависеть от написания', async () => {
    const shouty = await makeToken({ email: 'Guest@Example.COM' })

    const account = await verifyGoogleIdToken(shouty, OUR_CLIENT, keys)

    expect(account.email).toBe('guest@example.com')
  })

  it('переживает токен без почты и без имени', async () => {
    const bare = await makeToken({ email: null })

    const account = await verifyGoogleIdToken(bare, OUR_CLIENT, keys)

    expect(account.email).toBeNull()
    expect(account.displayName).toBeNull()
  })
})
