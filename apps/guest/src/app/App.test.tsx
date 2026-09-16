import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dictionaries } from '../shared/i18n/dictionaries'
import { App } from './App'

/**
 * Гостевое приложение: вход по коду → карта с кошельком и QR.
 *
 * Сервер подменяется на уровне fetch: компонентные тесты проверяют экран,
 * а контракт API исчерпывающе проверяют интеграционные тесты API.
 */

const t = (key: keyof typeof dictionaries.ru): string => dictionaries.ru[key]

const OTP_RESPONSE = {
  requestId: '11111111-1111-4111-8111-111111111111',
  expiresIn: 300,
  resendAfter: 60,
  devCode: '123456',
}

const AUTH_RESPONSE = {
  accessToken: 'guest-access-token',
  refreshToken: 'guest-refresh-token',
  expiresIn: 900,
  guest: {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: null,
    mode: 'TOURIST',
    locale: 'ru',
  },
  isNew: true,
}

// Два заведения с РАЗНЫМИ суммами: итог кошелька не должен совпадать
// ни с одной строкой, иначе поиск по тексту находит несколько элементов
// и тест падает на собственных данных, а не на коде.
const WALLET_RESPONSE = {
  totalPoints: 42_500,
  memberships: [
    {
      tenantId: '33333333-3333-4333-8333-333333333333',
      brandName: 'Kata Beach Kitchen',
      points: 30_175,
      visitsTotal: 4,
      lastVisitAt: '2026-08-26T10:00:00.000Z',
      isControlGroup: false,
      tier: { name: 'Свой' },
      nextTier: { name: 'Золото', spentLeft: 250_000, visitsLeft: 3 },
      inviteReward: 5_000,
    },
    {
      tenantId: '44444444-4444-4444-8444-444444444444',
      brandName: 'Sabai Thai Massage',
      points: 12_325,
      visitsTotal: 0,
      lastVisitAt: null,
      isControlGroup: true,
      tier: null,
      nextTier: null,
      // Группа сравнения: за её друзей баллов не будет — и кнопки «Пригласить» нет.
      inviteReward: null,
    },
  ],
  vouchers: [
    {
      grantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      offerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: '33333333-3333-4333-8333-333333333333',
      venue: 'Kata Beach Kitchen',
      title: 'Ролл Филадельфия в подарок',
      code: 'KATA-200-9K2P',
      expiresAt: '2026-09-20T23:59:59.000Z',
      expiresInDays: 9,
      howTo: ['Закажите на 800 ฿ или больше', 'Покажите код кассиру'],
    },
    {
      grantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      offerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      tenantId: '44444444-4444-4444-8444-444444444444',
      venue: 'Sabai Thai Massage',
      title: null,
      code: 'SABAI-1DAY',
      expiresAt: '2026-09-12T23:59:59.000Z',
      expiresInDays: 0,
      howTo: [],
    },
  ],
}

/** Кошелёк без подарков — обычное состояние: партнёрств у заведения может не быть. */
const WALLET_WITHOUT_VOUCHERS = { ...WALLET_RESPONSE, vouchers: [] }

const QR_RESPONSE = { token: 'guest-qr-token', expiresIn: 300 }

/** Профиль: день рождения уже указан — вопроса на карте нет, остальные тесты его не видят. */
const ME_RESPONSE = {
  ...AUTH_RESPONSE.guest,
  phoneMasked: '+66 •• •• 5678',
  birthday: '1990-09-17',
}

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const pathOf = (input: RequestInfo | URL): string => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.replace(/^https?:\/\/[^/]+/, '')
}

