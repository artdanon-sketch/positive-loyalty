import { createHash, randomBytes } from 'node:crypto'

import { Test, type TestingModule } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/core/prisma.service'
import { TelegramLoginService } from '../../src/identity/telegram-login.service'
import type { TelegramLoginApproval, TelegramStart } from '../../src/identity/telegram-api'

/**
 * Вход через Telegram-бота: «Запустить» не подтверждает вход, подтверждает
 * только кнопка «Это я, войти» от того же человека.
 *
 * Сценарий атаки, ради которого это сделано: злоумышленник начинает вход у себя
 * (у него секрет попытки), шлёт ссылку гостю, гость жмёт «Запустить». Раньше
 * этого хватало, чтобы сессия карты гостя досталась злоумышленнику.
 */

const hash = (token: string): string => createHash('sha256').update(token).digest('hex')

let moduleRef: TestingModule
let prisma: PrismaService
let login: TelegramLoginService

const VICTIM = '9100000001'
const OTHER = '9100000002'

/** Попытка входа, начатая «злоумышленником»: секрет — у него. */
const newAttempt = async (): Promise<{ nonce: string; id: string }> => {
  const nonce = randomBytes(24).toString('base64url')
  const row = await prisma.telegramLoginRequest.create({
    data: {
      nonceHash: hash(nonce),
      claimSecretHash: hash(randomBytes(32).toString('base64url')),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
    select: { id: true },
  })
  return { nonce, id: row.id }
}

const start = (userId: string, payload: string | null): TelegramStart => ({
  updateId: 1,
  userId,
  chatId: userId,
  displayName: 'Гость',
  locale: 'ru',
  payload,
})

const press = (userId: string, nonce: string): TelegramLoginApproval => ({
  updateId: 2,
  callbackId: 'cb',
  userId,
  chatId: userId,
  messageId: 1,
  nonce,
})

const confirmedAt = async (id: string): Promise<Date | null> =>
  (
    await prisma.telegramLoginRequest.findUniqueOrThrow({
      where: { id },
      select: { confirmedAt: true },
    })
  ).confirmedAt

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  prisma = moduleRef.get(PrismaService)
  login = moduleRef.get(TelegramLoginService)
})

afterAll(async () => {
  await moduleRef.close()
})

describe('Вход через Telegram: подтверждение кнопкой', () => {
  it('«ЗАПУСТИТЬ» ПО ЧУЖОЙ ССЫЛКЕ НЕ ПОДТВЕРЖДАЕТ ВХОД — ГОСТЬ ВИДИТ ПРЕДУПРЕЖДЕНИЕ И КНОПКУ', async () => {
    const attempt = await newAttempt()

    const reply = await login.confirm(start(VICTIM, attempt.nonce))

    expect(reply.approveData).toBe(`login:${attempt.nonce}`)
    expect(reply.text).toContain('ничего не нажимайте')
    expect(await confirmedAt(attempt.id)).toBeNull()
  })

  it('КНОПКУ ПРИНИМАЕМ ТОЛЬКО ОТ ТОГО, КТО ОТКРЫЛ ССЫЛКУ', async () => {
    const attempt = await newAttempt()
    await login.confirm(start(VICTIM, attempt.nonce))

    const foreign = await login.approve(press(OTHER, attempt.nonce))
    expect(foreign).toContain('устарела')
    expect(await confirmedAt(attempt.id)).toBeNull()

    const own = await login.approve(press(VICTIM, attempt.nonce))
    expect(own).toContain('Готово')
    expect(await confirmedAt(attempt.id)).not.toBeNull()
  })

  it('ВТОРОЙ «ЗАПУСТИТЬ» ПО ТОЙ ЖЕ ССЫЛКЕ ПОПЫТКУ НЕ ПЕРЕХВАТЫВАЕТ', async () => {
    const attempt = await newAttempt()
    await login.confirm(start(VICTIM, attempt.nonce))

    const second = await login.confirm(start(OTHER, attempt.nonce))

    expect(second.approveData).toBeNull()
    const row = await prisma.telegramLoginRequest.findUniqueOrThrow({
      where: { id: attempt.id },
      select: { telegramUserId: true },
    })
    expect(row.telegramUserId).toBe(VICTIM)
  })

  it('КНОПКУ БЕЗ «ЗАПУСТИТЬ» И ПОВТОРНОЕ НАЖАТИЕ НЕ ПРИНИМАЕМ', async () => {
    const fresh = await newAttempt()
    expect(await login.approve(press(VICTIM, fresh.nonce))).toContain('устарела')

    await login.confirm(start(VICTIM, fresh.nonce))
    expect(await login.approve(press(VICTIM, fresh.nonce))).toContain('Готово')
    expect(await login.approve(press(VICTIM, fresh.nonce))).toContain('устарела')
  })

  it('БОТ, ОТКРЫТЫЙ БЕЗ ССЫЛКИ, ПРОСТО ОБЪЯСНЯЕТ, КАК ВОЙТИ', async () => {
    const reply = await login.confirm(start(VICTIM, null))
    expect(reply.approveData).toBeNull()
  })
})
