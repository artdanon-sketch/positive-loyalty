/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API вместе с версией пути, например http://localhost:3000/v1 */
  readonly VITE_API_URL: string
  /** Адрес приложения гостя для ссылок источников. Не задан — боевой. */
  readonly VITE_GUEST_URL?: string
  /** 'true' в сборке для мобильного приложения. Управляет настройкой адреса сервера. */
  readonly VITE_NATIVE?: string
  /** 'cashier' в сборке приложения кассира. В вебе не задан. */
  readonly VITE_APP_ROLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