const stubApi = (overrides: Record<string, (init?: RequestInit) => Response> = {}): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = pathOf(input)

      for (const [prefix, respond] of Object.entries(overrides)) {
        if (path.startsWith(prefix)) {
          return Promise.resolve(respond(init))
        }
      }

      if (path.startsWith('/v1/auth/otp/request')) return Promise.resolve(json(OTP_RESPONSE))
      if (path.startsWith('/v1/auth/otp/verify')) return Promise.resolve(json(AUTH_RESPONSE))
      if (path.startsWith('/v1/guest/wallet')) return Promise.resolve(json(WALLET_RESPONSE))
      if (path.startsWith('/v1/guest/me')) return Promise.resolve(json(ME_RESPONSE))
      if (path.startsWith('/v1/guest/news')) {
        return Promise.resolve(json({ items: [] }))
      }
      if (path.startsWith('/v1/guest/reviews')) {
        return Promise.resolve(json({ pending: [], items: [] }))
      }
      if (path.startsWith('/v1/guest/qr-token')) return Promise.resolve(json(QR_RESPONSE))

      return Promise.resolve(
        json({ error: { code: 'NOT_FOUND', message: `нет обработчика для ${path}` } }, 404),
      )
    }),
  )
}

const signIn = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText(t('signin.phone')), {
    target: { value: '+66812345678' },
  })
  fireEvent.click(screen.getByRole('button', { name: t('signin.getCode') }))

  fireEvent.change(await screen.findByLabelText(t('signin.code')), {
    target: { value: OTP_RESPONSE.devCode },
  })
  fireEvent.click(screen.getByRole('button', { name: t('signin.submit') }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Гостевое приложение', () => {
  it('без сессии показывает экран входа', async () => {
    stubApi()
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: t('signin.title') }),
    ).toBeInTheDocument()
  })

  it('без ключа Google не показывает ни кнопку, ни разделитель', async () => {
    // Разделитель «или» и кнопка Google — одно целое. Сначала они жили
    // по разным условиям, и на боевой странице получилось «или», под которым
    // ничего нет: ключ до сборки не доехал, кнопка не отрисовалась,
    // а разделитель остался. Выглядело как недогрузившийся экран.
    //
    // В тестах ключ не задан — значит здесь воспроизводится ровно тот случай.
    stubApi()
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: t('signin.title') })

    expect(screen.queryByText(t('signin.or'))).not.toBeInTheDocument()
  })

  it('вход по коду открывает карту с баллами и QR', async () => {
    stubApi()
    render(<App />)

    await signIn()

    // Баллы показаны в батах, хотя приходят целыми в сатангах.
    expect(await screen.findByText('425,00 ฿')).toBeInTheDocument()
    expect(screen.getByText('301,75 ฿')).toBeInTheDocument()

    // Заведение ищем В СПИСКЕ «где у вас баллы»: с появлением подарков то же
    // имя встречается на экране дважды, и проверка без границы прошла бы
    // по карточке подарка, ничего не сказав про список заведений.
    const venues = within(screen.getByRole('region', { name: t('card.venues.title') }))

    expect(venues.getByText('Kata Beach Kitchen')).toBeInTheDocument()
    // Контрольная группа помечена — гость видит, почему баллов не прибавляется.
    expect(venues.getByText(t('card.venues.control'))).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: t('card.qr.alt') })).toBeInTheDocument()
  })

  it('код подсказывается на экране, пока нет SMS-провайдера', async () => {
    stubApi()
    render(<App />)

    fireEvent.change(await screen.findByLabelText(t('signin.phone')), {
      target: { value: '+66812345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('signin.getCode') }))

    expect(await screen.findByText(OTP_RESPONSE.devCode)).toBeInTheDocument()
  })

  it('отказ сервера показывает его сообщение, не выдумывая своего', async () => {
    stubApi({
      '/v1/auth/otp/verify': () =>
        json({ error: { code: 'UNAUTHORIZED', message: 'Не удалось войти' } }, 401),
    })
    render(<App />)

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось войти')
    expect(screen.getByRole('heading', { level: 1, name: t('signin.title') })).toBeInTheDocument()
  })

  it('ошибка кошелька показывает текст сервера и кнопку повтора', async () => {
    stubApi({
      '/v1/guest/wallet': () =>
        json({ error: { code: 'UNKNOWN', message: 'Кошелёк временно недоступен' } }, 500),
    })
    render(<App />)

    await signIn()

    // У запросов включён retry: 1 (мобильная сеть на острове рвётся), поэтому
    // ошибка доезжает до экрана после повторной попытки — ждём дольше обычного.
    expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(
      'Кошелёк временно недоступен',
    )
    expect(screen.getByRole('button', { name: t('card.error.retry') })).toBeInTheDocument()
  })

  it('ПОКАЗЫВАЕТ ПОДАРОК С КОДОМ, ЗАВЕДЕНИЕМ И СРОКОМ', async () => {
    // Ради этого экрана и строилась партнёрская механика: до сих пор подарок
    // существовал только в базе, и гость о нём не знал.
    stubApi()
    render(<App />)

    await signIn()

    expect(await screen.findByText('Ролл Филадельфия в подарок')).toBeInTheDocument()

    // Смотрим ИМЕННО в раздел подарков: то же заведение есть и в списке
    // «где у вас баллы», и проверка без границы прошла бы по чужой строке.
    const gifts = within(screen.getByRole('region', { name: t('card.vouchers.title') }))

    // Код — главное на экране: его показывают кассиру.
    expect(gifts.getByText('KATA-200-9K2P')).toBeInTheDocument()
    expect(gifts.getByText('Kata Beach Kitchen')).toBeInTheDocument()
    // Шаги приходят с сервера, а не собираются здесь: иначе языки разъедутся.
    expect(gifts.getByText('Закажите на 800 ฿ или больше')).toBeInTheDocument()
  })

  it('ПОДАРОК БЕЗ НАЗВАНИЯ ВСЁ РАВНО ПОКАЗЫВАЕТСЯ', async () => {
    // У акции может не быть текстов. Скрыть такой подарок значило бы отобрать
    // у гостя то, что ему уже выдали, из-за незаполненного поля.
    stubApi()
    render(<App />)

    await signIn()

    expect(await screen.findByText('SABAI-1DAY')).toBeInTheDocument()
    expect(screen.getByText(t('card.vouchers.noTitle'))).toBeInTheDocument()
    // Последний день назван словами, а не числом «0».
    expect(screen.getByText(t('card.vouchers.lastDay'))).toBeInTheDocument()
  })

  it('без подарков раздела нет вовсе', async () => {
    // Пустой раздел «Ваши подарки» выглядел бы как поломка, а не как норма.
    stubApi({ '/v1/guest/wallet': () => json(WALLET_WITHOUT_VOUCHERS) })
    render(<App />)

    await signIn()

    expect(await screen.findByText('Kata Beach Kitchen')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t('card.vouchers.title') })).not.toBeInTheDocument()
  })

  it('переключает тему на противоположную', async () => {
    stubApi()
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: t('signin.title') })
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBeNull()
    })

    const before = document.documentElement.getAttribute('data-theme')
    // Подпись кнопки зависит от текущей темы: ищем ту, что предлагает
    // противоположную — она на экране ровно одна.
    const toggle =
      screen.queryByRole('button', { name: t('app.theme.toLight') }) ??
      screen.getByRole('button', { name: t('app.theme.toDark') })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).not.toBe(before)
    })
  })
})

