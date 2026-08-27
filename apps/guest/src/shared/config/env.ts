import { z } from 'zod'

/**
 * Переменные окружения фронта. `.strict()` здесь намеренно нет: Vite кладёт в
 * `import.meta.env` свои поля (MODE, DEV, BASE_URL), и строгая схема упала бы на них.
 * Лишнее просто отбрасывается.
 */
const EnvSchema = z.object({
  VITE_API_URL: z.url(),
})

export type Env = z.infer<typeof EnvSchema>

const parsed = EnvSchema.safeParse(import.meta.env)

/**
 * Заглушка для мобильной сборки: адрес настраивается в приложении и хранится
 * на устройстве. Падать при сборке значило бы требовать знать адрес заведения
 * в момент сборки APK, а он у каждого свой и меняется.
 */
const NATIVE_PLACEHOLDER = 'http://127.0.0.1:3000/v1'

if (!parsed.success && import.meta.env.VITE_NATIVE === 'true') {
  // Веб по-прежнему падает: там адрес известен и обязан быть задан.
} else if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
    .join('; ')

  throw new Error(`Неверное окружение (${details}). Скопируйте .env.example в .env`)
}

export const env: Env = parsed.success ? parsed.data : { VITE_API_URL: NATIVE_PLACEHOLDER }
