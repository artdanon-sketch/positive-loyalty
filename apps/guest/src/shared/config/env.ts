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

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')} — ${issue.message}`)
    .join('; ')

  throw new Error(`Неверное окружение (${details}). Скопируйте .env.example в .env`)
}

export const env: Env = parsed.data
