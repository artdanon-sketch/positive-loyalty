import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Приложение владельца: бэк-офис целиком — обзор, операции, гости, касса.
 *
 * Оболочка, а не приложение: исходник живёт в `apps/admin`, сюда приезжает
 * уже собранная веб-часть. Отдельный каталог затем, что у Capacitor один
 * `appId` на конфигурацию и конфигурация ищется по фиксированному имени —
 * два приложения из одной папки не собрать.
 */
const config: CapacitorConfig = {
  appId: 'app.positive.loyalty.owner',
  appName: 'POSitive Владелец',
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
