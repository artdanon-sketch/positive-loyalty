import { randomInt, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { parseProgramConfig } from '@positive/contracts'
import type { ProgramConfig } from '@positive/contracts'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module'
import { signAccessToken, signGuestToken } from '../../src/common/tenant/access-token'
import { LedgerService } from '../../src/core/ledger.service'
import {
  MEMBERSHIP_RULES_SELECT,
  MembershipRulesService,
} from '../../src/core/membership-rules.service'
import { PrismaService } from '../../src/core/prisma.service'
import type { Prisma } from '../../src/generated/prisma/client'

import {
  createMembershipFixture,
  createTenant,
  idempotencyKey,
  POS_ORIGIN,
  readBalance,
} from './ledger-test-context'
import type { MembershipFixture } from './ledger-test-context'

/**
 * Приглашения друзей. docs/02, разделы 2.5 и 5.6.2 · docs/11, У6 · docs/05, раздел 6.2.
 *
 * Полигон: заведение с включёнными приглашениями (награда 50 ฿, лимит — одна награда),
 * пригласивший и два друга, которые ещё не гости заведения. У соседнего заведения —
 * свой пригласивший со своим кодом. Соседний код — ловушка: он настоящий, но в нашем
 * заведении не открывает ничего.
 */

const SECRET = 'referral-secret-not-used-anywhere-else'
const REWARD = 5_000

let app: INestApplication
let prisma: PrismaService
let rules: MembershipRulesService
let ledger: LedgerService
let inviter: MembershipFixture
let neighbour: MembershipFixture
let friendId: string
let secondFriendId: string
let ownerToken: string
let managerToken: string

const server = (): Server => app.getHttpServer() as Server

interface ReferralBody {
  enabled: boolean
  code: string | null
  reward: number
  limit: number
  invited: number
  rewarded: number
}

interface ErrorBody {
  error: { code: string }
}

const guestToken = (guestId: string): string => signGuestToken({ guestId }, SECRET)

const getReferral = (tenantId: string, guestId: string) =>
  request(server())
    .get(`/v1/guest/venues/${tenantId}/referral`)
    .set('Authorization', `Bearer ${guestToken(guestId)}`)

const accept = (tenantId: string, guestId: string, code: string) =>
  request(server())
    .post(`/v1/guest/venues/${tenantId}/referral/accept`)
    .set('Authorization', `Bearer ${guestToken(guestId)}`)
    .send({ code })

const inviterCode = async (): Promise<string> => {
  const body = (await getReferral(inviter.tenantId, inviter.guestId)).body as ReferralBody
  return body.code ?? ''
}

const createGuest = async (): Promise<string> => {
  const guest = await prisma.guest.create({
    data: { phoneE164: `+66${String(randomInt(100_000_000, 999_999_999))}`, locale: 'ru' },
    select: { id: true },
  })

  return guest.id
}

const writeSettings = async (tenantId: string, settings: Prisma.InputJsonObject): Promise<void> => {
  await prisma.forTenant(tenantId, async (tx) =>
    tx.tenant.update({ where: { id: tenantId }, data: { settings } }),
  )
}

const REFERRAL_ON = { referral: { enabled: true, reward: REWARD, limit: 1 } }

const readConfig = async (): Promise<ProgramConfig> => {
  const tenant = await prisma.forTenant(inviter.tenantId, async (tx) =>
    tx.tenant.findFirstOrThrow({ where: { id: inviter.tenantId }, select: { settings: true } }),
  )

  return parseProgramConfig(tenant.settings)
}

const friendSnapshot = async (guestId: string) =>
  prisma.forTenant(inviter.tenantId, async (tx) =>
    tx.membership.findFirstOrThrow({
      where: { tenantId: inviter.tenantId, guestId },
      select: MEMBERSHIP_RULES_SELECT,
    }),
  )

const card = (guestId: string) =>
  request(server())
    .get(`/v1/admin/guests/${guestId}`)
    .set('Authorization', `Bearer ${managerToken}`)

beforeAll(async () => {
  process.env['ACCESS_TOKEN_SECRET'] = SECRET

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  app = moduleRef.createNestApplication()
  app.setGlobalPrefix('v1', { exclude: ['health'] })
  await app.init()

  prisma = moduleRef.get(PrismaService)
  rules = moduleRef.get(MembershipRulesService)
  ledger = moduleRef.get(LedgerService)

  const tenantId = await createTenant(prisma)
  await writeSettings(tenantId, REFERRAL_ON)
  inviter = await createMembershipFixture(prisma, { tenantId })

  neighbour = await createMembershipFixture(prisma)
  await writeSettings(neighbour.tenantId, REFERRAL_ON)

  friendId = await createGuest()
  secondFriendId = await createGuest()

  ownerToken = signAccessToken({ tenantId, actorId: null, role: 'OWNER' }, SECRET)
  managerToken = signAccessToken({ tenantId, actorId: null, role: 'MANAGER' }, SECRET)
})

afterAll(async () => {
  await app.close()
})

describe('Пригласить друга: код', () => {
  it('ГОСТЬ ПОЛУЧАЕТ СВОЙ КОД, И ОТ ОТКРЫТИЯ К ОТКРЫТИЮ ОН НЕ МЕНЯЕТСЯ', async () => {
    const first = await getReferral(inviter.tenantId, inviter.guestId)

    expect(first.status).toBe(200)
    const body = first.body as ReferralBody
    expect(body).toMatchObject({ enabled: true, reward: REWARD, limit: 1, invited: 0, rewarded: 0 })
    expect(body.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)

    const second = await getReferral(inviter.tenantId, inviter.guestId)
    expect((second.body as ReferralBody).code).toBe(body.code)
  })

  it('не гость заведения кода не получит — и гость соседнего, подставивший наш адрес, тоже', async () => {
    expect((await getReferral(inviter.tenantId, friendId)).status).toBe(404)
    expect((await getReferral(inviter.tenantId, neighbour.guestId)).status).toBe(404)
  })
})

describe('Пригласить друга: вступление', () => {
  it('ДРУГ ПО ССЫЛКЕ СТАНОВИТСЯ ГОСТЕМ «ПО ПРИГЛАШЕНИЮ» — БАЛЛОВ ПРИ ЭТОМ НИКТО НЕ ПОЛУЧАЕТ', async () => {
    const response = await accept(inviter.tenantId, friendId, (await inviterCode()).toLowerCase())

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ tenantId: inviter.tenantId, joined: true })

    const membership = await prisma.forTenant(inviter.tenantId, async (tx) =>
      tx.membership.findFirstOrThrow({
        where: { tenantId: inviter.tenantId, guestId: friendId },
        select: { source: true, referredById: true },
      }),
    )

    expect(membership).toEqual({ source: 'REFERRAL', referredById: inviter.membershipId })
    // Награда дозревает покупкой, а не вступлением.
    expect(await readBalance(prisma, inviter.membershipId)).toBe(0)
  })

  it('повторное вступление ничего не меняет', async () => {
    const response = await accept(inviter.tenantId, friendId, await inviterCode())

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ joined: false })
  })

  it('СВОЯ ССЫЛКА НА СЕБЯ НЕ РАБОТАЕТ', async () => {
    const response = await accept(inviter.tenantId, inviter.guestId, await inviterCode())

    expect(response.status).toBe(409)
    expect((response.body as ErrorBody).error.code).toBe('SELF_REFERRAL')
  })

  it('КОД СОСЕДНЕГО ЗАВЕДЕНИЯ, ВЫДУМАННЫЙ КОД И КОД НЕ ПО ФОРМЕ НЕ ОТКРЫВАЮТ НИЧЕГО', async () => {
    const code = await inviterCode()
    const neighbourCode =
      ((await getReferral(neighbour.tenantId, neighbour.guestId)).body as ReferralBody).code ?? ''

    const cross = await accept(inviter.tenantId, secondFriendId, neighbourCode)
    expect(cross.status).toBe(404)
    expect((cross.body as ErrorBody).error.code).toBe('INVITE_NOT_FOUND')

    // Наш настоящий код под адресом соседнего заведения.
    expect((await accept(neighbour.tenantId, secondFriendId, code)).status).toBe(404)
    expect((await accept(inviter.tenantId, secondFriendId, 'ZZZZ2222')).status).toBe(404)
    expect((await accept(inviter.tenantId, secondFriendId, 'IO01')).status).toBe(400)

    const memberships = await prisma.forTenant(inviter.tenantId, async (tx) =>
      tx.membership.count({ where: { tenantId: inviter.tenantId, guestId: secondFriendId } }),
    )
    expect(memberships).toBe(0)
  })

  it('выключили приглашения — ссылка больше не действует, а у гостя нет кода', async () => {
    const code = await inviterCode()
    await writeSettings(inviter.tenantId, { referral: { enabled: false, reward: 0, limit: 1 } })

    try {
      const response = await accept(inviter.tenantId, secondFriendId, code)
      expect(response.status).toBe(404)
      expect((response.body as ErrorBody).error.code).toBe('INVITE_NOT_FOUND')

      const body = (await getReferral(inviter.tenantId, inviter.guestId)).body as ReferralBody
      expect(body).toMatchObject({ enabled: false, code: null, invited: 1 })
    } finally {
      await writeSettings(inviter.tenantId, REFERRAL_ON)
    }
  })
})