describe('Статус в кошельке', () => {
  it('СТАТУС В ЗАВЕДЕНИИ И СКОЛЬКО ОСТАЛОСЬ ДО СЛЕДУЮЩЕГО — ЛЮБЫМ ИЗ СПОСОБОВ', async () => {
    stubApi()
    render(<App />)

    await signIn()

    const venues = within(await screen.findByRole('region', { name: t('card.venues.title') }))
    const ways = [
      t('card.tier.spentLeft').replace('{amount}', '2 500,00 ฿'),
      t('card.tier.visitsLeft').replace('{n}', '3'),
    ].join(` ${t('card.tier.or')} `)

    expect(venues.getByText('Свой')).toBeInTheDocument()
    // Поиск по тексту сводит неразрывные пробелы суммы к обычным — и ожидание тоже.
    expect(
      venues.getByText(
        t('card.tier.next').replace('{name}', 'Золото').replace('{ways}', ways).replace(/\s/g, ' '),
      ),
    ).toBeInTheDocument()
  })
})

const KATA_ID = '33333333-3333-4333-8333-333333333333'
const INVITE_CODE = '7KQ2MX4P'

/** Вызовы подменённого fetch: адрес и параметры запроса. */
const fetchCalls = (): Array<[RequestInfo | URL, RequestInit | undefined]> =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
    [RequestInfo | URL, RequestInit | undefined]
  >

