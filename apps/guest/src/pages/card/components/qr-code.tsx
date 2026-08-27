import { QRCodeSVG } from 'qrcode.react'
import type { ReactElement } from 'react'

/**
 * QR-код для показа на кассе.
 *
 * SVG, а не canvas: масштабируется без размытия на любой плотности экрана,
 * попадает в снимки тестов как разметка и не требует ручной работы с DPR.
 *
 * Цвета заданы явными значениями, а не токенами темы, и это осознанно:
 * сканеру нужен максимальный контраст, а тёмная тема дала бы серый на сером.
 * Белая подложка под кодом — часть «тихой зоны», без неё камера не читает.
 *
 * `level="M"` — 15% избыточности: код показывают с экрана в руке, с бликами
 * и под углом. «L» экономит пиксели, но начинает промахиваться на солнце,
 * а солнце на Пхукете есть всегда.
 */
export function QrCode({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <div className="qr">
      <QRCodeSVG
        value={value}
        size={220}
        level="M"
        bgColor="#FFFFFF"
        fgColor="#0A0E14"
        marginSize={2}
        role="img"
        aria-label={label}
      />
    </div>
  )
}