describe('Награда за друга', () => {
  it('НАГРАДА ПРИХОДИТ ЗА ПЕРВУЮ ПОКУПКУ ДРУГА — РОВНО ОДИН РАЗ', async () => {
    const program = await readConfig()
    const friend = await friendSnapshot(friendId)

    await rules.grantReferral(inviter.tenantId, friend, program)
    await rules.grantReferral(inviter.tenantId, friend, program)

    expect(await readBalance(prisma, inviter.membershipId)).toBe(REWARD)

    const entry = await prisma.forTenant(inviter.tenantId, async (tx) =>
      tx.ledgerEntry.findFirstOrThrow({
        where: {
          tenantId: inviter.tenantId,
          membershipId: inviter.membershipId,
          refType: 'referral',
        },
        select: { type: true, refId: true, idempotencyKey: true },
      }),
    )

    expect(entry).toEqual({
      type: 'GRANT',
      refId: friend.id,
      idempotencyKey: `referral:${friend.id}`,
    })
  })

  it('СВЕРХ ЛИМИТА НАГРАДЫ НЕТ, ХОТЯ ДРУГ ПРИШЁЛ ПО ССЫЛКЕ', async () => {
    const joined = await accept(inviter.tenantId, secondFriendId, await inviterCode())
    expect(joined.body).toMatchObject({ joined: true })

    await rules.grantReferral(
      inviter.tenantId,
      await friendSnapshot(secondFriendId),
      await readConfig(),
    )

    expect(await readBalance(prisma, inviter.membershipId)).toBe(REWARD)

    const body = (await getReferral(inviter.tenantId, inviter.guestId)).body as ReferralBody
    expect(body).toMatchObject({ invited: 2, rewarded: 1 })
  })

  it('у друга уже есть визиты — это не первая покупка, награды нет', async () => {
    const program = await readConfig()
    const roomy = { ...program, referral: { ...program.referral, limit: 10 } }

    await rules.grantReferral(
      inviter.tenantId,
      { ...(await friendSnapshot(secondFriendId)), visitsTotal: 1 },
      roomy,
    )

    expect(await readBalance(prisma, inviter.membershipId)).toBe(REWARD)
  })
})