describe('Пригласить друга', () => {
  it('ССЫЛКА ДРУГА, ОТКРЫТАЯ ДО ВХОДА, ПРИНИМАЕТСЯ СРАЗУ ПОСЛЕ ВХОДА', async () => {
    // Друг открыл ссылку, ещё не войдя: вход срезал бы адрес, а код должен дожить.
    window.history.replaceState(null, '', `/?venue=${KATA_ID}&ref=${INVITE_CODE.toLowerCase()}`)
    stubApi({
      [`/v1/guest/venues/${KATA_ID}/referral/accept`]: () =>
        json({ tenantId: KATA_ID, brandName: 'Kata Beach Kitchen', joined: true }),
    })
    render(<App />)

    await signIn()

    expect(
      await screen.findByText(t('invite.claim.joined').replace('{venue}', 'Kata Beach Kitchen')),
    ).toBeInTheDocument()

    const accept = fetchCalls().find(([input]) => pathOf(input).endsWith('/referral/accept'))
    expect(JSON.parse(accept?.[1]?.body as string)).toEqual({ code: INVITE_CODE })
    // Адрес очищен: перезагрузка карты не отправит приглашение второй раз.
    expect(window.location.search).toBe('')
  })

  it('СВОЯ ССЫЛКА — СОВЕТ ОТПРАВИТЬ ЕЁ ДРУЗЬЯМ, И ОТКАЗ НЕ ПОВТОРИТСЯ ПРИ СЛЕДУЮЩЕМ ОТКРЫТИИ', async () => {
    window.history.replaceState(null, '', `/?venue=${KATA_ID}&ref=${INVITE_CODE}`)
    stubApi({
      [`/v1/guest/venues/${KATA_ID}/referral/accept`]: () =>
        json(
          {
            error: { code: 'SELF_REFERRAL', message: 'Свою ссылку можно только отправить друзьям' },
          },
          409,
        ),
    })
    render(<App />)

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(t('invite.claim.self'))
    expect(window.localStorage.getItem('positive.guest.invite')).toBeNull()
  })

  it('ССЫЛКА С КОДОМ И СКОЛЬКО ДРУЗЕЙ ПРИШЛО — ТОЛЬКО ТАМ, ГДЕ ЗА ДРУЗЕЙ ДАЮТ БАЛЛЫ', async () => {
    stubApi({
      [`/v1/guest/venues/${KATA_ID}/referral`]: () =>
        json({
          tenantId: KATA_ID,
          brandName: 'Kata Beach Kitchen',
          enabled: true,
          code: INVITE_CODE,
          reward: 5_000,
          limit: 10,
          invited: 3,
          rewarded: 2,
        }),
    })
    render(<App />)

    await signIn()

    const venues = within(await screen.findByRole('region', { name: t('card.venues.title') }))

    // Кнопка ровно одна: у заведения, где гость в группе сравнения, её нет.
    fireEvent.click(venues.getByRole('button', { name: t('invite.open') }))

    const link = await venues.findByLabelText(t('invite.link'))
    expect(link).toHaveValue(`${window.location.origin}/?venue=${KATA_ID}&ref=${INVITE_CODE}`)
    expect(venues.getByText(t('invite.code').replace('{code}', INVITE_CODE))).toBeInTheDocument()
    expect(
      venues.getByText(
        t('invite.stats')
          .replace('{invited}', '3')
          .replace('{rewarded}', '2')
          .replace('{limit}', '10'),
      ),
    ).toBeInTheDocument()
  })
})

