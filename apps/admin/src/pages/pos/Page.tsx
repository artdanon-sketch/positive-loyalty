import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { CommitResult, PosGuest, PreviewResult } from '@positive/contracts'

import { formatBaht } from '../../shared/format/format'
import { useT } from '../../shared/i18n'
import { QrScanner } from './components/qr-scanner'
import { isScannerSupported } from './components/scanner-support'
import { isNetworkFailure } from './offline-queue'
import { useOfflineQueue } from './use-offline-queue'
import type { OfflineQueueState } from './use-offline-queue'
import {
  generateReceiptId,
  useCommit,
  usePosSaleKinds,
  useFindGuest,
  usePosConfig,
  usePreview,
  useVoid,
  VOID_WINDOW_MS,
} from './hooks'

/**
 * Экран кассы. docs/03, раздел 10 — «самый ответственный».
 *
 * Требование ТЗ дословно: «от нажатия „сканировать“ до подтверждения — не
 * больше двух тапов и трёх секунд». Отсюда вся конструкция экрана:
 *
 *   • сканер запущен СРАЗУ при входе, отдельного тапа «сканировать» нет;
 *   • после гостя фокус сам уходит в сумму, клавиатура числовая;
 *   • подтверждение — одна кнопка, без диалога «вы уверены»;
 *   • экран успеха показывает, ЧТО ИМЕННО получил гость, а не галочку:
 *     кассир зачитывает это вслух, и от точности зависит доверие к программе.
 *
 * Списание баллов на этом шаге не вводится: Срез 1 доводит начисление
 * (docs/06, раздел 4). Потолок списания предрасчёт уже считает и возвращает,
 * поэтому поле добавится сюда без изменений на сервере.
 */

type Stage =
  | { kind: 'GUEST' }
  | { kind: 'AMOUNT'; guest: PosGuest }
  | {
      kind: 'CONFIRM'
      guest: PosGuest
      preview: PreviewResult
      receiptId: string
      /**
       * Номер чека, введённый кассиром. Тащится сюда не для показа, а для
       * ОЧЕРЕДИ: если связь оборвётся на проведении, повтор пойдёт заново
       * с предрасчёта, а заведение может требовать номер. Без него отложенный
       * чек застревал на `RECEIPT_REQUIRED` — и это ловилось только вживую.
       */
      receiptNumber?: string
    }
  | { kind: 'DONE'; guest: PosGuest; result: CommitResult; at: number }
  /**
   * Чек принят, но ещё не ушёл: связи не было. Сумма начисления здесь
   * НЕ НАЗЫВАЕТСЯ — её считает сервер, и назвать её сейчас можно было бы
   * только угадав. ТЗ поэтому и требует говорить гостю «баллы придут
   * в течение нескольких минут» (docs/03, раздел 10).
   */
  | { kind: 'QUEUED'; receiptId: string }
  /**
   * Связь пропала ДО того, как гостя нашли. Кассир вводит сумму вслепую:
   * ни имени, ни баланса, ни суммы начисления показать нечем — сервер
   * недоступен. Чек всё равно принимается: гость не должен уходить без баллов
   * из-за того, что на острове моргнул интернет, а телефон он уже назвал.
   */
  | { kind: 'AMOUNT_OFFLINE'; phone: string }