describe('Статус «привёл друзей»', () => {
  it('ДРУГ БЕЗ ПОКУПКИ СТАТУСА НЕ ПОДНИМАЕТ, КУПИВШИЙ — ПОДНИМАЕТ СРАЗУ', async () => {
    await writeSettings(inviter.tenantId, {
      ...REFERRAL_ON,
      tiers: [
        { id: 'guest', name: 'Гость', earnRate: 5, redeemRate: 20, hidden: false, conditions: [] },
        {
          id: 'ambassador',
          name: 'Амбассадор',
          earnRate: 10,
          redeemRate: 50,
          hidden: false,
          conditions: [{ type: 'REFERRALS', gt: 0 }],
        },
      ],
    })

    const cardTier = async (): Promise<string | null> =>
      ((await card(inviter.guestId)).body as { tier: { id: string } | null }).tier?.id ?? null

    // Два друга пришли по ссылке, но ни один ещё ничего не купил.
    expect(await cardTier()).toBe('guest')

    const friend = await friendSnapshot(friendId)

    await ledger.earn(
      {
        membershipId: friend.id,
        amount: 500,
        basisAmount: 10_000,
        idempotencyKey: idempotencyKey('referral-friend-first-check'),
        refType: 'receipt',
        refId: `ref-${randomUUID().slice(0, 8)}`,
        ...POS_ORIGIN,
      },
      { tenantId: inviter.tenantId },
    )
    await rules.refreshInviterTier(inviter.tenantId, friend, await readConfig())

    expect(await cardTier()).toBe('ambassador')

    const stored = await prisma.forTenant(inviter.tenantId, async (tx) =>
      tx.membership.findFirstOrThrow({
        where: { id: inviter.membershipId, tenantId: inviter.tenantId },
        select: { tierId: true },
      }),
    )
    expect(stored.tierId).toBe('ambassador')
  })
})