describe('Ссылка источника', () => {
  it('ССЫЛКА ТАБЛИЧКИ, ОТКРЫТАЯ ДО ВХОДА, ДЕЛАЕТ ГОСТЕМ ЗАВЕДЕНИЯ СРАЗУ ПОСЛЕ ВХОДА', async () => {
    window.history.replaceState(null, '', `/?venue=${KATA_ID}&src=tbr2k7qx`)
    stubApi({
      [`/v1/guest/venues/${KATA_ID}/join`]: () =>
        json({ tenantId: KATA_ID, brandName: 'Kata Beach Kitchen', joined: true }),
    })
    render(<App />)

    await signIn()

    expect(
      await screen.findByText(
        t('invite.claim.joinedChannel').replace('{venue}', 'Kata Beach Kitchen'),
      ),
    ).toBeInTheDocument()

    const join = fetchCalls().find(([input]) => pathOf(input).endsWith('/join'))
    expect(JSON.parse(join?.[1]?.body as string)).toEqual({ channel: 'TBR2K7QX' })
    // Табличка — не приглашение друга: запроса приглашения нет.
    expect(fetchCalls().some(([input]) => pathOf(input).includes('/referral'))).toBe(false)
    expect(window.location.search).toBe('')
  })

  it('выключенная табличка — гость узнаёт, что ссылка не действует', async () => {
    window.history.replaceState(null, '', `/?venue=${KATA_ID}&src=TBR2K7QX`)
    stubApi({
      [`/v1/guest/venues/${KATA_ID}/join`]: () =>
        json({ error: { code: 'CHANNEL_NOT_FOUND', message: 'Ссылка не найдена' } }, 404),
    })
    render(<App />)

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(t('invite.claim.linkNotFound'))
  })
})

describe('День рождения', () => {
  const WITHOUT_BIRTHDAY = { ...ME_RESPONSE, birthday: null }

  const enterDate = async (value: string): Promise<ReturnType<typeof within>> => {
    const section = within(await screen.findByRole('region', { name: t('birthday.title') }))
    fireEvent.change(section.getByLabelText(t('birthday.date')), { target: { value } })
    fireEvent.click(section.getByRole('button', { name: t('birthday.next') }))
    return section
  }

  it('ГОСТЬ УКАЗЫВАЕТ ДЕНЬ РОЖДЕНИЯ ОДИН РАЗ: ДАТА УХОДИТ ТОЛЬКО ПОСЛЕ ПОДТВЕРЖДЕНИЯ', async () => {
    stubApi({
      '/v1/guest/me/birthday': () => json(ME_RESPONSE),
      '/v1/guest/me': () => json(WITHOUT_BIRTHDAY),
    })
    render(<App />)

    await signIn()
    const section = await enterDate('1990-09-17')

    expect(
      section.getByText(t('birthday.check').replace('{date}', '17.09.1990')),
    ).toBeInTheDocument()
    expect(fetchCalls().some(([input]) => pathOf(input).endsWith('/me/birthday'))).toBe(false)

    fireEvent.click(section.getByRole('button', { name: t('birthday.confirm') }))

    expect(await section.findByRole('status')).toHaveTextContent(t('birthday.saved'))
    const put = fetchCalls().find(([input]) => pathOf(input).endsWith('/me/birthday'))
    expect(put?.[1]?.method).toBe('PUT')
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ date: '1990-09-17' })
  })

  it('ДАТА ИЗ БУДУЩЕГО НЕ ДОХОДИТ ДАЖЕ ДО ПОДТВЕРЖДЕНИЯ', async () => {
    stubApi({ '/v1/guest/me': () => json(WITHOUT_BIRTHDAY) })
    render(<App />)

    await signIn()
    const section = await enterDate('2999-01-01')

    expect(section.getByText(t('birthday.problem.range'))).toBeInTheDocument()
    expect(section.queryByRole('button', { name: t('birthday.confirm') })).not.toBeInTheDocument()
  })

  it('ДАТА УЖЕ УКАЗАНА С ДРУГОГО ТЕЛЕФОНА — ГОСТЬ ВИДИТ ОТВЕТ, А НЕ ПОЛОМКУ', async () => {
    stubApi({
      '/v1/guest/me/birthday': () =>
        json({ error: { code: 'BIRTHDAY_ALREADY_SET', message: 'День рождения уже указан' } }, 409),
      '/v1/guest/me': () => json(WITHOUT_BIRTHDAY),
    })
    render(<App />)

    await signIn()
    const section = await enterDate('1990-09-17')
    fireEvent.click(section.getByRole('button', { name: t('birthday.confirm') }))

    expect(await section.findByRole('alert')).toHaveTextContent(t('birthday.already'))
  })

  it('ДЕНЬ РОЖДЕНИЯ УЖЕ УКАЗАН — ВОПРОСА НА КАРТЕ НЕТ', async () => {
    stubApi()
    render(<App />)

    await signIn()
    await screen.findByRole('region', { name: t('card.venues.title') })
    await waitFor(() => {
      expect(fetchCalls().some(([input]) => pathOf(input).endsWith('/guest/me'))).toBe(true)
    })
    // Ответ профиля успевает дойти до экрана: без паузы тест прошёл бы и на вопросе.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(screen.queryByRole('region', { name: t('birthday.title') })).not.toBeInTheDocument()
  })
})

