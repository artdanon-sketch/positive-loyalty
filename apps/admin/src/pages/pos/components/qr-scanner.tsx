import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { getDetectorConstructor, isScannerSupported } from './scanner-support'

/**
 * Сканер QR с экрана гостя.
 *
 * ЧЕРЕЗ ШТАТНЫЙ `BarcodeDetector`, А НЕ БИБЛИОТЕКУ. Разборщики QR весят
 * от шестидесяти килобайт (zxing — больше двухсот), а CLAUDE.md требует
 * обсуждать такие зависимости отдельно. На планшетах кассы — Android
 * с Chrome, где детектор встроен в браузер и работает быстрее любого wasm.
 *
 * Где детектора нет (Safari, iPad), сканер честно говорит об этом и уступает
 * место вводу телефона — он рядом, на том же экране, и работает всегда.
 * Это не деградация: телефон гость называет вслух за то же время.
 */

/** Как часто заглядываем в кадр. 8 раз в секунду хватает и не греет планшет. */
const SCAN_INTERVAL_MS = 125

export function QrScanner({ onFound }: { onFound: (token: string) => void }): ReactElement {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  // Колбэк в ref: попади он в зависимости эффекта, камера пересоздавалась бы
  // на каждый рендер родителя — а это чёрный кадр и потерянные секунды.
  // Пишется в эффекте, а не в теле: обращаться к ref во время рендера нельзя,
  // при конкурентном рендере значение может относиться к отброшенной попытке.
  const onFoundRef = useRef(onFound)

  useEffect(() => {
    onFoundRef.current = onFound
  }, [onFound])

  useEffect(() => {
    const Detector = getDetectorConstructor()

    if (Detector === undefined) {
      return
    }

    let stream: MediaStream | null = null
    let timer: number | null = null
    let stopped = false

    const stop = (): void => {
      stopped = true
      if (timer !== null) {
        window.clearInterval(timer)
      }
      stream?.getTracks().forEach((track) => {
        track.stop()
      })
    }

    const start = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Задняя камера: планшет стоит на стойке, гость показывает экран.
          video: { facingMode: 'environment' },
        })

        if (stopped) {
          stream.getTracks().forEach((track) => {
            track.stop()
          })
          return
        }

        const video = videoRef.current

        if (video === null) {
          return
        }

        video.srcObject = stream
        await video.play()

        const detector = new Detector({ formats: ['qr_code'] })

        timer = window.setInterval(() => {
          void (async () => {
            if (video.readyState < 2) {
              return
            }

            try {
              const found = await detector.detect(video)
              const first = found[0]

              if (first !== undefined) {
                // Останавливаем сразу: второй кадр с тем же кодом отправил бы
                // второй запрос, пока первый ещё в пути.
                stop()
                onFoundRef.current(first.rawValue)
              }
            } catch {
              // Отдельный неудачный кадр — не повод гасить сканер: рука
              // дрогнула, фокус поплыл, следующий кадр будет чётче.
            }
          })()
        }, SCAN_INTERVAL_MS)
      } catch {
        setError(t('pos.scan.denied'))
      }
    }

    void start()

    return stop
  }, [t])

  if (!isScannerSupported()) {
    return <p className="scanner__hint">{t('pos.scan.unsupported')}</p>
  }

  return (
    <div className="scanner">
      {error === null ? (
        <>
          <video className="scanner__video" ref={videoRef} muted playsInline />
          <span className="scanner__frame" aria-hidden="true" />
          <p className="scanner__hint">{t('pos.scan.hint')}</p>
        </>
      ) : (
        <p className="scanner__hint scanner__hint--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