describe('Приглашения в бэк-офисе', () => {
  const putReferral = (token: string, body: Record<string, unknown>) =>
    request(server())
      .put('/v1/admin/settings/program/referral')
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  it('ВЛАДЕЛЕЦ МЕНЯЕТ НАГРАДУ — СТАТУСЫ В НАСТРОЙКАХ ОСТАЮТСЯ НА МЕСТЕ', async () => {
    const saved = await putReferral(ownerToken, { enabled: true, reward: 7_000, limit: 3 })

    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ enabled: true, reward: 7_000, limit: 3 })

    const read = await request(server())
      .get('/v1/admin/settings/program/referral')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(read.body).toEqual({ enabled: true, reward: 7_000, limit: 3 })

    const tiers = await request(server())
      .get('/v1/admin/settings/program/tiers')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect((tiers.body as { tiers: Array<{ id: string }> }).tiers.map((tier) => tier.id)).toEqual([
      'guest',
      'ambassador',
    ])
  })

  it('включённая награда в ноль — 400; менеджеру настройки приглашений закрыты — 403', async () => {
    expect((await putReferral(ownerToken, { enabled: true, reward: 0, limit: 3 })).status).toBe(400)
    expect(
      (
        await request(server())
          .get('/v1/admin/settings/program/referral')
          .set('Authorization', `Bearer ${managerToken}`)
      ).status,
    ).toBe(403)
  })

  it('КАРТОЧКА: КТО ПРИВЁЛ ГОСТЯ, СКОЛЬКИХ ПРИВЁЛ ОН И ЗА СКОЛЬКИХ ПОЛУЧИЛ БАЛЛЫ', async () => {
    const friendCard = await card(friendId)
    expect(friendCard.status).toBe(200)
    expect((friendCard.body as { referral: unknown }).referral).toEqual({
      invitedBy: { guestId: inviter.guestId, displayName: null },
      invited: 0,
      rewarded: 0,
    })

    const inviterCard = await card(inviter.guestId)
    expect((inviterCard.body as { referral: unknown }).referral).toEqual({
      invitedBy: null,
      invited: 2,
      rewarded: 1,
    })
  })
})
