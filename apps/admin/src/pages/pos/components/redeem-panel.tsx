import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import { ApiError } from '../../../shared/api/http'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { generateReceiptId, useRedeemGrant } from '../hooks'
import { isNetworkFailure } from '../offline-queue'

/**
 * Погасить промокод гостя. docs/02, раздел 3.4 · docs/10, раздел 5.7.
 *
 * Та самая кнопка, которой не хватало кассе (стори П4): гость показывает
 * подарок в приложении — кассир набирает код и видит, ЧТО отдать.
 * Менеджер и владелец пользуются ей же, когда касса не справилась.
 *
 * НОМЕР ЧЕКА — КЛЮЧ ПОВТОРА. Если кассир его не ввёл, подставляется
 * сгенерированный и живёт до успеха: связь оборвалась после погашения —
 * повтор вернёт тот же ответ, а не «код уже погашен», и подарок гостю отдадут.
 *
 * БЕЗ СВЯЗИ НЕ ГАСИМ. Чек можно отложить в очередь, подарок — нет: кассир
 * должен знать сейчас, отдавать или не отдавать.
 *
 * К каждому отказу — подсказка, что сказать гостю: «уже погашен», «срок вышел»
 * и «не то время» — три разных разговора (docs/02, раздел 3.4).
 */

const HINTS: Readonly<Record<string, TranslationKey>> = {
  GRANT_NOT_FOUND: 'pos.redeem.hint.GRANT_NOT_FOUND',
  GRANT_ALREADY_USED: 'pos.redeem.hint.GRANT_ALREADY_USED',
  GRANT_EXPIRED: 'pos.redeem.hint.GRANT_EXPIRED',
  GRANT_OUT_OF_WINDOW: 'pos.redeem.hint.GRANT_OUT_OF_WINDOW',
  GRANT_WRONG_TENANT: 'pos.redeem.hint.GRANT_NOT_FOUND',
}

/** Гость диктует код с пробелами и строчными буквами — касса принимает как есть. */
const normalize = (value: string): string => value.replace(/\s+/g, '').toUpperCase()

export function RedeemPanel(): ReactElement {
  const t = useT()
  const redeem = useRedeemGrant()

  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [receipt, setReceipt] = useState('')
  const [fallbackReceipt, setFallbackReceipt] = useState(generateReceiptId)

  const normalized = normalize(code)
  const ready = normalized.length >= 4 && !redeem.isPending

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!ready) {
      return
    }

    redeem.mutate(
      { code: normalized, receiptId: receipt.trim() === '' ? fallbackReceipt : receipt.trim() },
      {
        onSuccess: () => {
          setCode('')
          setReceipt('')
          setFallbackReceipt(generateReceiptId())
        },
      },
    )
  }

  if (!open) {
    return (
      <div className="pos__redeem">
        <button
          className="button"
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          {t('pos.redeem.open')}
        </button>
      </div>
    )
  }

  const hintKey = redeem.error instanceof ApiError ? (HINTS[redeem.error.code] ?? null) : null

  return (
    <section className="pos__step pos__redeem" aria-labelledby="pos-redeem-title">
      <h2 className="panel__title" id="pos-redeem-title">
        {t('pos.redeem.title')}
      </h2>

      <form className="pos__form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{t('pos.redeem.code')}</span>
          <input
            className="field__input field__input--mono"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('pos.redeem.receipt')}</span>
          <input
            className="field__input"
            type="text"
            autoComplete="off"
            maxLength={64}
            value={receipt}
            onChange={(event) => {
              setReceipt(event.target.value)
            }}
          />
        </label>
        <div className="pos__actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={() => {
              redeem.reset()
              setOpen(false)
            }}
          >
            {t('pos.redeem.close')}
          </button>
          <button className="button button--primary" type="submit" disabled={!ready}>
            {redeem.isPending ? t('common.loading') : t('pos.redeem.submit')}
          </button>
        </div>
      </form>

      {redeem.isSuccess ? (
        <div className="pos__redeem-done" role="status">
          <p className="pos__done">
            {t('pos.redeem.give')} <b>{redeem.data.title ?? t('pos.redeem.untitled')}</b>
          </p>
          {redeem.data.replayed ? <p className="pos__notice">{t('pos.redeem.replayed')}</p> : null}
        </div>
      ) : null}

      {redeem.isError ? (
        <p className="pos__error" role="alert">
          {isNetworkFailure(redeem.error) ? (
            <span>{t('pos.redeem.offline')}</span>
          ) : (
            <>
              <span>{redeem.error.message}</span>
              {hintKey === null ? null : <span className="pos__hint">{t(hintKey)}</span>}
            </>
          )}
        </p>
      ) : null}
    </section>
  )
}
