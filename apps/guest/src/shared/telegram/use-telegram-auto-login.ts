import { useEffect, useRef, useState } from 'react'

import { useSession } from '../session/session-context'
import { insideTelegram, telegramInitData, telegramReady } from './mini-app'

/**
 * Вход без единого нажатия, когда карта открыта внутри Telegram.
 * docs/02, раздел 1.4.
 *
 * ЗАЧЕМ. Гость у стойки открывает карту ради кода кассиру. Экран входа в этот
 * момент — это потерянная секунда и иногда потерянный гость. Telegram уже знает,
 * кто он, и подписал это ключом бота: спрашивать нечего.
 *
 * НАЧАЛЬНОЕ СОСТОЯНИЕ СЧИТАЕТСЯ ДО ПЕРВОГО РИСОВАНИЯ, а не выставляется из
 * эффекта. Внутри Telegram с подписью в окне вход начнётся наверняка — значит
 * первым кадром должна быть заставка, а не мелькнувший экран входа.
 *
 * ПРОБУЕМ РОВНО ОДИН РАЗ. Подпись у мини-приложения одна на открытие окна:
 * если сервер её не принял (истекла, часы разошлись, бот сменил токен), второй
 * такой же запрос ответит то же самое. Повтор здесь превратился бы в цикл.
 *
 * ОТКАЗ НЕ ЛОМАЕТ ЭКРАН. Не вышло — показываем вход как всем: кнопки Telegram
 * и Google на месте, карта открывается вторым нажатием, а не первым.
 */

export type TelegramAutoLogin = 'idle' | 'trying' | 'failed'

const willTry = (): boolean => insideTelegram() && telegramInitData() !== null

export function useTelegramAutoLogin(): TelegramAutoLogin {
  const { status, session, signInWithTelegramMiniApp } = useSession()
  const [state, setState] = useState<TelegramAutoLogin>(() => (willTry() ? 'trying' : 'idle'))
  const tried = useRef(false)

  useEffect(() => {
    if (!insideTelegram()) {
      return
    }

    // Заставку Telegram снимаем сразу: она висит поверх страницы, пока ей
    // не сказали, что мы готовы, — даже если входить не придётся.
    telegramReady()
  }, [])

  useEffect(() => {
    // Сессия восстанавливается из памяти — ждём: гость, заходивший вчера,
    // не должен логиниться заново.
    if (status === 'restoring' || session !== null || tried.current) {
      return
    }

    const initData = telegramInitData()

    if (initData === null) {
      return
    }

    tried.current = true

    signInWithTelegramMiniApp(initData)
      .then(() => {
        setState('idle')
      })
      .catch(() => {
        setState('failed')
      })
  }, [status, session, signInWithTelegramMiniApp])

  return state
}