describe('Оценка визита', () => {
  const VISIT = {
    ledgerEntryId: '5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a',
    tenantId: KATA_ID,
    venue: 'Kata Beach Kitchen',
    visitedAt: '2026-09-15T12:40:00.000Z',
    amount: 45_000,
  }

  const REVIEWED = {
    id: '6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b',
    tenantId: KATA_ID,
    venue: 'Kata Beach Kitchen',
    rating: 2,
    tags: ['SERVICE'],
    comment: 'Ждали заказ сорок минут',
    reply: 'Нам очень жаль. Напишите, что случилось, — разберёмся.',
    repliedAt: '2026-09-15T13:02:11.000Z',
    createdAt: '2026-09-15T13:02:11.000Z',
  }

  const rate = async (): Promise<ReturnType<typeof within>> => {
    const section = within(
      await screen.findByRole('region', {
        name: t('review.title').replace('{venue}', 'Kata Beach Kitchen'),
      }),
    )

    // Без звезды отправлять нечего — кнопки ещё нет.
    expect(section.queryByRole('button', { name: t('review.send') })).not.toBeInTheDocument()

    fireEvent.click(section.getByRole('button', { name: t('review.star').replace('{n}', '2') }))
    fireEvent.click(section.getByRole('button', { name: t('review.tag.SERVICE') }))
    fireEvent.change(section.getByLabelText(t('review.comment')), {
      target: { value: '  Ждали заказ сорок минут  ' },
    })
    fireEvent.click(section.getByRole('button', { name: t('review.send') }))

    return section
  }

  it('ГОСТЬ СТАВИТ «2» С ТЕМОЙ И КОММЕНТАРИЕМ — И СРАЗУ ВИДИТ ОТВЕТ ЗАВЕДЕНИЯ', async () => {
    stubApi({
      '/v1/guest/reviews': (init) =>
        init?.method === 'POST' ? json(REVIEWED, 201) : json({ pending: [VISIT], items: [] }),
    })
    render(<App />)

    await signIn()
    await rate()

    expect(await screen.findByText(REVIEWED.reply)).toBeInTheDocument()

    const post = fetchCalls().find(
      ([input, init]) => pathOf(input).endsWith('/guest/reviews') && init?.method === 'POST',
    )
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      ledgerEntryId: VISIT.ledgerEntryId,
      rating: 2,
      tags: ['SERVICE'],
      comment: 'Ждали заказ сорок минут',
    })
  })

  it('ОЦЕНЁННЫЙ ВИЗИТ НЕ ПЕРЕСПРАШИВАЕТСЯ, А ОТВЕТЫ ЗАВЕДЕНИЙ ВИДНЫ НА КАРТЕ', async () => {
    stubApi({ '/v1/guest/reviews': () => json({ pending: [], items: [REVIEWED] }) })
    render(<App />)

    await signIn()

    const replies = within(await screen.findByRole('region', { name: t('review.replies') }))
    expect(replies.getByText(REVIEWED.reply)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('review.send') })).not.toBeInTheDocument()
  })

  it('ВИЗИТ УЖЕ ОЦЕНЁН С ДРУГОГО ТЕЛЕФОНА — ГОСТЬ ВИДИТ ОТВЕТ, А НЕ ПОЛОМКУ', async () => {
    stubApi({
      '/v1/guest/reviews': (init) =>
        init?.method === 'POST'
          ? json({ error: { code: 'REVIEW_EXISTS', message: 'Этот визит вы уже оценили' } }, 409)
          : json({ pending: [VISIT], items: [] }),
    })
    render(<App />)

    await signIn()
    const section = await rate()

    expect(await section.findByRole('alert')).toHaveTextContent(t('review.error.exists'))
  })
})

