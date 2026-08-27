/**
 * Где мы работаем: в браузере или в приложении на телефоне.
 *
 * Проверяем по протоколу страницы, а не по строке браузера и не по наличию
 * объекта Capacitor. Capacitor отдаёт собственную сборку по `capacitor://`
 * (iOS) либо по `http://localhost` из встроенного сервера (Android), а строка
 * браузера в вебвью — это обычный Chrome, и по ней отличить нельзя.
 *
 * Объект `Capacitor` в `window` был бы точнее, но тянет за собой зависимость
 * в веб-сборку ради одной проверки. Протокол и флаг сборки дают тот же ответ
 * бесплатно.
 */

/** Признак сборки для мобильного приложения. Ставится в vite при `build:native`. */
const NATIVE_BUILD: boolean = import.meta.env.VITE_NATIVE === 'true'

export function isNativeApp(): boolean {
  if (NATIVE_BUILD) {
    return true
  }

  try {
    return window.location.protocol === 'capacitor:'
  } catch {
    return false
  }
}
