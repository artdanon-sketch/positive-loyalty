/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API вместе с версией пути, например http://localhost:3000/v1 */
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