describe('Новости заведений', () => {
  const news = (n: number) => ({
    id: `4b4b4b4b-4b4b-44b4-84b4-4b4b4b4b4b0${String(n)}`,
    tenantId: KATA_ID,
    venue: 'Kata Beach Kitchen',
    title: `Новость ${String(n)}`,
    body: `Текст новости ${String(n)}`,
    publishedAt: `2026-09-1${String(n)}T08:00:00.000Z`,
  })

  it('ТРИ СВЕЖИЕ НОВОСТИ НА КАРТЕ, ОСТАЛЬНЫЕ — ПО «ПОКАЗАТЬ ВСЕ»', async () => {
    stubApi({ '/v1/guest/news': () => json({ items: [5, 4, 3, 2, 1].map(news) }) })
    render(<App />)

    await signIn()

    const section = within(await screen.findByRole('region', { name: t('news.title') }))
    expect(section.getByText('Новость 5')).toBeInTheDocument()
    expect(section.getByText('Kata Beach Kitchen · 15.09')).toBeInTheDocument()
    expect(section.getByText('Новость 3')).toBeInTheDocument()
    expect(section.queryByText('Новость 2')).not.toBeInTheDocument()

    fireEvent.click(section.getByRole('button', { name: t('news.more') }))

    expect(section.getByText('Новость 1')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: t('news.more') })).not.toBeInTheDocument()
  })

  it('ПОКАЗАННОЕ ОТМЕЧАЕТСЯ УВИДЕННЫМ — ОСТАЛЬНОЕ ТОЛЬКО ПОСЛЕ «ПОКАЗАТЬ ВСЕ»', async () => {
    stubApi({
      '/v1/guest/news': () => json({ items: [5, 4, 3, 2, 1].map(news) }),
      '/v1/guest/news/seen': () => json({ counted: 3 }),
    })
    render(<App />)

    await signIn()

    const section = within(await screen.findByRole('region', { name: t('news.title') }))
    const seen = (): string[][] =>
      fetchCalls()
        .filter(([input]) => pathOf(input).endsWith('/guest/news/seen'))
        .map(
          ([, init]) => (JSON.parse((init as RequestInit).body as string) as { ids: string[] }).ids,
        )

    await waitFor(() => {
      expect(seen()).toEqual([[news(5).id, news(4).id, news(3).id]])
    })

    fireEvent.click(section.getByRole('button', { name: t('news.more') }))

    await waitFor(() => {
      expect(seen()).toEqual([
        [news(5).id, news(4).id, news(3).id],
        [news(2).id, news(1).id],
      ])
    })
  })

  it('НОВОСТЕЙ НЕТ — БЛОКА НА КАРТЕ НЕТ', async () => {
    stubApi()
    render(<App />)

    await signIn()
    await screen.findByRole('region', { name: t('card.venues.title') })
    await waitFor(() => {
      expect(fetchCalls().some(([input]) => pathOf(input).endsWith('/guest/news'))).toBe(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(screen.queryByRole('region', { name: t('news.title') })).not.toBeInTheDocument()
  })
})