export function PosPage(): ReactElement {
  const t = useT()
  const [stage, setStage] = useState<Stage>({ kind: 'GUEST' })
  const queue = useOfflineQueue()

  return (
    <section className="page pos">
      <header className="page__head">
        <div>
          <h1 className="page__title">{t('pos.title')}</h1>
          <p className="page__subtitle">{t('pos.subtitle')}</p>
        </div>
      </header>

      <QueueBanner queue={queue} />

      {stage.kind === 'GUEST' ? (
        <GuestStep
          onFound={(guest) => {
            setStage({ kind: 'AMOUNT', guest })
          }}
          onOffline={(phone) => {
            setStage({ kind: 'AMOUNT_OFFLINE', phone })
          }}
        />
      ) : stage.kind === 'AMOUNT_OFFLINE' ? (
        <OfflineAmountStep
          phone={stage.phone}
          queue={queue}
          onQueued={(receiptId) => {
            setStage({ kind: 'QUEUED', receiptId })
          }}
          onCancel={() => {
            setStage({ kind: 'GUEST' })
          }}
        />
      ) : stage.kind === 'AMOUNT' ? (
        <AmountStep
          guest={stage.guest}
          queue={queue}
          onReady={(preview, receiptId, receiptNumber) => {
            setStage({
              kind: 'CONFIRM',
              guest: stage.guest,
              preview,
              receiptId,
              ...(receiptNumber === undefined ? {} : { receiptNumber }),
            })
          }}
          onQueued={(receiptId) => {
            setStage({ kind: 'QUEUED', receiptId })
          }}
          onCancel={() => {
            setStage({ kind: 'GUEST' })
          }}
        />
      ) : stage.kind === 'CONFIRM' ? (
        <ConfirmStep
          guest={stage.guest}
          preview={stage.preview}
          receiptId={stage.receiptId}
          {...(stage.receiptNumber === undefined ? {} : { receiptNumber: stage.receiptNumber })}
          queue={queue}
          onDone={(result) => {
            setStage({ kind: 'DONE', guest: stage.guest, result, at: Date.now() })
          }}
          onQueued={(receiptId) => {
            setStage({ kind: 'QUEUED', receiptId })
          }}
          onBack={() => {
            setStage({ kind: 'AMOUNT', guest: stage.guest })
          }}
        />
      ) : stage.kind === 'QUEUED' ? (
        <QueuedStep
          receiptId={stage.receiptId}
          queue={queue}
          onNext={() => {
            setStage({ kind: 'GUEST' })
          }}
        />
      ) : (
        <DoneStep
          guest={stage.guest}
          result={stage.result}
          at={stage.at}
          onNext={() => {
            setStage({ kind: 'GUEST' })
          }}
        />
      )}
    </section>
  )
}

/** Полоса состояния очереди: она же индикатор связи. */
function QueueBanner({ queue }: { queue: OfflineQueueState }): ReactElement | null {
  const t = useT()

  if (queue.isOnline && queue.pending === 0) {
    return null
  }

  return (
    <p className={`pos__banner ${queue.isOnline ? '' : 'pos__banner--offline'}`} role="status">
      {queue.isOnline ? t('pos.queue.sending') : t('pos.queue.offline')}
      {queue.pending > 0 ? ` · ${t('pos.queue.pending')} ${queue.pending}` : ''}
      {queue.stuck.length > 0 ? ` · ${t('pos.queue.stuck')} ${queue.stuck.length}` : ''}
    </p>
  )
}

/**
 * Чек принят в очередь: сумму не называем, её посчитает сервер.
 *
 * Подпись следит за судьбой ИМЕННО ЭТОГО чека. Связь на острове возвращается
 * через секунды, и застывшее «связи нет» на экране, с которого чек уже ушёл, —
 * маленькая, но ложь: кассир по ней скажет гостю ждать того, что уже случилось.
 */
function QueuedStep({
  receiptId,
  queue,
  onNext,
}: {
  receiptId: string
  queue: OfflineQueueState
  onNext: () => void
}): ReactElement {
  const t = useT()
  const sale = queue.sales.find((item) => item.receiptId === receiptId)
  const isStuckNow = sale !== undefined && queue.stuck.some((item) => item.receiptId === receiptId)
  const isSent = sale === undefined

  return (
    <div className="pos__step pos__step--done">
      <p className="pos__done" aria-live="polite">
        {isSent ? t('pos.queued.sent') : t('pos.queued.title')}
      </p>
      <p className="pos__notice">
        {isStuckNow
          ? t('pos.queued.stuck')
          : isSent
            ? t('pos.queued.sentHint')
            : t('pos.queued.hint')}
      </p>
      <div className="pos__actions">
        <button className="button button--primary" type="button" onClick={onNext}>
          {t('pos.done.next')}
        </button>
      </div>
    </div>
  )
}

