import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { CommitResult, PosGuest, PreviewResult } from '@positive/contracts'

import { formatBaht } from '../../shared/format/format'
import { useT } from '../../shared/i18n'
import { QrScanner } from './components/qr-scanner'
import { isScannerSupported } from './components/scanner-support'
import {
  generateReceiptId,
  useCommit,
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
  | { kind: 'CONFIRM'; guest: PosGuest; preview: PreviewResult; receiptId: string }
  | { kind: 'DONE'; guest: PosGuest; result: CommitResult; at: number }

export function PosPage(): ReactElement {
  const t = useT()
  const [stage, setStage] = useState<Stage>({ kind: 'GUEST' })

  return (
    <section className="page pos">
      <header className="page__head">
        <div>
          <h1 className="page__title">{t('pos.title')}</h1>
          <p className="page__subtitle">{t('pos.subtitle')}</p>
        </div>
      </header>

      {stage.kind === 'GUEST' ? (
        <GuestStep
          onFound={(guest) => {
            setStage({ kind: 'AMOUNT', guest })
          }}
        />
      ) : stage.kind === 'AMOUNT' ? (
        <AmountStep
          guest={stage.guest}
          onReady={(preview, receiptId) => {
            setStage({ kind: 'CONFIRM', guest: stage.guest, preview, receiptId })
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
          onDone={(result) => {
            setStage({ kind: 'DONE', guest: stage.guest, result, at: Date.now() })
          }}
          onBack={() => {
            setStage({ kind: 'AMOUNT', guest: stage.guest })
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

/** Шаг 1: кто перед кассой. */
function GuestStep({ onFound }: { onFound: (guest: PosGuest) => void }): ReactElement {
  const t = useT()
  const [phone, setPhone] = useState('')
  const find = useFindGuest()

  const lookup = (input: { token?: string; phone?: string }): void => {
    find.mutate(input, { onSuccess: onFound })
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
          {find.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Шаг 2: сумма чека. */
function AmountStep({
  guest,
  onReady,
  onCancel,
}: {
  guest: PosGuest
  onReady: (preview: PreviewResult, receiptId: string) => void
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
                onReady(result, receiptId)
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

      {preview.isError ? (
        <p className="pos__error" role="alert">
          {preview.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Шаг 3: подтверждение. Один тап, без диалога «вы уверены». */
function ConfirmStep({
  guest,
  preview,
  receiptId,
  onDone,
  onBack,
}: {
  guest: PosGuest
  preview: PreviewResult
  receiptId: string
  onDone: (result: CommitResult) => void
  onBack: () => void
}): ReactElement {
  const t = useT()
  const commit = useCommit()

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

      <div className="pos__actions">
        <button className="button button--ghost" type="button" onClick={onBack}>
          {t('pos.back')}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={commit.isPending}
          onClick={() => {
            commit.mutate({ previewId: preview.previewId, receiptId }, { onSuccess: onDone })
          }}
        >
          {commit.isPending ? t('common.loading') : t('pos.confirm.submit')}
        </button>
      </div>

      {commit.isError ? (
        <p className="pos__error" role="alert">
          {commit.error.message}
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
