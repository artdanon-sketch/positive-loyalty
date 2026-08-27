import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Приложение гостя: карта, баллы, код для кассы.
 *
 * Оболочка, а не приложение: исходник живёт в `apps/guest`, сюда приезжает
 * уже собранная веб-часть. Отдельный каталог затем, что у Capacitor один
 * `appId` на конфигурацию и конфигурация ищется по фиксированному имени —
 * два приложения из одной папки не собрать.
 */
const config: CapacitorConfig = {
  appId: 'app.positive.loyalty.guest',
  appName: 'POSitive Карта',
  webDir: 'www',
  android: {
    // Разрешаем http: сервер заведения на демо живёт в локальной сети
    // без сертификата, и без этого вебвью молча режет каждый запрос.
    // Для боевой сборки значение обязано стать false вместе с переездом
    // API на https.
    allowMixedContent: true,
  },
}

export default config
