/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  /** 'true' в сборке для мобильного приложения. Управляет настройкой адреса сервера. */
  readonly VITE_NATIVE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