/** Шаг 1: кто перед кассой. */
function GuestStep({
  onFound,
  onOffline,
}: {
  onFound: (guest: PosGuest) => void
  onOffline: (phone: string) => void
}): ReactElement {
  const t = useT()
  const [phone, setPhone] = useState('')
  const find = useFindGuest()

  const lookup = (input: { token?: string; phone?: string }): void => {
    find.mutate(input, {
      onSuccess: onFound,
      onError: (error) => {
        // Сеть пропала, а телефон гость уже назвал — этого хватит, чтобы
        // принять чек и досчитать его потом. По QR так нельзя: токен живёт
        // пять минут и к возвращению связи протухнет.
        if (isNetworkFailure(error) && input.phone !== undefined) {
          onOffline(input.phone)
        }
      },
    })
  }

  return (
    <div className="pos__step">
      {isScannerSupported() ? (
        <QrScanner
          onFound={(token) => {
            lookup({ token })
          }}
        />
      ) : null}

      <form
        className="pos__form"
        onSubmit={(event) => {
          event.preventDefault()
          lookup({ phone })
        }}
      >
        <label className="field">
          <span className="field__label">{t('pos.phone.label')}</span>
          <input
            className="field__input"
            // Телефон гость называет вслух: числовая клавиатура и никаких
            // подсказок автозаполнения чужими контактами на общем планшете.
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+66812345678"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
          />
        </label>
        <button
          className="button button--primary"
          type="submit"
          disabled={find.isPending || phone.trim().length === 0}
        >
          {find.isPending ? t('common.loading') : t('pos.phone.find')}
        </button>
      </form>

      {find.isError ? (
        <p className="pos__error" role="alert">
          {isNetworkFailure(find.error) ? t('pos.queue.failed') : find.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Шаг 2: сумма чека. */
function AmountStep({
  guest,
  queue,
  onReady,
  onQueued,
  onCancel,
}: {
  guest: PosGuest
  queue: OfflineQueueState
  onReady: (preview: PreviewResult, receiptId: string, receiptNumber?: string) => void
  onQueued: (receiptId: string) => void
  onCancel: () => void
}): ReactElement {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [receiptNumber, setReceiptNumber] = useState('')
  const preview = usePreview()
  const config = usePosConfig()
  const inputRef = useRef<HTMLInputElement>(null)

  // Фокус сам: гость найден, следующее действие всегда одно — ввести сумму.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const minor = Math.round(Number(amount.replace(',', '.')) * 100)
  const rules = config.data
  const needsReceipt = rules?.requireReceiptNumber ?? false
  const cap = rules?.maxManualAmount ?? null

  // Проверяем ЗДЕСЬ то, что сервер и так проверит. Не ради экономии запроса:
  // отказ приходит, когда гость уже стоит у стойки, и кассиру приходится
  // объясняться за то, что интерфейс знал заранее и промолчал.
  const overCap = cap !== null && minor > cap
  const receiptMissing = needsReceipt && receiptNumber.trim() === ''
  const isValid = Number.isFinite(minor) && minor > 0 && !overCap && !receiptMissing

  return (
    <div className="pos__step">
      <GuestCard guest={guest} />

      <form
        className="pos__form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!isValid) {
            return
          }

          // Номер чека — ключ идемпотентности. Генерируется ЗДЕСЬ, один раз
          // на попытку, и переживает потерю связи: повтор уйдёт с тем же.
          const receiptId = receiptNumber.trim() === '' ? generateReceiptId() : receiptNumber.trim()

          preview.mutate(
            {
              membershipId: guest.membershipId,
              amount: minor,
              ...(receiptNumber.trim() === '' ? {} : { receiptNumber: receiptNumber.trim() }),
            },
            {
              onSuccess: (result) => {
                onReady(
                  result,
                  receiptId,
                  receiptNumber.trim() === '' ? undefined : receiptNumber.trim(),
                )
              },
              onError: (error) => {
                // Сервер отказал — показываем отказ: в очередь такое класть
                // нельзя, ответ не изменится сам собой. Пропала сеть — чек
                // принимаем и досылаем: гость не должен уходить без баллов
                // из-за того, что на острове моргнул интернет.
                if (!isNetworkFailure(error)) {
                  return
                }

                if (
                  queue.queueSale({
                    receiptId,
                    target: { kind: 'MEMBERSHIP', membershipId: guest.membershipId },
                    amount: minor,
                    ...(receiptNumber.trim() === '' ? {} : { receiptNumber: receiptNumber.trim() }),
                  })
                ) {
                  onQueued(receiptId)
                }
              },
            },
          )
        }}
      >
        <label className="field">
          <span className="field__label">{t('pos.amount.label')}</span>
          <input
            className="field__input field__input--amount"
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
            }}
          />
        </label>

        <label className="field">
          <span className="field__label">
            {needsReceipt ? t('pos.receipt.required') : t('pos.receipt.label')}
          </span>
          <input
            className="field__input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required={needsReceipt}
            value={receiptNumber}
            onChange={(event) => {
              setReceiptNumber(event.target.value)
            }}
          />
        </label>

        {overCap ? (
          <p className="pos__notice">
            {t('pos.amount.overCap')} {formatBaht(cap ?? 0)}
          </p>
        ) : null}

        <div className="pos__actions">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            {t('pos.back')}
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={!isValid || preview.isPending}
          >
            {preview.isPending ? t('common.loading') : t('pos.amount.next')}
          </button>
        </div>
      </form>

      {/* Отказ сервера показываем его словами. Сетевой сбой сюда не попадает:
          чек ушёл в очередь, и об этом говорит уже следующий экран. Если же
          в очередь поставить не удалось, экран остаётся здесь, и кассир видит
          причину — молчание было бы худшим из исходов. */}
      {preview.isError ? (
        <p className="pos__error" role="alert">
          {isNetworkFailure(preview.error) ? t('pos.queue.failed') : preview.error.message}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Ввод суммы, когда связи нет и гость не найден.
 *
 * Отдельный компонент, а не флаг внутри обычного шага: здесь принципиально
 * НЕЧЕГО показать — ни карточки гостя, ни предрасчёта, ни суммы начисления.
 * Общий компонент с половиной выключенных блоков врал бы кассиру видом,
 * будто он видит то же, что обычно.
 *
 * Подтверждение здесь одно вместо двух: показывать экран «проверьте расчёт»
 * не на чем, а лишний тап противоречит требованию про два тапа.
 */
function OfflineAmountStep({
  phone,
  queue,
  onQueued,
  onCancel,
}: {
  phone: string
  queue: OfflineQueueState
  onQueued: (receiptId: string) => void
  onCancel: () => void
}): ReactElement {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [receiptNumber, setReceiptNumber] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const minor = Math.round(Number(amount.replace(',', '.')) * 100)
  const isValid = Number.isFinite(minor) && minor > 0

  return (
    <div className="pos__step">
      <div className="guest-card">
        <div className="guest-card__main">
          <b className="guest-card__name">{phone}</b>
          <span className="guest-card__meta">{t('pos.offline.blind')}</span>
        </div>
      </div>

      <form
        className="pos__form"
        onSubmit={(event) => {
          event.preventDefault()

          if (!isValid) {
            return
          }

          const receiptId = generateReceiptId()

          const queued = queue.queueSale({
            receiptId,
            target: { kind: 'PHONE', phone },
            amount: minor,
            ...(receiptNumber.trim() === '' ? {} : { receiptNumber: receiptNumber.trim() }),
          })

          if (queued) {
            onQueued(receiptId)
          }
        }}
      >
        <label className="field">
          <span className="field__label">{t('pos.amount.label')}</span>
          <input
            className="field__input field__input--amount"
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
            }}
          />
        </label>

        <label className="field">
          {/* Обязательность правил кассы здесь не проверить: они приходят
              с сервера, а его нет. Просим номер, но не запрещаем без него —
              иначе офлайн-касса встанет там, где должна работать. */}
          <span className="field__label">{t('pos.receipt.label')}</span>
          <input
            className="field__input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={receiptNumber}
            onChange={(event) => {
              setReceiptNumber(event.target.value)
            }}
          />
        </label>

        <div className="pos__actions">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            {t('pos.back')}
          </button>
          <button className="button button--primary" type="submit" disabled={!isValid}>
            {t('pos.offline.accept')}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Шаг 3: подтверждение. Один тап, без диалога «вы уверены». */
function ConfirmStep({
  guest,
  preview,
  receiptId,
  receiptNumber,
  queue,
  onDone,
  onQueued,
  onBack,
}: {
  guest: PosGuest
  preview: PreviewResult
  receiptId: string
  receiptNumber?: string
  queue: OfflineQueueState
  onDone: (result: CommitResult) => void
  onQueued: (receiptId: string) => void
  onBack: () => void
}): ReactElement {
  const t = useT()
  const commit = useCommit()
  const saleKinds = usePosSaleKinds()
  const [saleKindId, setSaleKindId] = useState('')

  // Справочник ведут не все заведения. Где его нет — выбора нет вовсе,
  // и чек проводится ровно как раньше: лишний пустой список посреди кассы
  // был бы вопросом без ответов.
  const kinds = saleKinds.data ?? []

  return (
    <div className="pos__step">
      <GuestCard guest={guest} />

      <dl className="pos__summary">
        <div className="pos__row">
          <dt>{t('pos.confirm.amount')}</dt>
          <dd>{formatBaht(preview.amount)}</dd>
        </div>
        <div className="pos__row pos__row--accent">
          <dt>{t('pos.confirm.earn')}</dt>
          <dd>{formatBaht(preview.pointsToEarn)}</dd>
        </div>
        <div className="pos__row">
          <dt>{t('pos.confirm.balanceAfter')}</dt>
          <dd>{formatBaht(preview.balanceAtPreview + preview.pointsToEarn)}</dd>
        </div>
      </dl>

      {guest.isControlGroup ? (
        // Кассир обязан знать ДО подтверждения, иначе объясняться придётся
        // постфактум, когда гость уже смотрит на нулевое начисление.
        <p className="pos__notice">{t('pos.confirm.control')}</p>
      ) : null}

      {kinds.length === 0 ? null : (
        <label className="field">
          <span className="field__label">{t('pos.saleKind.label')}</span>
          <select
            className="field__input"
            value={saleKindId}
            onChange={(event) => {
              setSaleKindId(event.target.value)
            }}
          >
            {/* Пустой пункт первым и выбран по умолчанию: обязательным вид
                продажи не является, и подставлять первый попавшийся значило бы
                записывать в журнал догадку кассы вместо ответа кассира. */}
            <option value="">{t('pos.saleKind.none')}</option>
            {kinds.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="pos__actions">
        <button className="button button--ghost" type="button" onClick={onBack}>
          {t('pos.back')}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={commit.isPending}
          onClick={() => {
            commit.mutate(
              {
                previewId: preview.previewId,
                receiptId,
                ...(saleKindId === '' ? {} : { saleKindId }),
              },
              {
                onSuccess: onDone,
                onError: (error) => {
                  if (!isNetworkFailure(error)) {
                    return
                  }

                  // Самый опасный случай: чек МОГ уже дойти до сервера, а ответ
                  // потеряться. Повтор уйдёт с тем же receiptId, и сервер
                  // вернёт первый ответ вместо второго начисления — ровно для
                  // этого ключ идемпотентности и выдан один раз на чек.
                  if (
                    queue.queueSale({
                      receiptId,
                      target: { kind: 'MEMBERSHIP', membershipId: guest.membershipId },
                      amount: preview.amount,
                      // ВИД ПРОДАЖИ В ОЧЕРЕДЬ НЕ КЛАДЁТСЯ, И ЭТО НАРОЧНО.
                      // Пока чек лежит в очереди, владелец может выключить
                      // этот вид в бэк-офисе — и повтор получил бы отказ
                      // SALE_KIND_NOT_FOUND, то есть чек застрял бы навсегда,
                      // а гость остался без баллов. Баллы важнее подарка:
                      // отложенный чек уходит без вида, партнёрская награда
                      // по нему не выдаётся.
                      //
                      // Номер чека обязателен у части заведений: без него
                      // отложенный чек застрянет на первом же повторе.
                      ...(receiptNumber === undefined ? {} : { receiptNumber }),
                    })
                  ) {
                    onQueued(receiptId)
                  }
                },
              },
            )
          }}
        >
          {commit.isPending ? t('common.loading') : t('pos.confirm.submit')}
        </button>
      </div>

      {commit.isError ? (
        <p className="pos__error" role="alert">
          {isNetworkFailure(commit.error) ? t('pos.queue.failed') : commit.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Шаг 4: что именно получил гость. */
function DoneStep({
  guest,
  result,
  at,
  onNext,
}: {
  guest: PosGuest
  result: CommitResult
  at: number
  onNext: () => void
}): ReactElement {
  const t = useT()
  const voidTx = useVoid()
  const [leftMs, setLeftMs] = useState(VOID_WINDOW_MS)

  // Окно отмены тикает на экране: кассир должен видеть, сколько осталось,
  // а не гадать, доступна ли ещё кнопка.
  //
  // Остаток считается В ЭФФЕКТЕ, а не в теле компонента: `Date.now()` —
  // функция нечистая, и её вызов во время рендера даёт разный результат
  // на разных проходах. Начальное значение — полное окно: операция только
  // что проведена, и на первом кадре это правда.
  useEffect(() => {
    const tick = (): void => {
      setLeftMs(Math.max(0, VOID_WINDOW_MS - (Date.now() - at)))
    }

    tick()
    const timer = window.setInterval(tick, 1_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [at])
  const isVoided = voidTx.isSuccess

  return (
    <div className="pos__step pos__step--done">
      <p className="pos__done" aria-live="polite">
        {/* Не галочка, а сумма: её кассир зачитывает вслух. */}
        {isVoided ? t('pos.done.voided') : `${guest.displayName ?? t('pos.guest.noName')} — `}
        {isVoided ? null : <b className="pos__earned">+{formatBaht(result.earned)}</b>}
      </p>

      {isVoided ? null : (
        <dl className="pos__summary">
          <div className="pos__row">
            <dt>{t('pos.done.balance')}</dt>
            <dd>{formatBaht(result.newBalance)}</dd>
          </div>
        </dl>
      )}

      <div className="pos__actions">
        {isVoided || leftMs === 0 ? null : (
          <button
            className="button button--ghost"
            type="button"
            disabled={voidTx.isPending}
            onClick={() => {
              voidTx.mutate({ transactionId: result.transactionId, reason: 'WRONG_AMOUNT' })
            }}
          >
            {t('pos.done.void')} · {Math.ceil(leftMs / 60_000)} {t('pos.done.minutes')}
          </button>
        )}
        <button className="button button--primary" type="button" onClick={onNext}>
          {t('pos.done.next')}
        </button>
      </div>

      {voidTx.isError ? (
        <p className="pos__error" role="alert">
          {voidTx.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Карточка гостя: то, что кассир должен знать до ввода суммы. */
function GuestCard({ guest }: { guest: PosGuest }): ReactElement {
  const t = useT()

  return (
    <div className="guest-card">
      <div className="guest-card__main">
        <b className="guest-card__name">{guest.displayName ?? t('pos.guest.noName')}</b>
        <span className="guest-card__meta">
          {guest.isNew
            ? t('pos.guest.new')
            : `${t('pos.guest.visits')} ${guest.visitsTotal} · ${formatBaht(guest.points)}`}
        </span>
      </div>
      {guest.isControlGroup ? (
        <span className="chip chip--muted">{t('pos.guest.control')}</span>
      ) : null}
    </div>
  )
}
