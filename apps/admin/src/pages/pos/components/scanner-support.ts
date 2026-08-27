/**
 * Умеет ли браузер читать штрихкоды сам.
 *
 * Вынесено из файла компонента: react-refresh требует, чтобы модуль
 * с компонентом экспортировал только компоненты — иначе горячая перезагрузка
 * подменяет модуль целиком и теряет состояние экрана.
 *
 * Проверка нужна и вне сканера: экран кассы решает по ней, показывать ли
 * камеру вообще, — а пустая рамка там, где камеры не будет, только сбивает.
 */

/** Часть API распознавания штрихкодов, которой мы пользуемся. */
export interface DetectedBarcode {
  readonly rawValue: string
}

export interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}

export interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
}

export const getDetectorConstructor = (): BarcodeDetectorConstructor | undefined =>
  (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector

export const isScannerSupported = (): boolean => getDetectorConstructor() !== undefined
