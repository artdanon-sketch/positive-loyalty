import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  CommitResult,
  PosConfig,
  PosGuest,
  PosHistory,
  PosHistoryPeriod,
  PosInvite,
  PosMe,
  PosTag,
  PosVoidResult,
  PreviewResult,
  RedeemGrantInput,
  RedeemGrantResult,
  SaleKind,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Касса: найти гостя → посчитать → провести.
 *
 * Всё мутациями, а не запросами: поиск гостя ПОБОЧЕН — он заводит участие,
 * если гость в этом заведении впервые. Кэшировать такое как query значит
 * получить повторное оформление на ретрае react-query.
 */

/** Окно, в котором кассир может отменить свою операцию (docs/02, раздел 3.5). */
export const VOID_WINDOW_MS = 15 * 60 * 1000

/**
 * Правила кассы заведения. Читаются один раз на смену и не протухают:
 * владелец меняет их в бэк-офисе, а не посреди чека.
 */
export function usePosConfig(): UseQueryResult<PosConfig, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['pos', 'config'],
    queryFn: () => authFetch<PosConfig>('/pos/config'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Виды продаж заведения — то, из чего кассир выбирает «что продали».
 *
 * Запросом, а не мутацией: побочных действий нет, и держать список
 * на всю смену правильно — владелец правит справочник в бэк-офисе,
 * а не посреди чека. Тот же срок жизни, что и у правил кассы.
 *
 * Пустой список — норма, а не ошибка: справочник ведут не все заведения.
 */
export function usePosSaleKinds(): UseQueryResult<SaleKind[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['pos', 'sale-kinds'],
    queryFn: () => authFetch<SaleKind[]>('/pos/sale-kinds'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * QR, по которому гость записывается у стойки. docs/02, раздел 3.9.
 *
 * Держится всю смену, как правила кассы: источник владелец заводит в бэк-офисе,
 * а не посреди очереди.
 */
export function usePosInvite(): UseQueryResult<PosInvite, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['pos', 'invite'],
    queryFn: () => authFetch<PosInvite>('/pos/invite'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Свои чеки за период. Без кэша на смену: кассир открывает вкладку, чтобы
 * увидеть чек, который только что провёл, — вчерашний список здесь хуже пустого.
 */
export function usePosHistory(
  period: Exclude<PosHistoryPeriod, 'range'>,
): UseQueryResult<PosHistory, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['pos', 'history', period],
    queryFn: () => authFetch<PosHistory>(`/pos/history?period=${period}`),
  })
}

/** Кто я и где работаю, с показателями смены, если владелец их открыл. Свежие по той же причине. */
export function usePosMe(): UseQueryResult<PosMe, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['pos', 'me'],
    queryFn: () => authFetch<PosMe>('/pos/me'),
  })
}

export function useFindGuest(): UseMutationResult<
  PosGuest,
  Error,
  { token?: string; phone?: string }
> {
  const { authFetch } = useAuth()

  return useMutation({
    mutationFn: ({ token, phone }) => {
      const query =
        token === undefined
          ? `phone=${encodeURIComponent(phone ?? '')}`
          : `token=${encodeURIComponent(token)}`

      return authFetch<PosGuest>(`/pos/guest?${query}`)
    },
  })
}

export function usePreview(): UseMutationResult<
  PreviewResult,
  Error,
  { membershipId: string; amount: number; redeem?: number; receiptNumber?: string }
> {
  const { authFetch } = useAuth()

  return useMutation({
    mutationFn: (input) =>
      authFetch<PreviewResult>('/pos/transactions/preview', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
  })
}

export function useCommit(): UseMutationResult<
  CommitResult,
  Error,
  { previewId: string; receiptId: string; saleKindId?: string }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<CommitResult>('/pos/transactions/commit', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      // Журнал и дашборд менеджера устарели в ту же секунду.
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

export function useVoid(): UseMutationResult<
  PosVoidResult,
  Error,
  { transactionId: string; reason: string }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ transactionId, reason }) =>
      authFetch<PosVoidResult>(`/pos/transactions/${transactionId}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

/**
 * Погасить промокод гостя. Ключ повтора — номер чека (docs/02, раздел 3.4).
 * Журнал и история гостя устаревают в ту же секунду.
 */
export function useRedeemGrant(): UseMutationResult<RedeemGrantResult, Error, RedeemGrantInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<RedeemGrantResult>('/pos/grants/redeem', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
}

/**
 * Номер чека, если кассир его не ввёл.
 *
 * Это КЛЮЧ ИДЕМПОТЕНТНОСТИ операции, а не украшение: повтор с тем же номером
 * возвращает первый ответ вместо второго начисления. Поэтому он обязан быть
 * уникальным для чека и одинаковым у всех его повторов — генерируется один раз
 * на попытку проведения и переживает потерю связи.
 */
export const generateReceiptId = (): string =>
  `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Повесить гостю тег с кассы.
 *
 * Ответ сервера — полный список тегов гостя: экран показывает то, что реально
 * записалось, а не то, что кассир нажал.
 */
export function useAddGuestTag(): UseMutationResult<
  PosTag[],
  Error,
  { membershipId: string; tagId: string }
> {
  const { authFetch } = useAuth()

  return useMutation({
    mutationFn: ({ membershipId, tagId }) =>
      authFetch<PosTag[]>(`/pos/guest/${encodeURIComponent(membershipId)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
        headers: { 'Content-Type': 'application/json' },
      }),
  })
}
